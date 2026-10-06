import React, { useState, useEffect, useRef } from 'react';
import { shortOfferList } from '../lib/offerList';
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
import useCxLang, { T, sayReward } from '../lib/cxLang';

const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

const W = {
    cashTitle: T('Use points as cash', 'पॉइंट को पैसे की तरह इस्तेमाल करें', 'Points ko cash ki tarah use karo'),
    cashLine: T('{p} points → ₹{amt} off (up to {max}% of the bill)', '{p} पॉइंट → ₹{amt} की छूट (बिल का ज़्यादा से ज़्यादा {max}%)', '{p} points → ₹{amt} off (bill ka max {max}%)'),
    cashNeed: T('Collect {n} points to start using them', '{n} पॉइंट होने पर इस्तेमाल कर सकेंगे', '{n} points hone pe use kar paoge'),
    cart: T('Cart', 'कार्ट', 'Cart'),
    emptyTitle: T('Your cart is empty', 'आपका कार्ट खाली है', 'Aapka cart khaali hai'),
    emptyText: T('Add some delicious items from our menu', 'हमारे मेन्यू से कुछ स्वादिष्ट चुनें', 'Hamare menu se kuch tasty add karo'),
    browse: T('Browse Menu', 'मेन्यू देखें', 'Menu dekho'),
    addMore: T('Add more items', 'और आइटम जोड़ें', 'Aur items add karo'),
    add: T('Add', 'जोड़ें', 'Add karo'),
    addCaps: T('ADD', 'जोड़ें', 'ADD'),
    noItems: T('No items found', 'कोई आइटम नहीं मिला', 'Koi item nahi mila'),
    yourItems: T('Your Items', 'आपके आइटम', 'Aapke items'),
    table: T('Table {n}', 'टेबल {n}', 'Table {n}'),
    aboutTable: T('About your table', 'आपकी टेबल के बारे में', 'Aapki table ke baare mein'),
    aboutTableText: T(
        'Set from the QR you scanned. Sharing the table? Friends can scan the same QR and order on their own phones, each with their own bill. Sitting somewhere else? Scan the QR on that table.',
        'आपने जो QR स्कैन किया, उसी से यह टेबल चुनी गई है। टेबल शेयर कर रहे हैं? दोस्त वही QR स्कैन करके अपने फ़ोन से ऑर्डर कर सकते हैं, हर किसी का अलग बिल। किसी और टेबल पर बैठे हैं? उस टेबल का QR स्कैन करें।',
        'Yeh table aapke scan kiye QR se set hai. Table share kar rahe ho? Dost wahi QR scan karke apne phone se order kar sakte hain, sabka alag bill. Kisi aur table pe baithe ho? Us table ka QR scan karo.'),
    comesHere: T('Your order comes to this table', 'आपका ऑर्डर इसी टेबल पर आएगा', 'Aapka order isi table pe aayega'),
    takeawayInstead: T('Takeaway instead', 'पार्सल चाहिए?', 'Parcel chahiye?'),
    takeaway: T('Takeaway / pickup', 'पार्सल / पिकअप', 'Parcel / pickup'),
    scanToServe: T('Sitting at a table? Scan the QR on your table to have it served there.', 'टेबल पर बैठे हैं? अपनी टेबल का QR स्कैन करें, ऑर्डर वहीं आएगा।', 'Table pe baithe ho? Apni table ka QR scan karo, order wahin aayega.'),
    yourTable: T('Your table', 'आपकी टेबल', 'Aapki table'),
    noTable: T('Takeaway / no table', 'पार्सल / कोई टेबल नहीं', 'Parcel / koi table nahi'),
    applyCoupon: T('Apply Coupon', 'कूपन लगाएँ', 'Coupon lagao'),
    apply: T('Apply', 'लगाएँ', 'Lagao'),
    remove: T('Remove', 'हटाएँ', 'Hatao'),
    couponPh: T('Enter coupon code', 'कूपन कोड डालें', 'Coupon code daalo'),
    invalidCoupon: T('Invalid coupon', 'यह कूपन सही नहीं है', 'Yeh coupon sahi nahi hai'),
    loyalty: T('Loyalty Rewards', 'अपने पॉइंट इस्तेमाल करें', 'Apne points use karo'),
    howPoints: T('How points work', 'पॉइंट कैसे काम करते हैं', 'Points kaise kaam karte hain'),
    howPointsText: T(
        'You earn points on every paid order. Pick a reward below to spend points on this order; the discount shows in the bill.',
        'हर पेड ऑर्डर पर आपको पॉइंट मिलते हैं। इस ऑर्डर पर पॉइंट खर्च करने के लिए नीचे कोई रिवॉर्ड चुनें; छूट बिल में दिखेगी।',
        'Har paid order pe aapko points milte hain. Is order pe points use karne ke liye neeche koi reward chuno; discount bill mein dikhega.'),
    ptsAvailable: T('{n} pts available', '{n} पॉइंट हैं', '{n} points hain'),
    nPoints: T('{n} points', '{n} पॉइंट', '{n} points'),
    noRewards: T('No rewards available at the moment.', 'अभी कोई रिवॉर्ड नहीं है।', 'Abhi koi reward nahi hai.'),
    seeAll: T('See all {n} rewards', 'सारे {n} रिवॉर्ड देखें', 'Saare {n} rewards dekho'),
    special: T('Special Instructions', 'कोई खास बात?', 'Koi special request?'),
    specialPh: T('Any special requests? (Optional)', 'कोई खास बात? (वैकल्पिक)', 'Koi special request? (optional)'),
    dontForget: T("Don't forget to add", 'यह भी जोड़ें?', 'Yeh bhi add karein?'),
    forgotWater: T('Forgot Water?', 'पानी भूल गए?', 'Paani bhool gaye?'),
    forgotSomething: T('Forgot Something?', 'कुछ भूल गए?', 'Kuch bhool gaye?'),
    upsellAdd: T('Add {name} - ₹{price}', '{name} जोड़ें - ₹{price}', '{name} add karo - ₹{price}'),
    milestone: T('This will be your {nth} order with us 🎉', 'यह हमारे साथ आपका {nth} ऑर्डर होगा 🎉', 'Yeh hamare saath aapka {nth} order hoga 🎉'),
    roundNumber: T('A round number! Thanks for being a regular.', 'राउंड नंबर! हमेशा आने के लिए शुक्रिया।', 'Round number! Regular aane ke liye thanks.'),
    comeBack: T('Thanks for coming back. Every order earns points.', 'फिर से आने के लिए शुक्रिया। हर ऑर्डर पर पॉइंट मिलते हैं।', 'Wapas aane ke liye thanks. Har order pe points milte hain.'),
    nudgePoints: T('You have enough points to save ₹{amt} on this order', 'आपके पॉइंट से इस ऑर्डर पर ₹{amt} बच सकते हैं', 'Aapke points se is order pe ₹{amt} bach sakte hain'),
    use: T('Use', 'इस्तेमाल करें', 'Use karo'),
    usingPoints: T('Using {n} points', '{n} पॉइंट इस्तेमाल हो रहे हैं', '{n} points use ho rahe hain'),
    enoughPoints: T('You have enough points to pay!', 'आपके पास काफ़ी पॉइंट हैं!', 'Aapke paas kaafi points hain!'),
    pointsSave: T('{name}: save ₹{amt} for {p} of your {total} points', '{name}: अपने {total} में से {p} पॉइंट देकर ₹{amt} बचाएँ', '{name}: apne {total} mein se {p} points dekar ₹{amt} bachao'),
    billSummary: T('Bill Summary', 'बिल', 'Bill summary'),
    subtotal: T('Subtotal', 'कुल (टैक्स से पहले)', 'Subtotal'),
    couponDiscount: T('Coupon Discount', 'कूपन छूट', 'Coupon discount'),
    pointsRow: T('Points ({n} pts)', 'पॉइंट से छूट ({n} पॉइंट)', 'Points ({n} points)'),
    member: T('{name} member {pct}%', '{name} मेंबर {pct}%', '{name} member {pct}%'),
    clubDiscount: T('Club discount', 'क्लब छूट', 'Club discount'),
    mrpTax: T('Tax included in MRP items', 'MRP वाले आइटम में टैक्स शामिल है', 'MRP items mein tax shaamil hai'),
    total: T('Total', 'कुल', 'Total'),
    placing: T('Placing Order...', 'ऑर्डर हो रहा है…', 'Order ho raha hai…'),
    placeOrder: T('Place Order • ₹{amt}', 'ऑर्डर करें · ₹{amt}', 'Order karo · ₹{amt}'),
    placeFailed: T('Failed to place order', 'ऑर्डर नहीं हो पाया', 'Order nahi ho paya'),
    ok: T('OK', 'ठीक है', 'OK'),
};

const Cart = () => {
    const navigate = useNavigate();
    const { lang, t } = useCxLang();
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
    const [allOffers, setAllOffers] = useState(false);
    const [selectedOffer, setSelectedOffer] = useState(null);
    const [usePoints, setUsePoints] = useState(false);
    // Points as cash (when the cafe allows it): one way per order, a deal or points as cash
    const [useCash, setUseCash] = useState(false);
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
                    usePoints && selectedOffer ? selectedOffer._id : null,
                    useCash && !(usePoints && selectedOffer));
                if (!cancelled) setQuote(res.data);
            } catch {
                if (!cancelled) setQuote(null);
            }
        }, 250);
        return () => { cancelled = true; clearTimeout(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cartKey, isAuthenticated, couponApplied, usePoints, selectedOffer, useCash]);

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
            setError(err.response?.data?.message || t(W.invalidCoupon));
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
            setError(t(W.emptyTitle));
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
                pointsCash: useCash && !(usePoints && selectedOffer),
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
            const msg = err.response?.data?.message || err.message || t(W.placeFailed);
            // The QR code was replaced or the table switched off: forget it so they can scan again
            if (/QR is no longer in use|not in use right now/.test(msg)) clearQrTable();
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    const subtotal = getCartTotal;

    // Points that can actually be used on this bill (never shown when they can't)
    const usableOffer = loyaltyPoints && loyaltyPoints.dealsOn !== false && !useCash && loyaltyOffers
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
                text: t(W.nudgePoints, { amt: Math.min(usableOffer.discountValue, subtotal).toFixed(0) }),
                action: { label: t(W.use), onClick: () => { setSelectedOffer(usableOffer); setUsePoints(true); } },
            });
        }
    }, [usableOffer?._id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (cart.length === 0) {
        return (
            <div className="cart-page">
                <Header title={t(W.cart)} showBack showCart={false} />
                <div className="empty-cart">
                    <div className="empty-cart-icon"><FiShoppingCart /></div>
                    <h2>{t(W.emptyTitle)}</h2>
                    <p>{t(W.emptyText)}</p>
                    <button onClick={() => navigate('/menu')} className="btn btn-primary">
                        {t(W.browse)}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="cart-page">
            <Header title={t(W.cart)} showBack showCart={false} />

            <div className="cart-content">
                {/* Search Bar */}
                <div className="cart-search-section">
                    <div className="cart-search-header">
                        <h3>{t(W.addMore)}</h3>
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
                                                <FiPlus /> {t(W.add)}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                isSearching && <div className="no-results">{t(W.noItems)}</div>
                            )}
                        </div>
                    )}
                </div>

                {/* Cart Items */}
                <div className="cart-section">
                    <h3 className="section-title">{t(W.yourItems)}</h3>
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
                                    <strong>{t(W.table, { n: qrTable.tableNumber })}
                                        <InfoTip label={t(W.aboutTable)}>{t(W.aboutTableText)}</InfoTip>
                                    </strong>
                                    <small>{t(W.comesHere)} · <button className="link-btn-sm" onClick={clearQrTable}>{t(W.takeawayInstead)}</button></small>
                                </span>
                            ) : (
                                <span className="tb-copy">
                                    <strong>{t(W.takeaway)}</strong>
                                    <small>{t(W.scanToServe)}</small>
                                </span>
                            )}
                        </div>
                    </div>
                )}
                {tableMode === 'pick' && (
                    <div className="cart-section">
                        <h3 className="section-title">{t(W.yourTable)}</h3>
                        <select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)} className="table-select">
                            <option value="">{t(W.noTable)}</option>
                            {tables.map(table => (
                                <option key={table._id} value={table._id}>{t(W.table, { n: table.tableNumber })}</option>
                            ))}
                        </select>
                    </div>
                )}

                {/* Coupon Section */}
                <div className="cart-section">
                    <h3 className="section-title">{t(W.applyCoupon)}</h3>
                    {couponApplied ? (
                        <div className="coupon-applied">
                            <div className="coupon-info">
                                <span className="coupon-code-tag">{couponApplied.code}</span>
                                <span className="coupon-discount">-₹{discount.toFixed(2)}</span>
                            </div>
                            <button onClick={removeCoupon} className="remove-coupon-btn">{t(W.remove)}</button>
                        </div>
                    ) : (
                        <>
                        {myCoupons.length > 0 && (
                            <div className="my-gifts">
                                {myCoupons.slice(0, 3).map(c => (
                                    <button key={c.code} type="button" className="my-gift" onClick={() => handleApplyCoupon(c.code)}>
                                        <span>{/birthday/i.test(c.title) ? '🎂' : '🎁'}</span>
                                        <span className="my-gift-text"><b>{sayReward(c.reward, lang)}</b><small>{c.title}</small></span>
                                        <span className="my-gift-apply">{t(W.apply)}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <div className="coupon-input-row">
                            <input
                                type="text"
                                value={couponCode}
                                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                                placeholder={t(W.couponPh)}
                                className="coupon-input"
                            />
                            <button onClick={handleApplyCoupon} className="apply-btn">
                                {t(W.apply)}
                            </button>
                        </div>
                        </>
                    )}
                </div>

                {/* Loyalty Points Section */}
                {isAuthenticated && loyaltyPoints && (
                    <div className="cart-section loyalty-section">
                        <div className="loyalty-header">
                            <h3 className="section-title"><FiAward /> {t(W.loyalty)}
                                <InfoTip label={t(W.howPoints)}>{t(W.howPointsText)}</InfoTip>
                            </h3>
                            <span className="points-balance">{t(W.ptsAvailable, { n: loyaltyPoints.currentPoints })}</span>
                        </div>

                        {loyaltyPoints.pointsAsCash && (() => {
                            const ratio = Number(loyaltyPoints.pointsToRupeeRatio) || 10;
                            const enough = loyaltyPoints.currentPoints >= (loyaltyPoints.minPointsToRedeem || 0);
                            const est = Math.floor(Math.min(loyaltyPoints.currentPoints / ratio, subtotal * (Number(loyaltyPoints.maxRedemptionPercent) || 100) / 100));
                            const amt = useCash && quote ? quote.offerDiscount : est;
                            const pts = useCash && quote ? quote.pointsUsed : Math.ceil(est * ratio);
                            return (
                                <button type="button" className={`loyalty-cash ${useCash ? 'on' : ''}`} disabled={!enough || est <= 0}
                                    onClick={() => { if (useCash) { setUseCash(false); } else { setUseCash(true); setSelectedOffer(null); setUsePoints(false); } }}>
                                    <span className="lc-icon" aria-hidden="true">🪙</span>
                                    <span className="lc-text">
                                        <b>{t(W.cashTitle)}</b>
                                        <small>{enough ? t(W.cashLine, { p: pts, amt: Number(amt).toFixed(0), max: loyaltyPoints.maxRedemptionPercent }) : t(W.cashNeed, { n: loyaltyPoints.minPointsToRedeem })}</small>
                                    </span>
                                    <span className="lc-btn">{useCash ? t(W.remove) : t(W.use)}</span>
                                </button>
                            );
                        })()}

                        {loyaltyPoints.dealsOn !== false && <div className="loyalty-offers-list">
                            {loyaltyOffers.length > 0 ? (
                                shortOfferList(loyaltyOffers, { keepId: selectedOffer?._id, showAll: allOffers }).list.map(offer => (
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
                                                    setUseCash(false);
                                                }
                                            }
                                        }}
                                    >
                                        <div className="offer-info">
                                            <span className="offer-name">{offer.name}</span>
                                            <span className="offer-cost"><FiAward /> {t(W.nPoints, { n: offer.pointsRequired })}</span>
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
                                <p className="no-offers-text">{t(W.noRewards)}</p>
                            )}
                            {!allOffers && shortOfferList(loyaltyOffers, { keepId: selectedOffer?._id }).hidden > 0 && (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllOffers(true)}>{t(W.seeAll, { n: loyaltyOffers.length })}</button>
                            )}
                        </div>}
                    </div>
                )}

                {/* Special Instructions */}
                <div className="cart-section">
                    <h3 className="section-title">{t(W.special)}</h3>
                    <textarea
                        value={specialInstructions}
                        onChange={(e) => setSpecialInstructions(e.target.value)}
                        placeholder={t(W.specialPh)}
                        className="instructions-input"
                        rows={2}
                    />
                </div>

                {/* Recommendations */}
                {recommendations.length > 0 && (
                    <div className="cart-section">
                        <h3 className="section-title">💡 {t(W.dontForget)}</h3>
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
                                            {t(W.addCaps)}
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
                                    <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{t(upsellItem.name.includes('Water') ? W.forgotWater : W.forgotSomething)}</h4>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t(W.upsellAdd, { name: upsellItem.name, price: upsellItem.price })}</span>
                                </div>
                            </div>
                            <button
                                onClick={() => addItem(upsellItem)}
                                className="btn btn-sm btn-outline-primary"
                                style={{ padding: '6px 12px', borderRadius: '20px', display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                                <FiPlus /> {t(W.add)}
                            </button>
                        </div>
                    </div>
                )}

                {/* Milestone: "this will be your 23rd order" */}
                {nth > 1 && show('nudgeMilestone') && (
                    <div className="cx-card milestone-card">
                        <span className="milestone-badge">#{nth}</span>
                        <span className="cx-card-copy">
                            <strong>{t(W.milestone, { nth: lang === 'hi' ? `${nth}वाँ` : ordinal(nth) })}</strong>
                            <small>{t(nth % 5 === 0 ? W.roundNumber : W.comeBack)}</small>
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
                            <strong>{usePoints && selectedOffer?._id === usableOffer._id ? t(W.usingPoints, { n: usableOffer.pointsRequired }) : t(W.enoughPoints)}</strong>
                            <small>{t(W.pointsSave, { name: usableOffer.name, amt: Math.min(usableOffer.discountValue, subtotal).toFixed(0), p: usableOffer.pointsRequired, total: loyaltyPoints.currentPoints })}</small>
                        </span>
                        <span className="pc-btn">{usePoints && selectedOffer?._id === usableOffer._id ? t(W.remove) : t(W.use)}</span>
                    </button>
                )}

                {/* Bill Summary */}
                <div className="cart-section bill-section">
                    <h3 className="section-title">{t(W.billSummary)}</h3>

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
                        <span>{t(W.subtotal)}</span>
                        <span>₹{subtotal.toFixed(2)}</span>
                    </div>
                    {(quote ? quote.couponDiscount : discount) > 0 && (
                        <div className="bill-row discount-row">
                            <span>{t(W.couponDiscount)}</span>
                            <span>-₹{(quote ? quote.couponDiscount : discount).toFixed(2)}</span>
                        </div>
                    )}
                    {(usePoints || useCash) && (quote ? quote.offerDiscount : pointsDiscount) > 0 && (
                        <div className="bill-row points-row">
                            <span><FiAward /> {t(W.pointsRow, { n: useCash && quote ? quote.pointsUsed : pointsUsed })}</span>
                            <span>-₹{(quote ? quote.offerDiscount : pointsDiscount).toFixed(2)}</span>
                        </div>
                    )}
                    {quote?.clubDiscount > 0 && (
                        <div className="bill-row discount-row">
                            <span>{[quote.club?.tierAmount > 0 && `${quote.club.tier} ${quote.club.tierPct}%`,
                                quote.club?.memberAmount > 0 && t(W.member, { name: quote.club.member, pct: quote.club.memberPct })].filter(Boolean).join(' + ') || t(W.clubDiscount)}</span>
                            <span>-₹{Number(quote.clubDiscount).toFixed(2)}</span>
                        </div>
                    )}
                    {quote ? quote.taxDetails.map(tx => (
                        <div className="bill-row" key={`${tx.name}-${tx.rate}`}>
                            <span>{tx.name} ({tx.rate}%)</span>
                            <span>₹{Number(tx.amount).toFixed(2)}</span>
                        </div>
                    )) : (
                        <div className="bill-row">
                            <span>GST ({gstRate}%)</span>
                            <span>₹{tax.toFixed(2)}</span>
                        </div>
                    )}
                    {quote && subtotal - shownDiscount + tax - total > 0.009 && (
                        <div className="bill-row muted-row">
                            <span>{t(W.mrpTax)}</span>
                            <span></span>
                        </div>
                    )}
                    <div className="bill-row total-row">
                        <span>{t(W.total)}</span>
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
                    {loading ? t(W.placing) : t(W.placeOrder, { amt: total.toFixed(2) })}
                </button>
            </div>

            {/* Error Popup Modal */}
            {error && (
                <div className="error-modal-overlay" onClick={() => setError('')}>
                    <div className="error-modal" onClick={e => e.stopPropagation()}>
                        <div className="error-icon"><FiAlertTriangle /></div>
                        <p className="error-text">{error}</p>
                        <button className="error-close-btn" onClick={() => setError('')}>
                            {t(W.ok)}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Cart;

