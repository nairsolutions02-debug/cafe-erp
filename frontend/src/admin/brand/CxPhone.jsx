import React, { useEffect } from 'react';
import { FiBell, FiSearch, FiSliders, FiHome, FiGrid, FiHeart, FiShoppingBag, FiUser, FiStar } from 'react-icons/fi';
import Art from '../../components/cx/Art';
import { cxVars, loadCxFonts, normaliseLook, themeOf } from '../../lib/cxThemes';
import { bannerBg, bannerTx } from '../../components/cx/palettes';
import { getImageUrl } from '../../utils/config';

// A small customer home screen drawn with a theme, for the owner's Look & themes page.
// Self-contained on purpose: it never loads the real customer pages.
const CARDS = [['iced', 'Iced Caramel Latte', '₹220', true], ['latte', 'Velvet Cappuccino', '₹160', false]];

const CxPhone = ({ themeKey, look, banner }) => {
    const l = normaliseLook(look);
    const theme = themeOf(themeKey, l);
    useEffect(() => { loadCxFonts([theme.fb, l.headingFont || theme.fh]); }, [theme.fb, theme.fh, l.headingFont]);
    const glass = theme.glass && l.glass > 0;
    const b = banner || { tag: 'Today only', title: '2 for ₹299', text: 'Any two iced coffees', cta: 'Order now', art: 'iced', style: '' };
    const banStyle = b.image ? { backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.6), rgba(0,0,0,.05)), url(${getImageUrl(b.image)})`, color: '#fff' }
        : b.style ? { background: bannerBg(b), color: bannerTx(b) } : { background: 'var(--cx-ban)', color: 'var(--cx-ban-tx)' };
    return (
        <div className={`cxp${glass ? ' glass' : ''}${theme.dark ? ' dark' : ''} nav-${l.nav}`} style={cxVars(theme, l)} aria-label={`Preview: ${theme.name.en}`}>
            <div className="cxp-screen">
                <div className="cxp-status"><b>9:41</b><span className="cxp-notch" /><span className="cxp-bat" /></div>
                <div className="cxp-head">
                    <span className="cxp-av">P</span>
                    <span className="cxp-hi"><small>Good evening · Table 4</small><b>Pravin</b></span>
                    <span className="cxp-bell cxp-card"><FiBell /></span>
                </div>
                <div className="cxp-search">
                    <span className="cxp-card"><FiSearch /> Search coffee, chai, bites…</span>
                    <span className="cxp-filter"><FiSliders /></span>
                </div>
                <div className="cxp-ban" style={banStyle}>
                    <div className="cxp-ban-copy">
                        {b.tag && <small>{b.tag}</small>}
                        {b.title && <b>{b.title}</b>}
                        {b.text && <span>{b.text}</span>}
                        {b.cta && b.linkType !== 'none' && <em>{b.cta}</em>}
                    </div>
                    {!b.image && b.art && <Art kind={b.art} className="cxp-ban-art" />}
                </div>
                <div className="cxp-dots"><i className="on" /><i /><i /></div>
                <div className="cxp-chips"><span className="on">All</span><span className="cxp-card">Hot</span><span className="cxp-card">Cold</span><span className="cxp-card">Bites</span></div>
                <div className="cxp-title"><b>Popular now</b><small>See all</small></div>
                <div className="cxp-grid">
                    {CARDS.map(([art, name, price, best]) => (
                        <div key={name} className="cxp-item cxp-card">
                            <div className="cxp-pic"><Art kind={art} />{best && <span className="cxp-badge">Bestseller</span>}<span className="cxp-heart"><FiHeart /></span></div>
                            <b>{name}</b>
                            <span className="cxp-meta"><FiStar /> 4.8</span>
                            <span className="cxp-row"><strong>{price}</strong><span className="cxp-add">+</span></span>
                        </div>
                    ))}
                </div>
                <nav className="cxp-nav">
                    {[[FiHome, 'Home'], [FiGrid, 'Menu'], [FiHeart, 'Saved'], [FiShoppingBag, 'Cart'], [FiUser, 'Me']].map(([I, n], i) => (
                        <span key={n} className={i === 0 ? 'on' : ''}>{React.createElement(I)}{n}</span>
                    ))}
                </nav>
            </div>
        </div>
    );
};

export default CxPhone;
