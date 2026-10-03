import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiSearch } from 'react-icons/fi';
import { globalSearch } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { ADMIN_NAV } from './adminNav';
import './GlobalSearch.css';

const GROUPS = [
    ['pages', 'Pages'], ['items', 'Menu items'], ['orders', 'Orders'], ['customers', 'Customers'],
    ['stock', 'Stock'], ['vendors', 'Vendors'], ['categories', 'Categories'], ['brands', 'Brands'], ['staff', 'Staff'],
];

// Where each kind of result opens
const target = (group, r) => ({
    pages: r.path,
    items: `/admin/menu?q=${encodeURIComponent(r.title)}`,
    orders: `/admin/history?q=${encodeURIComponent(r.title)}`,
    customers: `/admin/customers?q=${encodeURIComponent(r.title)}`,
    categories: `/admin/categories`,
    brands: `/admin/menu?q=${encodeURIComponent(r.title)}`,
    staff: `/admin/staff`,
    stock: `/admin/inventory?q=${encodeURIComponent(r.title)}`,
    vendors: `/admin/inventory?tab=vendors&q=${encodeURIComponent(r.title)}`,
}[group]);

// One search box for everything the signed-in person may see (Ctrl+K or / to focus)
const GlobalSearch = () => {
    const { hasPerm } = useAuth();
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState({});
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const inputRef = useRef(null);

    useEffect(() => {
        const onKey = (e) => {
            const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
            if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
                e.preventDefault();
                inputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) { setResults({}); return undefined; }
        const pages = ADMIN_NAV.filter(n => (!n.perm || hasPerm(n.perm)) && n.label.toLowerCase().includes(q.toLowerCase()))
            .map(n => ({ id: n.path, title: n.label, path: n.path }));
        setResults(r => ({ ...r, pages }));
        const timer = setTimeout(async () => {
            try {
                const res = await globalSearch(q);
                setResults({ pages, ...res.data });
                setActive(0);
            } catch {
                setResults({ pages });
            }
        }, 220);
        return () => clearTimeout(timer);
    }, [query, hasPerm]);

    const flat = GROUPS.flatMap(([g]) => (results[g] || []).map(r => ({ group: g, r })));

    const go = (item) => {
        if (!item) return;
        navigate(target(item.group, item.r));
        setQuery('');
        setOpen(false);
        inputRef.current?.blur();
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
        if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
        if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
    };

    const indexOf = (group, id) => flat.findIndex(f => f.group === group && f.r.id === id);
    return (
        <div className="global-search">
            <FiSearch className="gs-icon" />
            <input
                ref={inputRef}
                value={query}
                onChange={e => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                onKeyDown={onKeyDown}
                placeholder="Search items, orders, customers…  (Ctrl+K)"
                aria-label="Search everything"
            />
            {open && query.trim().length >= 2 && (
                <div className="gs-results" role="listbox">
                    {flat.length === 0 && <div className="gs-empty">No matches</div>}
                    {GROUPS.map(([g, label]) => (results[g] || []).length > 0 && (
                        <div key={g} className="gs-group">
                            <div className="gs-group-label">{label}</div>
                            {results[g].map(r => {
                                const i = indexOf(g, r.id);
                                return (
                                    <button key={`${g}-${r.id}`} className={`gs-item ${i === active ? 'active' : ''}`}
                                        onMouseDown={() => go({ group: g, r })} onMouseEnter={() => setActive(i)} role="option" aria-selected={i === active}>
                                        <span className="gs-title">{r.title}</span>
                                        {r.subtitle && <span className="gs-sub">{r.subtitle}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default GlobalSearch;
