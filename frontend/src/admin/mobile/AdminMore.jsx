import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiHelpCircle, FiLogOut, FiChevronRight } from 'react-icons/fi';
import { NAV_SECTIONS, LANGS, tr } from '../adminNav';
import { useAuth } from '../../context/AuthContext';
import { useBrand } from '../../context/BrandContext';
import { SHELL } from './shellText';
import { readAppTheme, setAppTheme, onThemeChange } from './useAdminTheme';
import './mobile.css';

const readLang = () => {
    try { return localStorage.getItem('menuLang') || 'en'; } catch { return 'en'; }
};

// Phone "More" page: every page the role allows, grouped by section, plus language, help and log out
const AdminMore = () => {
    const { user, hasPerm, logout } = useAuth();
    const brand = useBrand();
    const navigate = useNavigate();
    const [lang, setLang] = useState(readLang);
    const [theme, setTheme] = useState(readAppTheme);
    const chooseTheme = (v) => { setTheme(v); setAppTheme(v); };
    useEffect(() => onThemeChange(() => setTheme(readAppTheme())), []);
    useEffect(() => {
        const sync = () => setLang(readLang());
        window.addEventListener('menulang', sync);
        return () => window.removeEventListener('menulang', sync);
    }, []);
    const chooseLang = (key) => {
        setLang(key);
        try { localStorage.setItem('menuLang', key); } catch { /* private mode */ }
        window.dispatchEvent(new Event('menulang'));
    };
    const sections = NAV_SECTIONS
        .map(s => ({ ...s, items: s.items.filter(i => !i.perm || hasPerm(i.perm)) }))
        .filter(s => s.items.length > 0);

    return (
        <div className="more">
            <div className="more-me">
                <span className="more-av" aria-hidden="true">{(user?.name || 'A').trim()[0]?.toUpperCase()}</span>
                <span className="more-who"><b>{user?.name || 'Admin'}</b><small>{user?.roleName}{brand.name ? ` · ${brand.name}` : ''}</small></span>
            </div>

            {sections.map(s => (
                <section key={s.key} className="more-sec">
                    <h2>{tr(s.label, lang)}</h2>
                    <div className="more-tiles">
                        {s.items.map(i => (
                            <Link key={i.path} to={i.path} className="more-tile">
                                <span className="more-ti"><i.icon /></span>
                                <span>{tr(i.label, lang)}</span>
                            </Link>
                        ))}
                    </div>
                </section>
            ))}

            <section className="more-list">
                <div className="more-row">
                    <span>{tr(SHELL.language, lang)}</span>
                    <span className="more-seg" role="group" aria-label={tr(SHELL.language, lang)}>
                        {LANGS.map(l => <button key={l.key} type="button" aria-pressed={lang === l.key} onClick={() => chooseLang(l.key)}>{l.label}</button>)}
                    </span>
                </div>
                <div className="more-row">
                    <span>{tr(SHELL.screen, lang)}</span>
                    <span className="more-seg" role="group" aria-label={tr(SHELL.screen, lang)}>
                        {['auto', 'dark', 'light'].map(k => <button key={k} type="button" aria-pressed={theme === k} onClick={() => chooseTheme(k)}>{tr(SHELL[k], lang)}</button>)}
                    </span>
                    <small className="more-note">{tr(SHELL.screenNote, lang)}</small>
                </div>
                <Link to="/admin/help" className="more-row link"><span><FiHelpCircle /> {tr(SHELL.help, lang)}</span><FiChevronRight /></Link>
                <button type="button" className="more-row link danger" onClick={() => { logout(); navigate('/admin/login'); }}>
                    <span><FiLogOut /> {tr(SHELL.logout, lang)}</span>
                </button>
            </section>
        </div>
    );
};

export default AdminMore;
