import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FiGrid, FiList, FiSearch, FiAlertCircle, FiCheck, FiX } from 'react-icons/fi';
import Header from '../components/Header';
import CategoryCard from '../components/CategoryCard';
import MenuCard from '../components/MenuCard';
import MenuCardSkeleton from '../components/MenuCardSkeleton';
import { getCategories, getMenuItems } from '../utils/api';
import FloatingCartBtn from '../components/FloatingCartBtn';
import { usePortal } from '../context/PortalContext';
import AnnouncementStrip from '../components/cx/AnnouncementStrip';
import BannerCarousel from '../components/cx/BannerCarousel';
import CombosRow from '../components/cx/CombosRow';
import './Menu.css';

import useCxLang, { T } from '../lib/cxLang';

const ITEMS_PER_PAGE = 10;

const W = {
    menu: T('Menu', 'मेन्यू', 'Menu'),
    hints: T(
        ['Search for Masala Dosa...', 'Try our famous Idli...', 'Looking for Vada?', 'Search Uttapam...', 'Find your favorite dish...'],
        ['मसाला डोसा खोजें...', 'हमारी मशहूर इडली चखें...', 'वड़ा चाहिए?', 'उत्तपम खोजें...', 'अपनी पसंद की डिश खोजें...'],
        ['Masala Dosa dhoondho...', 'Hamari famous Idli try karo...', 'Vada chahiye?', 'Uttapam dhoondho...', 'Apni favourite dish dhoondho...'],
    ),
    searchLabel: T('Search the menu…', 'मेन्यू में खोजें…', 'Menu mein dhoondho…'),
    all: T('All', 'सब', 'Sab'),
    noItems: T('No items found', 'कोई आइटम नहीं मिला', 'Koi item nahi mila'),
    tryOther: T('Try selecting a different category', 'कोई दूसरी कैटेगरी चुनकर देखें', 'Koi aur category choose karke dekho'),
    seenAll: T("You've seen all items!", 'आपने सारे आइटम देख लिए!', 'Saare items dekh liye!'),
    categories: T('Categories', 'कैटेगरी', 'Categories'),
    grid: T('Show as tiles', 'टाइल में दिखाएँ', 'Tiles mein dikhao'),
    list: T('Show as a list', 'लिस्ट में दिखाएँ', 'List mein dikhao'),
    clear: T('Clear search', 'खोज हटाएँ', 'Search hatao'),
    count: T('{n} dishes', '{n} आइटम', '{n} items'),
};

const LAYOUT_KEY = 'cx-menu-layout';
const readLayout = () => { try { return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };

const Menu = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const [categories, setCategories] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [allItems, setAllItems] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
    const [menuSearch, setMenuSearch] = useState(searchParams.get('search') || '');
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [page, setPage] = useState(1);
    const { show } = usePortal();
    const { t } = useCxLang();
    const navigate = useNavigate();
    const [layout, setLayout] = useState(readLayout);
    const pickLayout = (l) => { setLayout(l); try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* private mode */ } };

    // Old links to a dish (/menu?item=<id>) open the dish page
    const itemParam = searchParams.get('item');
    useEffect(() => {
        if (itemParam) navigate(`/item/${encodeURIComponent(itemParam)}`, { replace: true });
    }, [itemParam, navigate]);

    // Combos in the top bar (/menu?view=combos): scroll to the combos strip
    const view = searchParams.get('view');
    const combosRef = useRef();
    useEffect(() => {
        if (view !== 'combos') return undefined;
        const tm = setTimeout(() => combosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
        return () => clearTimeout(tm);
    }, [view]);

    // Intersection Observer ref
    const observerRef = useRef();
    const loadMoreRef = useRef();

    // Debounce timer ref
    const debounceRef = useRef();

    useEffect(() => {
        fetchCategories();
    }, []);

    // Debounced search effect
    useEffect(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            setPage(1);
            setMenuItems([]);
            fetchMenuItems(true);
        }, 300);

        return () => {
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [selectedCategory, searchParams]);

    // Intersection Observer for infinite scroll
    useEffect(() => {
        if (loading || loadingMore) return;

        if (observerRef.current) {
            observerRef.current.disconnect();
        }

        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !loadingMore) {
                    loadMoreItems();
                }
            },
            { threshold: 0.1 }
        );

        if (loadMoreRef.current) {
            observerRef.current.observe(loadMoreRef.current);
        }

        return () => {
            if (observerRef.current) {
                observerRef.current.disconnect();
            }
        };
    }, [loading, loadingMore, hasMore, allItems]);

    const fetchCategories = async () => {
        try {
            const res = await getCategories();
            setCategories(res.data);
        } catch (error) {
            console.error('Error fetching categories:', error);
        }
    };

    const fetchMenuItems = async (isNewFetch = false) => {
        if (isNewFetch) {
            setLoading(true);
        }

        try {
            const params = {};
            if (selectedCategory) params.category = selectedCategory;
            if (searchParams.get('bestseller')) params.bestseller = 'true';
            if (searchParams.get('isNew')) params.isNew = 'true';
            if (searchParams.get('search')) params.search = searchParams.get('search');

            const res = await getMenuItems(params);
            const fetchedItems = res.data;

            setAllItems(fetchedItems);

            // Show first chunk
            const firstChunk = fetchedItems.slice(0, ITEMS_PER_PAGE);
            setMenuItems(firstChunk);
            setHasMore(fetchedItems.length > ITEMS_PER_PAGE);
            setPage(1);
        } catch (error) {
            console.error('Error fetching menu items:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadMoreItems = useCallback(() => {
        if (loadingMore || !hasMore) return;

        setLoadingMore(true);

        // Simulate a small delay for smooth UX
        setTimeout(() => {
            const nextPage = page + 1;
            const startIndex = page * ITEMS_PER_PAGE;
            const endIndex = startIndex + ITEMS_PER_PAGE;
            const nextChunk = allItems.slice(startIndex, endIndex);

            if (nextChunk.length > 0) {
                setMenuItems(prev => [...prev, ...nextChunk]);
                setPage(nextPage);
                setHasMore(endIndex < allItems.length);
            } else {
                setHasMore(false);
            }

            setLoadingMore(false);
        }, 300);
    }, [page, allItems, loadingMore, hasMore]);

    const handleCategoryClick = (categoryId) => {
        if (selectedCategory === categoryId) {
            setSelectedCategory('');
            setSearchParams({});
        } else {
            setSelectedCategory(categoryId);
            setSearchParams({ category: categoryId });
        }
    };

    // Debounced search handler
    const handleSearchChange = (e) => {
        const value = e.target.value;
        setMenuSearch(value);

        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            if (value) {
                setSearchParams({ search: value });
            } else {
                setSearchParams({});
            }
        }, 300);
    };

    // Animated placeholder for search
    const placeholderTexts = t(W.hints);
    const [placeholderIndex, setPlaceholderIndex] = React.useState(0);
    const [displayPlaceholder, setDisplayPlaceholder] = React.useState('');
    const [isTyping, setIsTyping] = React.useState(true);

    React.useEffect(() => {
        const currentText = placeholderTexts[placeholderIndex % placeholderTexts.length] || '';
        const charIndex = displayPlaceholder.length;

        const timer = setTimeout(() => {
            if (isTyping) {
                if (charIndex < currentText.length) {
                    setDisplayPlaceholder(currentText.slice(0, charIndex + 1));
                } else {
                    setTimeout(() => setIsTyping(false), 2000);
                }
            } else {
                if (charIndex > 0) {
                    setDisplayPlaceholder(currentText.slice(0, charIndex - 1));
                } else {
                    setPlaceholderIndex((prev) => (prev + 1) % placeholderTexts.length);
                    setIsTyping(true);
                }
            }
        }, isTyping ? 100 : 50);

        return () => clearTimeout(timer);
    }, [displayPlaceholder, isTyping, placeholderIndex]);

    // Render skeleton loaders
    const renderSkeletons = (count = 6) => {
        return Array(count).fill(0).map((_, index) => (
            <MenuCardSkeleton key={`skeleton-${index}`} />
        ));
    };

    const filtered = !!selectedCategory || !!searchParams.get('search');

    return (
        <div className="menu-page">
            <Header title={t(W.menu)} showBack />

            <div className="menu-wrap">
                <AnnouncementStrip />

                {/* Search + tiles / list */}
                <div className="menu-search-container">
                    <label className="menu-search-bar cx-glass">
                        <FiSearch className="menu-search-icon" aria-hidden="true" />
                        <input
                            type="search"
                            placeholder={displayPlaceholder}
                            aria-label={t(W.searchLabel)}
                            value={menuSearch}
                            onChange={handleSearchChange}
                            className="menu-search-input"
                        />
                        {menuSearch && (
                            <button type="button" className="menu-search-clear" aria-label={t(W.clear)}
                                onClick={() => handleSearchChange({ target: { value: '' } })}><FiX /></button>
                        )}
                    </label>
                    <div className="menu-layout cx-glass" role="group">
                        <button type="button" className={layout === 'grid' ? 'on' : ''} aria-pressed={layout === 'grid'} aria-label={t(W.grid)} title={t(W.grid)} onClick={() => pickLayout('grid')}><FiGrid /></button>
                        <button type="button" className={layout === 'list' ? 'on' : ''} aria-pressed={layout === 'list'} aria-label={t(W.list)} title={t(W.list)} onClick={() => pickLayout('list')}><FiList /></button>
                    </div>
                </div>

                {/* Category chips, stuck under the top bar while scrolling */}
                <nav className="categories-container" aria-label={t(W.categories)}>
                    <div className="cx-scroll-x menu-cats">
                        <button type="button" className={`cx-chip cx-glass category-card cx-all ${!selectedCategory ? 'on' : ''}`}
                            aria-pressed={!selectedCategory} onClick={() => handleCategoryClick('')}>
                            {t(W.all)}
                        </button>
                        {categories.map(cat => (
                            <CategoryCard
                                key={cat._id}
                                category={cat}
                                isActive={selectedCategory === cat._id}
                                onClick={handleCategoryClick}
                            />
                        ))}
                    </div>
                </nav>

                {!filtered && <BannerCarousel className="menu-banners" />}
                {!filtered && <div ref={combosRef} id="combos" className="menu-combos"><CombosRow /></div>}

                {/* Menu Items Grid */}
                <div className="menu-items-container">
                    {!loading && allItems.length > 0 && <p className="menu-count">{t(W.count, { n: allItems.length })}</p>}
                    {loading ? (
                        <div className={`menu-grid ${layout === 'list' ? 'is-list' : ''}`}>
                            {renderSkeletons(6)}
                        </div>
                    ) : menuItems.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon"><FiAlertCircle /></div>
                            <p className="empty-state-title">{t(W.noItems)}</p>
                            <p className="empty-state-text">{t(W.tryOther)}</p>
                        </div>
                    ) : (
                        <>
                            <div className={`menu-grid ${layout === 'list' ? 'is-list' : ''} ${show('photos') ? '' : 'no-photos'}`}>
                                {menuItems.map(item => (
                                    <MenuCard key={item._id} item={item} layout={layout} />
                                ))}

                                {/* Loading more skeletons */}
                                {loadingMore && renderSkeletons(2)}
                            </div>

                            {/* Intersection Observer trigger element */}
                            {hasMore && (
                                <div
                                    ref={loadMoreRef}
                                    className="load-more-trigger"
                                    style={{ height: '20px', margin: '20px 0' }}
                                />
                            )}

                            {/* End of list indicator */}
                            {!hasMore && menuItems.length > ITEMS_PER_PAGE && (
                                <div className="end-of-list">
                                    <span><FiCheck /> {t(W.seenAll)}</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Floating Cart Button */}
            <FloatingCartBtn />
        </div>
    );
};

export default Menu;
