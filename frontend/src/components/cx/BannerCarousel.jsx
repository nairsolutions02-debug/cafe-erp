import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowRight } from 'react-icons/fi';
import { usePortal } from '../../context/PortalContext';
import { getImageUrl } from '../../utils/config';
import { bannerBg } from './palettes';
import useCxLang, { T } from '../../lib/cxLang';

const W = { offers: T('Offers', 'ऑफ़र', 'Offers'), banner: T('Banner {n}', 'बैनर {n}', 'Banner {n}') };

// Where a banner's button goes
export const useBannerLink = () => {
    const navigate = useNavigate();
    return (b) => {
        switch (b.linkType) {
            case 'menu': return navigate('/menu');
            case 'category': return navigate(`/menu?category=${encodeURIComponent(b.linkTo)}`);
            case 'item': return navigate(`/menu?item=${encodeURIComponent(b.linkTo)}`);
            case 'rewards': return navigate('/rewards');
            case 'url': return window.open(b.linkTo, '_blank', 'noopener');
            default: return undefined;
        }
    };
};

export const BannerSlide = ({ b, onOpen }) => (
    <div className={`banner-slide ${b.image ? 'has-image' : ''}`}
        style={b.image ? { backgroundImage: `linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.08)), url(${getImageUrl(b.image)})` }
            : { background: bannerBg(b) }}
        onClick={b.linkType && b.linkType !== 'none' ? () => onOpen?.(b) : undefined}>
        <div className="banner-copy">
            {b.tag && <span className="banner-tag">{b.tag}</span>}
            {b.title && <h2 className="banner-title">{b.title}</h2>}
            {b.text && <p className="banner-text">{b.text}</p>}
            {b.cta && b.linkType !== 'none' && <span className="banner-cta">{b.cta} <FiArrowRight /></span>}
        </div>
        {!b.image && b.item?.image && <img className="banner-item-img" src={getImageUrl(b.item.image)} alt="" />}
    </div>
);

// The owner's banners at the top of the home page: swipe, or they move on by themselves every 5 seconds
const BannerCarousel = () => {
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
        <section className="banners" aria-label={t(W.offers)}
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
