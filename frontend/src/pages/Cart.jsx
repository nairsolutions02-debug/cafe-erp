import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMinus, FiPlus, FiShoppingCart, FiAward, FiLock, FiAlertTriangle, FiDroplet, FiMapPin, FiShoppingBag } from 'react-icons/fi';
import { BiDish } from 'react-icons/bi';
import Header from '../components/Header';
import AnimatedSearchInput from '../components/AnimatedSearchInput';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import {
    createOrder,
    validateCoupon,
    getRecommended,
    getTables,
    getGstRate,
    getMenuItems,
    getMyLoyaltyPoints,
    calculateRedemption,
    getLoyaltyOffers,
    quoteOrder,
    getCheckoutInfo,
    getMyRewards,
} from '../utils/api';
import { useQrTable, clearQrTable } from '../lib/qrTable';
import { usePortal } from '../context/PortalContext';
import InfoTip from '../components/cx/InfoTip';
import { getImageUrl } from '../utils/config';
import './Cart.css';

const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const Cart = () => {
    const navigate = useNavigate();
    const { items: cart, updateQuantity, removeItem, clearCart, subtotal: getCartTotal, addItem } = useCart();
    const { isAuthenticated } = useAuth();
    const { cfg, show, nudge } = usePortal();
    const tableMode = cfg?.tables?.mode || 'qr';
    const qrTable = useQrTable();
    const [checkoutInfo, setCheckoutInfo] = useState(null);
    const [myCoupons, setMyCoupons] = useState([]);
    // One id per checkout: a double tap or a retry places the order only once
    const clientId = useRef(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);

    const [tables, setTables] = useState([]);
    const [selectedTable, setSelectedTable] = useState('');
    const [couponCode, setCouponCode] = useState('');
    const [couponApplied, setCouponApplied] = useState(null);
    const [discount, setDiscount] = useState(0);
    const [specialInstructions, setSpecialInstructions] = useState('');
    const [recommendations, setRecommendations] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [gstRate, setGstRate] = useState(5);
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);

    // Upsell Item (e.g. Water Bottle)
    const [upsellItem, setUpsellItem] = useState(null);

    // Loyalty Points
    const [loyaltyPoints, setLoyaltyPoints] = useState(null);
    const [loyaltyOffers, setLoyaltyOffers] = useState([]);
    const [selectedOffer, setSelectedOffer] = useState(null);
    const [usePoints, setUsePoints] = useState(false);
    const [pointsDiscount, setPointsDiscount] = useState(0);
    const [pointsUsed, setPointsUsed] = useState(0);

    // Exact bill from the server for the signed-in customer
    const [quote, setQuote] = useState(null);
    const cartKey = cart.map(i => `${i._id}:${i.quantity}`).join(',');
    useEffect(() => {
        if (!isAuthenticated || cart.length === 0) { setQuote(null); return undefined; }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const res = await quoteOrder(
                    cart.map(i => ({ menuItem: i._id, quantity: i.quantity })),
                    couponApplied ? couponCode : '',
                    usePoints && selectedOffer ? selectedOffer._id : null);
                if (!cancelled) setQuote(res.data);
            } catch {
                if (!cancelled) setQuote(null);
            }
        }, 250);
        return () => { cancelled = true; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cartKey, isAuthenticated, couponApplied, usePoints, selectedOffer]);

    useEffect(() => {
        fetchRecommendations();
        fetchGstRate();
        fetchUpsellItem();
    }, []);

    const fetchUpsellItem = async () => {
        try {
            // Simply fetch Water Bottle as requested, ignoring dynamic admin flag
            const res = await getMenuItems({ search: 'Water Bottle' });
            if (res.data && res.data.length > 0) {
                const found = res.data.find(i => i.name.toLowerCase().includes('water bottle')) || res.data[0];
                setUpsellItem(found);
            }
        } catch (error) {
            console.error('Error fetching upsell item:', error);
        }
    };

    useEffect(() => {
        if (usePoints && selectedOffer) {
            setPointsDiscount(selectedOffer.discountValue);
            setPointsUsed(selectedOffer.pointsRequired);
        } else {
            setPointsDiscount(0);
            setPointsUsed(0);
        }
    }, [usePoints, selectedOffer]);

    // Tables to pick from, only for cafes in "customer picks" mode (customers never see busy/free)
    const fetchTables = async () => {
        try {
            const res = await getTables();
            setTables(res.data);
        } catch (error) {
            console.error('Error fetching tables:', error);
        }
    };
    useEffect(() => { if (tableMode === 'pick') fetchTables(); }, [tableMode]);

    useEffect(() => {
        if (!isAuthenticated) return;
        fetchLoyaltyPoints();
        fetchLoyaltyOffers();
        getCheckoutInfo().then(r => setCheckoutInfo(r.data)).catch(() => {});
        getMyRewards().then(r => setMyCoupons(r.data?.coupons || [])).catch(() => {});
    }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchRecommendations = async () => {
        try {
            const res = await getRecommended();
            setRecommendations(res.data.slice(0, 4));
        } catch (error) {
            console.error('Error:', error);
        }
    };

    const fetchGstRate = async () => {
        try {
            const res = await getGstRate();
            setGstRate(res.data.gstRate || 5);
        } catch (error) {
            console.error('Error fetching GST:', error);
        }
    };

    const fetchLoyaltyPoints = async () => {
        try {
            const res = await getMyLoyaltyPoints();
            setLoyaltyPoints(res.data);
        } catch (error) {
            console.error('Error fetching loyalty points:', error);
        }
    };

    const fetchLoyaltyOffers = async () => {
        try {
            const res = await getLoyaltyOffers();
            setLoyaltyOffers(res.data);
        } catch (error) {
            console.error('Error fetching loyalty offers:', error);
        }
    };

    const calculatePointsDiscount = async () => {
        try {
            const res = await calculateRedemption(getCartTotal - discount, loyaltyPoints.currentPoints);
            setPointsDiscount(res.data.discount);
            setPointsUsed(res.data.pointsUsed);
        } catch (error) {
            console.error('Error calculating points:', error);
        }
    };

    const handleSearch = async (value) => {
        setSearchTerm(value);
        if (value.trim().length > 1) {
            setIsSearching(true);
            try {
                const res = await getMenuItems({ search: value });
                setSearchResults(res.data || []);
            } catch (error) {
                console.error('Search error:', error);
            }
        } else {
            setSearchResults([]);
            setIsSearching(false);
        }
    };

    const handleApplyCoupon = async (codeArg) => {
        const code = typeof codeArg === 'string' ? codeArg : couponCode;
        if (!code.trim()) return;
        if (code !== couponCode) setCouponCode(code);

        try {
            const res = await validateCoupon(code, getCartTotal);
            setCouponApplied(res.data);
            setDiscount(res.data.discount);
            setError('');
        } catch (err) {
            setError(err.response?.data?.message || 'Invalid coupon');
            setCouponApplied(null);
            setDiscount(0);
        }
    };

    const removeCoupon = () => {
        setCouponCode('');
        setCouponApplied(null);
        setDiscount(0);
    };

    const handlePlaceOrder = async () => {
        if (!isAuthenticated) {
            navigate('/login', { state: { from: '/cart' } });
            return;
        }

        if (cart.length === 0) {
            setError('Your cart is empty');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const orderData = {
                items: cart.map(item => ({
                    menuItem: item._id,
                    quantity: item.quantity
                })),
                couponCode: couponApplied ? couponCode : '',
                pointsUsed: usePoints ? pointsUsed : 0,
                loyaltyOfferId: usePoints && selectedOffer ? selectedOffer._id : null,
                tableId: tableMode === 'pick' ? (selectedTable || null) : null,
                tableCode: tableMode === 'qr' && qrTable ? qrTable.code : null,
                clientId: clientId.current,
                specialInstructions
            };

            const res = await createOrder(orderData);
            clearCart();
            clientId.current = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
            navigate(`/order/${res.data._id}`, { state: { justPlaced: true, nth: checkoutInfo ? checkoutInfo.ordersSoFar + 1 : null } });
        } catch (err) {
            const msg = err.response?.data?.message || err.message || 'Failed to place order';
            // The QR code was replaced or the table switched off: forget it so they can scan again
            if (/QR is no longer in use|not in use right now/.test(msg)) clearQrTable();
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const subtotal = getCartTotal;

    // Points that can actually be used on this bill (never shown when they can't)
    const usableOffer = loyaltyPoints && loyaltyOffers
        .filter(o => o.pointsRequired <= loyaltyPoints.currentPoints && (o.minOrderValue || 0) <= subtotal && o.discountValue > 0)
        .sort((a, b) => b.discountValue - a.discountValue)[0];
    const nth = checkoutInfo ? checkoutInfo.ordersSoFar + 1 : null;
    const totalDiscount = discount + (usePoints ? pointsDiscount : 0);
    // Estimate until the exact quote (per-item taxes, MRP items, restricted items) arrives
    const estimatedTax = (subtotal - totalDiscount) * (gstRate / 100);
    const tax = quote ? quote.tax : estimatedTax;
    const total = quote ? quote.total : subtotal - totalDiscount + estimatedTax;
    const shownDiscount = quote ? quote.discount : totalDiscount;

    useEffect(() => {
        if (usableOffer && !usePoints && show('nudgePoints')) {
            nudge({
                kind: 'points', icon: '🪙',
                text: `You have enough points to save ₹${Math.min(usableOffer.discountValue, subtotal).toFixed(0)} on this order`,
                action: { label: 'Use', onClick: () => { setSelectedOffer(usableOffer); setUsePoints(true); } },
            });
        }
    }, [usableOffer?._id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (cart.length === 0) {
        return (
            <div className="cart-page">
                <Header title="Cart" showBack showCart={false} />
                <div className="empty-cart">
                    <div className="empty-cart-icon"><FiShoppingCart /></div>
                    <h2>Your cart is empty</h2>
                    <p>Add some delicious items from our menu</p>
                    <button onClick={() => navigate('/menu')} className="btn btn-primary">
                        Browse Menu
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="cart-page">
            <Header title="Cart" showBack showCart={false} />

            <div className="cart-content">
                {/* Search Bar */}
                <div className="cart-search-section">
                    <div className="cart-search-header">
                        <h3>Add more items</h3>
                    </div>
                    <AnimatedSearchInput
                        value={searchTerm}
                        onChange={handleSearch}
                        className="cart-search-bar"
                    />

                    {searchTerm && (
                        <div className="cart-search-results">
                            {searchResults.length > 0 ? (
                                <div className="result-items">
                                    {searchResults.map(item => (
                                        <div key={item._id} className="result-item">
                                            <div className="result-item-info">
                                                <div className="result-item-image">
                                                    {item.image ? (
                                                        <img src={getImageUrl(item.image)} alt={item.name} />
                                                    ) : (
                                                        <span><BiDish /></span>
                                                    )}
                                                </div>
                                                <div className="result-item-details">
                                                    <span className="name">{item.name}</span>
                                                    <span className="price">₹{item.price}</span>
                                                </div>
                                            </div>
                                            <button
                                                className="add-quick-btn"
                                                onClick={() => {
                                                    addItem(item);
                                                    setSearchTerm('');
                                                    setSearchResults([]);
                                                }}
                                            >
                                                <FiPlus /> Add
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                isSearching && <div className="no-results">No items found</div>
                            )}
                        </div>
                    )}
                </div>

                {/* Cart Items */}
                <div className="cart-section">
                    <h3 className="section-title">Your Items</h3>
                    <div className="cart-items">
                        {cart.map(item => (
                            <div key={item._id} className="cart-item">
                                <div className="cart-item-image">
                                    {item.image ? (
                                        <img src={getImageUrl(item.image)} alt={item.name} />
                                    ) : (
                                        <span><BiDish /></span>
                                    )}
                                </div>
                                <div className="cart-item-info">
                                    <h4>{item.name}</h4>
                                    <span className="cart-item-price">₹{item.price}</span>
                                </div>
                                <div className="cart-item-controls">
                                    <div className="quantity-controls">
                                        <button onClick={() => updateQuantity(item._id, item.quantity - 1)}>
                                            <FiMinus />
                                        </button>
                                        <span>{item.quantity}</span>
                                        <button onClick={() => updateQuantity(item._id, item.quantity + 1)}>
                                            <FiPlus />
                                        </button>
                                    </div>
                                    <span className="cart-item-total">₹{item.price * item.quantity}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Table: from the QR (locked), picked from a list, or none at all */}
                {tableMode === 'qr' && (
                    <div className="cart-section">
                        <div className="table-box">
                            <span className="tb-pin">{qrTable ? <FiMapPin /> : <FiShoppingBag />}</span>
                            {qrTable ? (
                                <span className="tb-copy">
                                    <strong>Table {qrTable.tableNumber}
                                        <InfoTip label="About your table">Set from the QR you scanned. Sharing the table? Friends can scan the same QR and order on their own phones, each with their own bill. Sitting somewhere else? Scan the QR on that table.</InfoTip>
                                    </strong>
                                    <small>Your order comes to this table · <button className="link-btn-sm" onClick={clearQrTable}>Takeaway instead</button></small>
                                </span>
                            ) : (
                                <span className="tb-copy">
                                    <strong>Takeaway / pickup</strong>
                                    <small>Sitting at a table? Scan the QR on your table to have it served there.</small>
                                </span>
                            )}
                        </div>
                    </div>
                )}
                {tableMode === 'pick' && (
                    <div className="cart-section">
                        <h3 className="section-title">Your table</h3>
                        <select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)} className="table-select">
                            <option value="">Takeaway / no table</option>
                            {tables.map(table => (
                                <option key={table._id} value={table._id}>Table {table.tableNumber}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Coupon Section */}
                <div className="cart-section">
                    <h3 className="section-title">Apply Coupon</h3>
                    {couponApplied ? (
                        <div className="coupon-applied">
                            <div className="coupon-info">
                                <span className="coupon-code-tag">{couponApplied.code}</span>
                                <span className="coupon-discount">-₹{discount.toFixed(2)}</span>
                            </div>
                            <button onClick={removeCoupon} className="remove-coupon-btn">Remove</button>
                        </div>
                    ) : (
                        <>
                        {myCoupons.length > 0 && (
                            <div className="my-gifts">
                                {myCoupons.slice(0, 3).map(c => (
                                    <button key={c.code} type="button" className="my-gift" onClick={() => handleApplyCoupon(c.code)}>
                                        <span>{/birthday/i.test(c.title) ? '🎂' : '🎁'}</span>
                                        <span className="my-gift-text"><b>{c.reward}</b><small>{c.title}</small></span>
                                        <span className="my-gift-apply">Apply</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="coupon-input-row">
                            <input
                                type="text"
                                value={couponCode}
                                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                placeholder="Enter coupon code"
                                className="coupon-input"
                            />
                            <button onClick={handleApplyCoupon} className="apply-btn">
                                Apply
                            </button>
                        </div>
                        </>
                    )}
                </div>

                {/* Loyalty Points Section */}
                {isAuthenticated && loyaltyPoints && (
                    <div className="cart-section loyalty-section">
                        <div className="loyalty-header">
                            <h3 className="section-title"><FiAward /> Loyalty Rewards
                                <InfoTip label="How points work">You earn points on every paid order. Pick a reward below to spend points on this order; the discount shows in the bill.</InfoTip>
                            </h3>
                            <span className="points-balance">{loyaltyPoints.currentPoints} pts available</span>
                        </div>

                        <div className="loyalty-offers-list">
                            {loyaltyOffers.length > 0 ? (
                                loyaltyOffers.map(offer => (
                                    <div
                                        key={offer._id}
                                        className={`loyalty-offer-item ${selectedOffer?._id === offer._id ? 'selected' : ''} ${loyaltyPoints.currentPoints < offer.pointsRequired ? 'locked' : ''}`}
                                        onClick={() => {
                                            if (loyaltyPoints.currentPoints >= offer.pointsRequired) {
                                                if (selectedOffer?._id === offer._id) {
                                                    setSelectedOffer(null);
                                                    setUsePoints(false);
                                                } else {
                                                    setSelectedOffer(offer);
                                                    setUsePoints(true);
                                                }
                                            }
                                        }}
                                    >
                                        <div className="offer-info">
                                            <span className="offer-name">{offer.name}</span>
                                            <span className="offer-cost"><FiAward /> {offer.pointsRequired} points</span>
                                        </div>
                                        <div className="offer-action">
                                            {loyaltyPoints.currentPoints < offer.pointsRequired ? (
                                                <span className="lock-icon"><FiLock /></span>
                                            ) : (
                                                <div className="radio-circle"></div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="no-offers-text">No rewards available at the moment.</p>
                            )}
                        </div>
                    </div>
                )}

                {/* Special Instructions */}
                <div className="cart-section">
                    <h3 className="section-title">Special Instructions</h3>
                    <textarea
                        value={specialInstructions}
                        onChange={(e) => setSpecialInstructions(e.target.value)}
                        placeholder="Any special requests? (Optional)"
                        className="instructions-input"
                        rows={2}
                    />
                </div>

                {/* Recommendations */}
                {recommendations.length > 0 && (
                    <div className="cart-section">
                        <h3 className="section-title">💡 Don't forget to add</h3>
                        <div className="recommendations-scroll">
                            {recommendations.map(item => (
                                <div key={item._id} className="recommend-card">
                                    <span className="recommend-name">{item.name}</span>
                                    <div className="recommend-footer">
                                        <span className="recommend-price">₹{item.price}</span>
                                        <button
                                            className="recommend-add-btn"
                                            onClick={() => addItem(item)}
                                        >
                                            ADD
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Upsell Item Check */}
                {upsellItem && !cart.find(item => item._id === upsellItem._id) && (
                    <div className="cart-section water-upsell-section" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                        <div className="water-upsell-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px' }}>
                            <div className="water-info" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div className="water-icon" style={{ fontSize: '24px', color: 'var(--primary)' }}>
                                    <FiDroplet />
                                </div>
                                <div className="water-text">
                                    <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>Forgot {upsellItem.name.includes('Water') ? 'Water?' : 'Something?'}</h4>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Add {upsellItem.name} - ₹{upsellItem.price}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => addItem(upsellItem)}
                                className="btn btn-sm btn-outline-primary"
                                style={{ padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                <FiPlus /> Add
                            </button>
                        </div>
                    </div>
                )}

                {/* Milestone: "this will be your 23rd order" */}
                {nth > 1 && show('nudgeMilestone') && (
                    <div className="cx-card milestone-card">
                        <span className="milestone-badge">#{nth}</span>
                        <span className="cx-card-copy">
                            <strong>This will be your {ordinal(nth)} order with us 🎉</strong>
                            <small>{nth % 5 === 0 ? 'A round number! Thanks for being a regular.' : 'Thanks for coming back. Every order earns points.'}</small>
                        </span>
                    </div>
                )}

                {/* Points ready to use */}
                {usableOffer && show('nudgePoints') && (
                    <button type="button" className={`points-chip ${usePoints && selectedOffer?._id === usableOffer._id ? 'on' : ''}`}
                        onClick={() => {
                            const on = usePoints && selectedOffer?._id === usableOffer._id;
                            setSelectedOffer(on ? null : usableOffer);
                            setUsePoints(!on);
                        }}>
                        <span className="pc-coin" aria-hidden="true">🪙</span>
                        <span className="pc-copy">
                            <strong>{usePoints && selectedOffer?._id === usableOffer._id ? `Using ${usableOffer.pointsRequired} points` : 'You have enough points to pay!'}</strong>
                            <small>{usableOffer.name}: save ₹{Math.min(usableOffer.discountValue, subtotal).toFixed(0)} for {usableOffer.pointsRequired} of your {loyaltyPoints.currentPoints} points</small>
                        </span>
                        <span className="pc-btn">{usePoints && selectedOffer?._id === usableOffer._id ? 'Remove' : 'Use'}</span>
                    </button>
                )}

                {/* Bill Summary */}
                <div className="cart-section bill-section">
                    <h3 className="section-title">Bill Summary</h3>

                    {/* Itemized Product List */}
                    <div className="bill-items-list">
                        {cart.map(item => (
                            <div key={item._id} className="bill-item-row">
                                <div className="bill-item-info">
                                    <span className="bill-item-name">{item.name}</span>
                                    <span className="bill-item-qty">x{item.quantity}</span>
                                </div>
                                <span className="bill-item-price">₹{(item.price * item.quantity).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>

                    <div className="bill-divider"></div>

                    <div className="bill-row">
                        <span>Subtotal</span>
                        <span>₹{subtotal.toFixed(2)}</span>
                    </div>
                    {(quote ? quote.couponDiscount : discount) > 0 && (
                        <div className="bill-row discount-row">
                            <span>Coupon Discount</span>
                            <span>-₹{(quote ? quote.couponDiscount : discount).toFixed(2)}</span>
                        </div>
                    )}
                    {usePoints && (quote ? quote.offerDiscount : pointsDiscount) > 0 && (
                        <div className="bill-row points-row">
                            <span><FiAward /> Points ({pointsUsed} pts)</span>
                            <span>-₹{(quote ? quote.offerDiscount : pointsDiscount).toFixed(2)}</span>
                        </div>
                    )}
                    {quote?.clubDiscount > 0 && (
                        <div className="bill-row discount-row">
                            <span>{[quote.club?.tierAmount > 0 && `${quote.club.tier} ${quote.club.tierPct}%`,
                                quote.club?.memberAmount > 0 && `${quote.club.member} member ${quote.club.memberPct}%`].filter(Boolean).join(' + ') || 'Club discount'}</span>
                            <span>-₹{Number(quote.clubDiscount).toFixed(2)}</span>
                        </div>
                    )}
                    {quote ? quote.taxDetails.map(t => (
                        <div className="bill-row" key={`${t.name}-${t.rate}`}>
                            <span>{t.name} ({t.rate}%)</span>
                            <span>₹{Number(t.amount).toFixed(2)}</span>
                        </div>
                    )) : (
                        <div className="bill-row">
                            <span>GST ({gstRate}%)</span>
                            <span>₹{tax.toFixed(2)}</span>
                        </div>
                    )}
                    {quote && subtotal - shownDiscount + tax - total > 0.009 && (
                        <div className="bill-row muted-row">
                            <span>Tax included in MRP items</span>
                            <span></span>
                        </div>
                    )}
                    <div className="bill-row total-row">
                        <span>Total</span>
                        <span>₹{total.toFixed(2)}</span>
                    </div>
                </div>
            </div>

            {/* Fixed Bottom Button */}
            <div className="cart-footer">
                <button
                    onClick={handlePlaceOrder}
                    className="place-order-btn"
                    disabled={loading || cart.length === 0}
                >
                    {loading ? 'Placing Order...' : `Place Order • ₹${total.toFixed(2)}`}
                </button>
            </div>

            {/* Error Popup Modal */}
            {error && (
                <div className="error-modal-overlay" onClick={() => setError('')}>
                    <div className="error-modal" onClick={e => e.stopPropagation()}>
                        <div className="error-icon"><FiAlertTriangle /></div>
                        <p className="error-text">{error}</p>
                        <button className="error-close-btn" onClick={() => setError('')}>
                            OK
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Cart;

