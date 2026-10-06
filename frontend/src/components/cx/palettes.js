// Banner (and combo) background styles the owner picks from. A photo, when there is one, covers the background.
//   theme = the customer's current theme colour (--cx-ban), so it changes with the look
export const BANNER_STYLES = {
    saffron: { label: 'Saffron', bg: 'linear-gradient(135deg, #F59E0B, #C2410C)' },
    latte: { label: 'Latte', bg: 'linear-gradient(120deg, #FFD6A8, #F6A65A)', tx: '#3B2416' },
    espresso: { label: 'Espresso', bg: 'linear-gradient(120deg, #3A2418, #C98A4B)' },
    matcha: { label: 'Matcha', bg: 'linear-gradient(120deg, #9BBF7E, #4D7C3A)' },
    berry: { label: 'Berry', bg: 'linear-gradient(135deg, #DB2777, #7C3AED)' },
    ocean: { label: 'Ocean', bg: 'linear-gradient(120deg, #0EA5E9, #14B8A6)' },
    nightgold: { label: 'Night gold', bg: 'linear-gradient(120deg, #2A2312, #0B0B0F)', tx: '#F3D27A' },
    chai: { label: 'Chai', bg: 'linear-gradient(120deg, #C2410C, #7C2D12)' },
    leaf: { label: 'Leaf', bg: 'linear-gradient(135deg, #16A34A, #065F46)' },
    sky: { label: 'Sky', bg: 'linear-gradient(135deg, #0EA5E9, #1D4ED8)' },
    cocoa: { label: 'Cocoa', bg: 'linear-gradient(135deg, #92400E, #3E2A14)' },
    night: { label: 'Night', bg: 'linear-gradient(135deg, #334155, #0F172A)' },
    theme: { label: 'Theme colour', bg: 'var(--cx-ban, linear-gradient(135deg, #F59E0B, #C2410C))', tx: 'var(--cx-ban-tx, #FFFFFF)' },
};
export const bannerBg = (b) => (BANNER_STYLES[b?.style] || BANNER_STYLES.saffron).bg;
// Text colour on that background (white unless the style says otherwise)
export const bannerTx = (b) => (BANNER_STYLES[b?.style] || BANNER_STYLES.saffron).tx || '#FFFFFF';
