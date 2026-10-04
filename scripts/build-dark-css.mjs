// Builds frontend/src/admin/mobile/dark-auto.css: dark versions of the fixed colours in the admin stylesheets.
// Re-run after changing an admin stylesheet:  node scripts/build-dark-css.mjs
//
// Every rule that sets a fixed colour gets a copy under .theme-dark (one class more, so it wins):
//   white / near-white backgrounds  -> dark surfaces
//   pale tinted backgrounds          -> a deep tint of the same hue
//   dark text                        -> light text (coloured text keeps its hue, made lighter)
//   light borders                    -> the dark line colour
// Colours given as var(...), see-through tints, gradients and mid / strong colours (buttons) are left alone,
// and so is the text colour of a rule that keeps a strong background.
// Hand-written rules in dark.css load after this file and win where both exist.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'src');
const OUT = join(root, 'admin', 'mobile', 'dark-auto.css');
const SKIP = new Set(['dark.css', 'dark-auto.css']);
const files = [];
const walk = (dir) => {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (f.endsWith('.css') && !SKIP.has(f) && !/kiosk/i.test(f)) files.push(p);
    }
};
walk(join(root, 'admin'));
files.sort();
files.push(join(root, 'index.css'));

// ---- colours --------------------------------------------------------------
const NAMED = { white: '#ffffff', black: '#000000' };
const parse = (s) => {
    s = s.trim().toLowerCase();
    if (NAMED[s]) s = NAMED[s];
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
        let h = m[1];
        if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
        const n = parseInt(h.slice(0, 6), 16);
        return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
    }
    m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
        const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 };
    }
    return null;
};
const hsl = ({ r, g, b }) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s, l };
};
const out = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

const darkBg = (c) => {
    if (c.a < 0.35) return null;
    const { h, s, l } = hsl(c);
    if (l >= 0.97 && s < 0.4) return 'var(--d-surface)';
    if (l >= 0.86 && s < 0.25) return 'var(--d-surface-2)';
    if (l >= 0.78) return out(h, Math.min(s, 0.45), 0.17);
    return null;
};
const darkText = (c) => {
    const { h, s, l } = hsl(c);
    if (l >= 0.97) return null; // white text sits on a coloured button
    if (s < 0.2) {
        if (l < 0.3) return 'var(--d-ink)';
        if (l < 0.5) return 'var(--d-ink-2)';
        return null;
    }
    if (l < 0.5) return out(h, Math.min(s, 0.8), 0.72);
    return null;
};
const darkBorder = (c) => {
    const { l } = hsl(c);
    return l >= 0.75 ? 'var(--d-line)' : null;
};

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b/g;
const convertValue = (prop, value) => {
    if (/var\(|gradient|url\(/.test(value)) return null;
    let changed = false;
    const v = value.replace(COLOR_RE, (tok) => {
        const c = parse(tok);
        if (!c) return tok;
        const f = /^background/.test(prop) ? darkBg : prop === 'color' ? darkText : /^(border|outline)/.test(prop) ? darkBorder : null;
        const r = f && f(c);
        if (!r) return tok;
        changed = true;
        return r;
    });
    return changed ? v : null;
};

// ---- a small CSS reader (rules and one level of @media) -------------------
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
function* rules(css) {
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf('{', i);
        if (open < 0) return;
        const head = css.slice(i, open).trim();
        let depth = 1, j = open + 1;
        while (j < css.length && depth) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
        const body = css.slice(open + 1, j - 1);
        if (head.startsWith('@media')) {
            if (/print/.test(head)) { i = j; continue; }
            for (const r of rules(body)) yield { ...r, media: head };
        } else if (!head.startsWith('@')) {
            yield { selector: head, body };
        }
        i = j;
    }
}
const PROPS = /^(background|background-color|color|border|border-(top|right|bottom|left)|border-(top|right|bottom|left)-color|border-color|outline|outline-color)$/;
const prefix = (sel) => sel.split(',').map(s => s.trim()).filter(Boolean)
    .filter(s => !/^(html|body|:root|\*)\b/.test(s) && !s.includes('.theme-dark') && !/^(from|to|\d+%)$/.test(s))
    .map(s => `.theme-dark ${s}`).join(',\n');

let count = 0;
const blocks = [];
for (const file of files) {
    const css = stripComments(readFileSync(file, 'utf8'));
    const parts = [];
    for (const { selector, body, media } of rules(css)) {
        // A rule that keeps a strong background (a gold badge, a green button) keeps its text colour too
        const strongBg = body.split(';').some(d => {
            const k = d.indexOf(':');
            if (k < 0 || !/^\s*background(-color)?\s*$/i.test(d.slice(0, k))) return false;
            const v = d.slice(k + 1);
            if (/var\(|gradient|url\(/.test(v)) return false;
            return (v.match(COLOR_RE) || []).some(t => { const c = parse(t); return c && c.a >= 0.35 && !darkBg(c); });
        });
        const decls = body.split(';').map(d => d.trim()).filter(Boolean).map(d => {
            const k = d.indexOf(':');
            if (k < 0) return null;
            const prop = d.slice(0, k).trim().toLowerCase();
            if (!PROPS.test(prop) || (strongBg && prop === 'color')) return null;
            const value = d.slice(k + 1).replace(/!important/, '').trim();
            const v = convertValue(prop, value);
            return v ? `${prop}: ${v}${/!important/.test(d) ? ' !important' : ''};` : null;
        }).filter(Boolean);
        const sel = prefix(selector);
        if (!decls.length || !sel) continue;
        count += decls.length;
        const rule = `${sel} {\n    ${decls.join('\n    ')}\n}`;
        parts.push(media ? `${media} {\n${rule.replace(/^/gm, '    ')}\n}` : rule);
    }
    if (parts.length) blocks.push(`/* ${relative(root, file)} */\n${parts.join('\n\n')}`);
}

writeFileSync(OUT, `/* Generated by scripts/build-dark-css.mjs: do not edit by hand, re-run the script instead.
   Dark versions of the fixed colours in the admin stylesheets (only active under .theme-dark, on screen). */
@media screen {
${blocks.join('\n\n').replace(/^/gm, '    ').replace(/^\s+$/gm, '')}
}
`);
console.log(`${relative(process.cwd(), OUT)} written: ${count} colours in ${blocks.length} files`);
