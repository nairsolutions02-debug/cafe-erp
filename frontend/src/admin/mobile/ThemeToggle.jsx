import React, { useEffect, useState } from 'react';
import { FiMoon, FiSun } from 'react-icons/fi';
import { tr } from '../adminNav';
import { SHELL } from './shellText';
import { themeKeyFor, onThemeChange, readAppTheme, setAppTheme, setKdsTheme } from './useAdminTheme';

// One-tap Light / Dark button in the staff header (laptop, phone and the Android app).
// It flips the switch the page uses: the Kitchen keeps its own, the Kiosk has none (always light).
// Auto (follow the phone) stays available in More and in the laptop side menu.
const ThemeToggle = ({ pathname, dark, lang }) => {
    const key = themeKeyFor(pathname);
    if (!key) return null;
    const flip = () => (key === 'kds' ? setKdsTheme : setAppTheme)(dark ? 'light' : 'dark');
    const label = tr(dark ? SHELL.toLight : SHELL.toDark, lang);
    return (
        <button type="button" className="header-theme" data-tour="theme" onClick={flip} aria-label={label} title={label}>
            {dark ? <FiSun /> : <FiMoon />}
        </button>
    );
};

// Auto / Light / Dark for the laptop side menu (same setting as More on the phone)
export const ThemeSwitch = ({ lang }) => {
    const [theme, setTheme] = useState(readAppTheme);
    useEffect(() => onThemeChange(() => setTheme(readAppTheme())), []);
    return (
        <div className="lang-switch theme-switch" role="group" aria-label={tr(SHELL.screen, lang)}>
            {['auto', 'light', 'dark'].map(k => (
                <button key={k} type="button" className={theme === k ? 'on' : ''} aria-pressed={theme === k}
                    onClick={() => setAppTheme(k)}>{tr(SHELL[k], lang)}</button>
            ))}
        </div>
    );
};

export default ThemeToggle;
