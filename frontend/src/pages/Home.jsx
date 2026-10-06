import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiArrowRight, FiSearch, FiSliders, FiClock } from 'react-icons/fi';
import Header from '../components/Header';
import Footer from '../components/Footer';
import CategoryCard from '../components/CategoryCard';
import MenuCard from '../components/MenuCard';
import MenuCardSkeleton from '../components/MenuCardSkeleton';
import { getCategories, getCollections, getBestsellers, getMenuItems } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import FloatingCartBtn from '../components/FloatingCartBtn';
import './Home.css';
import { useBrand } from '../context/BrandContext';
import { usePortal } from '../context/PortalContext';
import AnnouncementStrip from '../components/cx/AnnouncementStrip';
import BannerCarousel from '../components/cx/BannerCarousel';
import RewardBar from '../components/cx/RewardBar';
import CombosRow from '../components/cx/CombosRow';
import TableChip from '../components/cx/TableChip';
import { LangButton } from '../components/cx/LangPicker';
import Art from '../components/cx/Art';
import useCxLang, { T } from '../lib/cxLang';

const W = {
    morning: T('Good morning', 'सुप्रभात', 'Good morning'),
    afternoon: T('Good afternoon', 'नमस्ते', 'Good afternoon'),
    evening: T('Good evening', 'शुभ संध्या', 'Good evening'),
    guest: T('Welcome', 'स्वागत है', 'Welcome'),
    search: T('Search coffee, chai, bites…', 'कॉफ़ी, चाय, नाश्ता खोजें…', 'Coffee, chai, nashta dhoondho…'),
    searchLabel: T('Search the menu', 'मेन्यू में खोजें', 'Menu mein dhoondho'),
    filters: T('All dishes and filters', 'सारे आइटम और फ़िल्टर', 'Saare items aur filter'),
    history: T('Order history', 'पुराने ऑर्डर', 'Purane order'),
    explore: T('Explore menu', 'मेन्यू देखें', 'Menu dekho'),
    all: T('All', 'सब', 'Sab'),
    popular: T('Popular now', 'अभी सबसे पसंदीदा', 'Abhi sabse popular'),
    seeAll: T('See all', 'सब देखें', 'Sab dekho'),
    categories: T('Categories', 'कैटेगरी', 'Categories'),
};

const greetingWord = () => {
    const h = new Date().getHours();
    return h < 12 ? W.morning : h < 17 ? W.afternoon : W.evening;
};

const Home = () => {
    const brand = useBrand();
    const { lang, t } = useCxLang();
    const { user } = useAuth();
    const navigate = useNavigate();
    const { cfg } = usePortal();
    const hasBanners = (cfg?.banners || []).length > 0;
    const [categories, setCategories] = useState([]);
    const [collections, setCustomCollections] = useState([]);
    const [popular, setPopular] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const [catRes, colRes, bestRes] = await Promise.all([
                    getCategories(), getCollections(true), getBestsellers().catch(() => ({ data: [] })),
                ]);
                if (!live) return;
                setCategories(catRes.data);
                setCustomCollections(colRes.data);
                let pop = bestRes.data || [];
                if (pop.length < 4) {
                    const more = await getMenuItems().then(r => r.data).catch(() => []);
                    pop = [...pop, ...more.filter(m => !pop.some(p => p._id === m._id))];
                }
                if (live) setPopular(pop.slice(0, 8));
            } catch (error) {
                console.error('Error fetching data:', error);
            } finally {
                if (live) setLoading(false);
            }
        })();
        return () => { live = false; };
    }, []);

    const name = user?.role === 'customer' ? (user?.name || '').trim() : '';
    const first = name.split(/\s+/)[0];
    const search = (e) => {
        e.preventDefault();
        navigate(q.trim() ? `/menu?search=${encodeURIComponent(q.trim())}` : '/menu');
    };

    return (
        <div className="home-page">
            <Header home />

            <div className="home-wrap">
                {/* Phone: greeting, table, language, history (the laptop has these in the top bar) */}
                <div className="home-greet">
                    <Link to="/profile" className="cx-av" aria-label={name || t(W.guest)}>
                        {first ? first.charAt(0).toUpperCase() : (brand.name || 'C').charAt(0)}
                    </Link>
                    <div className="home-greet-t">
                        <small>{t(greetingWord())}</small>
                        <b className="cx-h">{first || t(W.guest)}</b>
                    </div>
                    <div className="home-greet-act">
                        <TableChip />
                        <LangButton />
                        <Link to="/history" className="cx-ib cx-glass" aria-label={t(W.history)} title={t(W.history)}><FiClock /></Link>
                    </div>
                </div>

                <form className="home-search" onSubmit={search} role="search">
                    <label className="home-search-in cx-glass">
                        <FiSearch aria-hidden="true" />
                        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t(W.search)} aria-label={t(W.searchLabel)} />
                    </label>
                    <Link to="/menu" className="cx-ib cx-pri home-filter" aria-label={t(W.filters)} title={t(W.filters)}><FiSliders /></Link>
                </form>

                <AnnouncementStrip />

                <div className="home-hero">
                    {first && <p className="home-hero-hi">{t(greetingWord())}, {first}</p>}
                    <BannerCarousel />
                    {/* No banners yet: a welcome card in the theme's banner colour */}
                    {!hasBanners && (
                        <Link to="/menu" className="banner-slide home-welcome" style={{ background: 'var(--cx-ban)', color: 'var(--cx-ban-tx)' }}>
                            <div className="banner-copy">
                                {brand.heroBadge && <span className="banner-tag">{brand.heroBadge}</span>}
                                <h2 className="banner-title">{brand.name}</h2>
                                {brand.heroText && <p className="banner-text">{brand.heroText}</p>}
                                <span className="banner-cta">{t(W.explore)} <FiArrowRight aria-hidden="true" /></span>
                            </div>
                            <Art kind="frappe" className="banner-art" />
                        </Link>
                    )}
                </div>

                {categories.length > 0 && (
                    <nav className="home-cats cx-scroll-x" aria-label={t(W.categories)}>
                        <Link to="/menu" className="cx-chip on category-card cx-all">{t(W.all)}</Link>
                        {categories.map(cat => (
                            <CategoryCard key={cat._id} category={cat} onClick={(id) => navigate(`/menu?category=${id}`)} />
                        ))}
                    </nav>
                )}

                <RewardBar />

                <CombosRow />

                <section className="home-sec">
                    <div className="cx-shead">
                        <h2>{t(W.popular)}</h2>
                        <Link to="/menu">{t(W.seeAll)} <FiArrowRight aria-hidden="true" /></Link>
                    </div>
                    <div className="home-grid">
                        {loading ? [0, 1, 2, 3].map(i => <MenuCardSkeleton key={i} />)
                            : popular.map(item => <MenuCard key={item._id} item={item} />)}
                    </div>
                </section>

                {/* The owner's collections (Admin → Collections) */}
                {collections.map(collection => (
                    collection.products?.length > 0 && (
                        <section key={collection._id} className={`home-sec collection-${collection.type}`}>
                            <div className="cx-shead">
                                <h2>{lang === 'hi' && collection.nameHi ? collection.nameHi : collection.name}</h2>
                                <Link to={`/menu?collection=${collection.slug}`}>{t(W.seeAll)} <FiArrowRight aria-hidden="true" /></Link>
                            </div>
                            {collection.type === 'recommended' ? (
                                <div className="home-grid">
                                    {collection.products.map(item => <MenuCard key={item._id} item={item} />)}
                                </div>
                            ) : (
                                <div className="home-row cx-scroll-x">
                                    {collection.products.map(item => (
                                        <div key={item._id} className="home-row-item"><MenuCard item={item} /></div>
                                    ))}
                                </div>
                            )}
                        </section>
                    )
                ))}
            </div>

            <FloatingCartBtn />
            <Footer />
        </div>
    );
};

export default Home;
