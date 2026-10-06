import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowRight } from 'react-icons/fi';
import { usePortal } from '../../context/PortalContext';
import { getImageUrl } from '../../utils/config';
import { BANNER_STYLES, bannerBg, bannerTx } from './palettes';
import Art from './Art';
import { ART_KINDS, artFor } from './artKinds';
import useCxLang, { T } from '../../lib/cxLang';

const W = { offers: T('Offers', 'ऑफ़र', 'Offers'), banner: T('Banner {n}', 'बैनर {n}', 'Banner {n}') };

// Where a banner's button goes
export const useBannerLink = () => {
    const navigate = useNavigate();
    return (b) => {
        switch (b.linkType) {
            case 'menu': return navigate('/menu');
            case 'category': return navigate(`/menu?category=${encodeURIComponent(b.linkTo)}`);
            case 'item': return navigate(`/item/${encodeURIComponent(b.linkTo)}`);
            case 'combo': return navigate(`/combo/${encodeURIComponent(b.linkTo)}`);
            case 'rewards': return navigate('/rewards');
            case 'url': return window.open(b.linkTo, '_blank', 'noopener');
            default: return undefined;
        }
    };
};

// A banner's words in the customer's language (titleHi / titleHg …), English when that one is empty
const say = (b, field, lang) => (lang === 'hi' && b[`${field}Hi`]) || (lang === 'hg' && b[`${field}Hg`]) || b[field] || '';

// Background: the owner's colour style, or the theme's own banner colour ("theme" or nothing picked)
const bannerLook = (b) => {
    if (b?.style && BANNER_STYLES[b.style]) return { background: bannerBg(b), color: bannerTx(b) };
    return { background: 'var(--cx-ban)', color: 'var(--cx-ban-tx)' };
};

export const BannerSlide = ({ b, onOpen }) => {
    const { lang } = useCxLang();
    const tag = say(b, 'tag', lang), title = say(b, 'title', lang), text = say(b, 'text', lang), cta = say(b, 'cta', lang);
    // no picture chosen: guess one from the linked dish or the headline
    const guess = artFor({ name: `${b.item?.name || ''} ${b.title || ''}` });
    const art = ART_KINDS.includes(b.art) ? b.art : (guess !== 'plate' ? guess : null);
    const link = b.linkType && b.linkType !== 'none';
    return (
        <div className={`banner-slide ${b.image ? 'has-image' : ''} ${link ? 'is-link' : ''}`}
            style={b.image ? { backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.08)), url(${getImageUrl(b.image)})`, color: '#fff' }
                : bannerLook(b)}
            role={link ? 'button' : undefined} tabIndex={link ? 0 : undefined}
            onKeyDown={link ? (e) => { if (e.key === 'Enter') onOpen?.(b); } : undefined}
            onClick={link ? () => onOpen?.(b) : undefined}>
            <div className="banner-copy">
                {tag && <span className="banner-tag">{tag}</span>}
                {title && <h2 className="banner-title">{title}</h2>}
                {text && <p className="banner-text">{text}</p>}
                {cta && link && <span className="banner-cta">{cta} <FiArrowRight aria-hidden="true" /></span>}
            </div>
            {!b.image && (b.item?.image && !art
                ? <img className="banner-item-img" src={getImageUrl(b.item.image)} alt="" />
                : <Art kind={art || 'frappe'} className="banner-art" />)}
        </div>
    );
};

// The owner's banners at the top of the home page: swipe, or they move on by themselves every 5 seconds
const BannerCarousel = ({ className = '' }) => {
    const { cfg } = usePortal();
    const { t } = useCxLang();
    const open = useBannerLink();
    const banners = cfg?.banners || [];
    const [i, setI] = useState(0);
    const track = useRef();
    const paused = useRef(false);

    useEffect(() => {
        if (banners.length < 2 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
        const t = setInterval(() => {
            if (paused.current || document.hidden) return;
            const el = track.current;
            if (!el) return;
            const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % banners.length;
            el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
        }, 5000);
        return () => clearInterval(t);
    }, [banners.length]);

    if (!banners.length) return null;
    return (
        <section className={`banners ${className}`} aria-label={t(W.offers)}
            onPointerDown={() => { paused.current = true; }} onPointerUp={() => { setTimeout(() => { paused.current = false; }, 4000); }}>
            <div className="banner-track hide-scrollbar" ref={track}
                onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
                {banners.map(b => <BannerSlide key={b.id} b={b} onOpen={open} />)}
            </div>
            {banners.length > 1 && (
                <div className="banner-dots">
                    {banners.map((b, n) => (
                        <button key={b.id} aria-label={t(W.banner, { n: n + 1 })} className={n === i ? 'on' : ''}
                            onClick={() => track.current?.scrollTo({ left: n * track.current.clientWidth, behavior: 'smooth' })} />
                    ))}
                </div>
            )}
        </section>
    );
};

export default BannerCarousel;
