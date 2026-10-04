// Banner colour styles the owner picks from (used when a banner has no picture)
export const BANNER_STYLES = {
    saffron: { label: 'Saffron', bg: 'linear-gradient(135deg, #F59E0B, #C2410C)' },
    leaf: { label: 'Leaf', bg: 'linear-gradient(135deg, #16A34A, #065F46)' },
    berry: { label: 'Berry', bg: 'linear-gradient(135deg, #DB2777, #7C3AED)' },
    sky: { label: 'Sky', bg: 'linear-gradient(135deg, #0EA5E9, #1D4ED8)' },
    cocoa: { label: 'Cocoa', bg: 'linear-gradient(135deg, #92400E, #3E2A14)' },
    night: { label: 'Night', bg: 'linear-gradient(135deg, #334155, #0F172A)' },
};
export const bannerBg = (b) => (BANNER_STYLES[b?.style] || BANNER_STYLES.saffron).bg;
