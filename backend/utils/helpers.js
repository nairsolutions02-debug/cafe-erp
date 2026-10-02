// Generate 6-digit OTP
const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

// Generate order number
const generateOrderNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `CD-${timestamp}-${random}`;
};

// Calculate discount
const calculateDiscount = (coupon, items, subtotal) => {
    if (!coupon) return 0;

    // Check if coupon is applicable to items
    let applicableTotal = subtotal;

    if (coupon.applicableItems && coupon.applicableItems.length > 0) {
        applicableTotal = items
            .filter(item => coupon.applicableItems.includes(item.menuItem.toString()))
            .reduce((sum, item) => sum + item.total, 0);
    }

    if (coupon.applicableCategories && coupon.applicableCategories.length > 0) {
        // This would need category info from items - handled at controller level
    }

    if (applicableTotal < coupon.minOrderAmount) {
        return 0;
    }

    let discount = 0;
    if (coupon.discountType === 'percentage') {
        discount = (applicableTotal * coupon.discountValue) / 100;
        if (coupon.maxDiscount && discount > coupon.maxDiscount) {
            discount = coupon.maxDiscount;
        }
    } else {
        discount = coupon.discountValue;
    }

    return Math.min(discount, subtotal);
};

// Format date for display
const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
};

// Get date range for analytics
const getDateRange = (period) => {
    const now = new Date();
    let startDate;

    switch (period) {
        case 'today':
            startDate = new Date(now.setHours(0, 0, 0, 0));
            break;
        case 'week':
            startDate = new Date(now.setDate(now.getDate() - 7));
            break;
        case 'month':
            startDate = new Date(now.setMonth(now.getMonth() - 1));
            break;
        case 'year':
            startDate = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
        default:
            startDate = new Date(now.setDate(now.getDate() - 30));
    }

    return startDate;
};

module.exports = {
    generateOTP,
    generateOrderNumber,
    calculateDiscount,
    formatDate,
    getDateRange
};
