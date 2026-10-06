import React from 'react';
import { FiSun, FiMoon, FiDroplet, FiCheck } from 'react-icons/fi';
import Header from '../components/Header';
import { useBrand, useCxLook } from '../context/BrandContext';
import { themeOf, saveChoice, readChoice } from '../lib/cxThemes';
import useCxLang, { T } from '../lib/cxLang';
import './Look.css';

const W = {
    title: T('Look', 'रूप-रंग', 'Look'),
    sub: T('Pick how the app looks for you. Only this phone changes.', 'ऐप आपको कैसा दिखे, चुनें। सिर्फ़ इस फ़ोन पर बदलेगा।', 'App aapko kaisa dikhe, chuno. Sirf is phone pe badlega.'),
    mode: T('Light or dark', 'हल्का या गहरा', 'Light ya dark'),
    asIs: T('As is', 'जैसा है', 'Jaisa hai'),
    light: T('Light', 'हल्का', 'Light'),
    dark: T('Dark', 'गहरा', 'Dark'),
    phone: T('Phone', 'फ़ोन जैसा', 'Phone jaisa'),
    asIsHelp: T('Each theme in its own colours', 'हर थीम अपने रंग में', 'Har theme apne rang mein'),
    phoneHelp: T('Light by day, dark when your phone is dark', 'फ़ोन गहरा तो ऐप भी गहरा', 'Phone dark to app bhi dark'),
    themes: T('Themes from {cafe}', '{cafe} की थीम', '{cafe} ki themes'),
    toPick: T('{n} to pick', '{n} में से चुनें', '{n} mein se chuno'),
    cafePick: T('cafe pick', 'कैफ़े की पसंद', 'cafe ki pasand'),
    fixed: T('The cafe has set one look for everyone.', 'कैफ़े ने सबके लिए एक ही रूप रखा है।', 'Cafe ne sabke liye ek hi look rakha hai.'),
    showing: T('Showing: {name}', 'अभी: {name}', 'Abhi: {name}'),
};

const MODES = [
    ['theme', FiDroplet, W.asIs, W.asIsHelp],
    ['light', FiSun, W.light],
    ['dark', FiMoon, W.dark],
    ['auto', null, W.phone, W.phoneHelp],
];

const HalfMoon = () => (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
);

// A small drawing of the home screen in a theme's colours
export const ThemeMini = ({ theme }) => (
    <span className="look-mini" style={{ background: theme.bg }} aria-hidden="true">
        <i style={{ left: 8, right: 8, top: 8, height: 26, background: theme.ban }} />
        <i style={{ left: 8, top: 40, width: '42%', height: '40%', background: theme.sf, border: `1px solid ${theme.ln}` }} />
        <i style={{ right: 8, top: 40, width: '42%', height: '40%', background: theme.sf, border: `1px solid ${theme.ln}` }} />
        <i style={{ left: '30%', right: '30%', bottom: 6, height: 9, borderRadius: 9, background: theme.pr }} />
    </span>
);

// Me → Look: light / dark / phone setting, and the themes the owner switched on
const Look = () => {
    const { look, key, choice } = useCxLook();
    const brand = useBrand();
    const { lang, t } = useCxLang();
    const mode = choice?.mode || 'theme';
    const picked = look.customerPick && look.enabled.includes(choice?.theme) ? choice.theme : look.first;
    const save = (patch) => saveChoice({ ...readChoice(), ...patch });
    const nameOf = (k) => { const n = themeOf(k, look).name; return n?.[lang] || n?.en || k; };

    return (
        <div className="look-page">
            <Header title={t(W.title)} showBack />
            <div className="look-wrap">
                <h1 className="look-h cx-h">{t(W.title)}</h1>
                <p className="look-sub">{t(W.sub)}</p>

                {look.modePick && (
                    <section className="look-sec" aria-label={t(W.mode)}>
                        <div className="look-modes" role="radiogroup" aria-label={t(W.mode)}>
                            {MODES.map(([m, Icon, word, help]) => (
                                <button key={m} type="button" role="radio" aria-checked={mode === m}
                                    className={`look-mode ${mode === m ? 'on cx-pri' : 'cx-glass'}`} onClick={() => save({ mode: m })}>
                                    <span className="look-mode-ic">{Icon ? <Icon aria-hidden="true" /> : <HalfMoon />}</span>
                                    <b>{t(word)}</b>
                                    {help && <small>{t(help)}</small>}
                                </button>
                            ))}
                        </div>
                    </section>
                )}

                {look.customerPick && look.enabled.length > 1 ? (
                    <section className="look-sec">
                        <div className="cx-shead">
                            <h2>{t(W.themes, { cafe: brand.name })}</h2>
                            <span className="look-count">{t(W.toPick, { n: look.enabled.length })}</span>
                        </div>
                        <div className="look-grid" role="radiogroup" aria-label={t(W.themes, { cafe: brand.name })}>
                            {look.enabled.map(k => {
                                const th = themeOf(k, look);
                                return (
                                    <button key={k} type="button" role="radio" aria-checked={picked === k}
                                        className={`look-card cx-glass ${picked === k ? 'on' : ''}`} onClick={() => save({ theme: k })}>
                                        <ThemeMini theme={th} />
                                        <span className="look-name">
                                            <b>{nameOf(k)}</b>
                                            {k === look.first && <small>{t(W.cafePick)}</small>}
                                        </span>
                                        {picked === k && <span className="look-tick cx-pri" aria-hidden="true"><FiCheck /></span>}
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                ) : (
                    !look.modePick && <p className="look-fixed cx-glass">{t(W.fixed)}</p>
                )}

                <p className="look-now">{t(W.showing, { name: nameOf(key) })}</p>
            </div>
        </div>
    );
};

export default Look;
