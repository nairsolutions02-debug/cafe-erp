import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiMinus, FiPlus, FiTrash2, FiShoppingCart, FiAward, FiLock, FiAlertTriangle, FiImage, FiDroplet } from 'react-icons/fi';
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
} from '../utils/api';
import { getImageUrl } from '../utils/config';
import './Cart.css';

const Cart = () => {
    const navigate = useNavigate();
    const { items: cart, updateQuantity, removeItem, clearCart, subtotal: getCartTotal, addItem } = useCart();
    const { isAuthenticated, socket } = useAuth();

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

    useEffect(() => {
        fetchTables();
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

    useEffect(() => {
        if (socket) {
            socket.on('table-occupied', () => fetchTables());
            socket.on('table-freed', () => fetchTables());
            return () => {
                socket.off('table-occupied');
                socket.off('table-freed');
            };
        }
    }, [socket]);

    const fetchTables = async () => {
        try {
            const res = await getTables();
            setTables(res.data);
        } catch (error) {
            console.error('Error fetching tables:', error);
        }
    };

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

    const handleApplyCoupon = async () => {
        if (!couponCode.trim()) return;

        try {
            const res = await validateCoupon(couponCode, getCartTotal);
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
                tableId: selectedTable || null,
                specialInstructions
            };

            const res = await createOrder(orderData);
            clearCart();
            navigate(`/order/${res.data._id}`);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to place order');
        } finally {
            setLoading(false);
        }
    };

    const subtotal = getCartTotal;
    const totalDiscount = discount + (usePoints ? pointsDiscount : 0);
    const tax = (subtotal - totalDiscount) * (gstRate / 100);
    const total = subtotal - totalDiscount + tax;

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

                {/* Table Selection */}
                <div className="cart-section">
                    <h3 className="section-title">Select Table</h3>
                    <select
                        value={selectedTable}
                        onChange={(e) => setSelectedTable(e.target.value)}
                        className="table-select"
                    >
                        <option value="">-- Select a Table --</option>
                        {[...tables].sort((a, b) => a.tableNumber - b.tableNumber).map(table => (
                            <option
                                key={table._id}
                                value={table._id}
                                disabled={table.status !== 'available'}
                            >
                                Table {table.tableNumber} ({table.capacity} seats)
                                {table.status !== 'available' ? ' - Occupied' : ' - Available'}
                            </option>
                        ))}
                    </select>
                </div>

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
                    )}
                </div>

                {/* Loyalty Points Section */}
                {isAuthenticated && loyaltyPoints && (
                    <div className="cart-section loyalty-section">
                        <div className="loyalty-header">
                            <h3 className="section-title"><FiAward /> Loyalty Rewards</h3>
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
                    {discount > 0 && (
                        <div className="bill-row discount-row">
                            <span>Coupon Discount</span>
                            <span>-₹{discount.toFixed(2)}</span>
                        </div>
                    )}
                    {usePoints && pointsDiscount > 0 && (
                        <div className="bill-row points-row">
                            <span><FiAward /> Points ({pointsUsed} pts)</span>
                            <span>-₹{pointsDiscount.toFixed(2)}</span>
                        </div>
                    )}
                    <div className="bill-row">
                        <span>GST ({gstRate}%)</span>
                        <span>₹{tax.toFixed(2)}</span>
                    </div>
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

