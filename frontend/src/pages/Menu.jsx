import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiGrid, FiSearch, FiAlertCircle, FiCheck } from 'react-icons/fi';
import Header from '../components/Header';
import CategoryCard from '../components/CategoryCard';
import MenuCard from '../components/MenuCard';
import MenuCardSkeleton from '../components/MenuCardSkeleton';
import { getCategories, getMenuItems } from '../utils/api';
import FloatingCartBtn from '../components/FloatingCartBtn';
import './Menu.css';

const ITEMS_PER_PAGE = 10;

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
    const placeholderTexts = [
        "Search for Masala Dosa...",
        "Try our famous Idli...",
        "Looking for Vada?",
        "Search Uttapam...",
        "Find your favorite dish...",
    ];
    const [placeholderIndex, setPlaceholderIndex] = React.useState(0);
    const [displayPlaceholder, setDisplayPlaceholder] = React.useState('');
    const [isTyping, setIsTyping] = React.useState(true);

    React.useEffect(() => {
        const currentText = placeholderTexts[placeholderIndex];
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

    return (
        <div className="menu-page">
            <Header title="Menu" showBack />

            {/* Search Bar */}
            <div className="menu-search-container">
                <div className="menu-search-bar">
                    <FiSearch className="menu-search-icon" />
                    <input
                        type="text"
                        placeholder={displayPlaceholder}
                        value={menuSearch}
                        onChange={handleSearchChange}
                        className="menu-search-input"
                    />
                </div>
            </div>

            {/* Categories Horizontal Scroll */}
            <div className="categories-container">
                <div
                    className={`category-card ${!selectedCategory ? 'active' : ''}`}
                    onClick={() => handleCategoryClick('')}
                    style={{ marginLeft: '16px' }}
                >
                    <div className="category-image-wrapper" style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--bg-secondary)'
                    }}>
                        <FiGrid size={24} style={{ color: !selectedCategory ? 'var(--primary)' : 'var(--text-secondary)' }} />
                    </div>
                    <span className="category-name">All</span>
                </div>
                <div className="horizontal-scroll hide-scrollbar" style={{ marginLeft: 0, flex: 1 }}>
                    {categories.map(cat => (
                        <CategoryCard
                            key={cat._id}
                            category={cat}
                            isActive={selectedCategory === cat._id}
                            onClick={handleCategoryClick}
                        />
                    ))}
                </div>
            </div>

            {/* Menu Items Grid */}
            <div className="menu-items-container">
                {loading ? (
                    <div className="menu-grid">
                        {renderSkeletons(6)}
                    </div>
                ) : menuItems.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon"><FiAlertCircle /></div>
                        <p className="empty-state-title">No items found</p>
                        <p className="empty-state-text">Try selecting a different category</p>
                    </div>
                ) : (
                    <>
                        <div className="menu-grid">
                            {menuItems.map(item => (
                                <MenuCard key={item._id} item={item} />
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
                                <span><FiCheck /> You've seen all items!</span>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Floating Cart Button */}
            <FloatingCartBtn />
        </div>
    );
};

export default Menu;
