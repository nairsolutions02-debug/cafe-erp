// The help guide: every text in three languages, every "Open" link goes to a real page,
// every permission named on a topic exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOP, FAQ, UI } from '../src/admin/help/sop.js';
import { SOP_MANAGE } from '../src/admin/help/sopManage.js';
import { WHERE } from '../src/admin/help/whereIs.js';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const routes = new Set(['/admin', '/admin/login', ...[...app.matchAll(/<Route path="([a-z-]+)"/g)].map(m => `/admin/${m[1]}`)]);
const perms = readFileSync(new URL('../src/lib/permissions.js', import.meta.url), 'utf8');
const known = (p) => perms.includes(`'${p}'`) || /^[a-z]+\.(view|create|edit|delete)$/.test(p);
const tri = (t, where) => {
    assert.ok(t && typeof t === 'object', `${where}: missing text`);
    for (const l of ['en', 'hi', 'hg']) assert.ok(t[l] && t[l].trim().length > 1, `${where}: no ${l}`);
};
const page = (go) => go.split(/[?#]/)[0];

test('every guide text has English, Hindi and Hinglish', () => {
    for (const s of [...SOP, ...SOP_MANAGE]) {
        for (const k of ['title', 'intro', 'when']) tri(s[k], `${s.id}.${k}`);
        if (s.example) tri(s.example, `${s.id}.example`);
        if (s.tip) tri(s.tip, `${s.id}.tip`);
        s.steps.forEach((st, i) => tri(st.t, `${s.id}.step${i + 1}`));
    }
    FAQ.forEach((f, i) => { tri(f.q, `faq${i}.q`); tri(f.a, `faq${i}.a`); });
    WHERE.forEach((w, i) => tri(w.q, `where${i}`));
    Object.entries(UI).forEach(([k, t]) => tri(t, `UI.${k}`));
});

test('topic ids are unique and every Open link goes to a real page', () => {
    const ids = [...SOP, ...SOP_MANAGE].map(s => s.id);
    assert.equal(new Set(ids).size, ids.length);
    const links = [...SOP, ...SOP_MANAGE].flatMap(s => s.steps.map(st => st.go).filter(Boolean))
        .concat(FAQ.map(f => f.go).filter(Boolean), WHERE.map(w => w.go));
    for (const go of links) assert.ok(routes.has(page(go)), `no page for ${go}`);
});

test('every permission named on a topic exists', () => {
    for (const s of [...SOP, ...SOP_MANAGE, ...WHERE]) for (const p of s.perms || []) assert.ok(known(p), `unknown permission ${p}`);
});

test('the guide covers every page in the menu', () => {
    const nav = readFileSync(new URL('../src/admin/adminNav.js', import.meta.url), 'utf8');
    const paths = [...nav.matchAll(/path: '(\/admin[^']*)'/g)].map(m => m[1]).filter(p => p !== '/admin/help');
    const covered = new Set([...SOP, ...SOP_MANAGE].flatMap(s => s.steps.map(st => st.go).filter(Boolean)).concat(WHERE.map(w => w.go)).map(page));
    const missing = paths.filter(p => !covered.has(p));
    assert.deepEqual(missing, [], `pages with no guide link: ${missing.join(', ')}`);
});

test('every ⓘ on a page has its text in three languages and links to a real guide topic', async () => {
    const { TIPS } = await import('../src/admin/help/tips.js');
    const { readdirSync, statSync } = await import('node:fs');
    const walk = (d) => readdirSync(d).flatMap(f => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : p.endsWith('.jsx') ? [p] : []; });
    const used = new Set(walk(new URL('../src/admin', import.meta.url).pathname)
        .flatMap(f => [...readFileSync(f, 'utf8').matchAll(/(?:InfoTip k|tip)="([a-z_]+)"/g)].map(m => m[1])));
    assert.ok(used.size >= 40, `only ${used.size} ⓘ buttons`);
    for (const k of used) assert.ok(TIPS[k], `no tip text for ${k}`);
    const topics = new Set([...SOP, ...SOP_MANAGE].map(s => s.id));
    for (const [k, tip] of Object.entries(TIPS)) {
        for (const f of ['t', 'd', 'ex', 'who']) tri(tip[f], `tip ${k}.${f}`);
        assert.ok(topics.has(tip.guide), `tip ${k}: no guide topic ${tip.guide}`);
    }
});

test('every tour step is in three languages, for every role', async () => {
    const { TOURS, TOUR_WORDS, tourFor } = await import('../src/admin/help/tours.js');
    for (const [role, steps] of Object.entries(TOURS)) {
        assert.ok(steps.length >= 3, role);
        steps.forEach((s, i) => { tri(s.t, `${role}${i}.t`); tri(s.d, `${role}${i}.d`); });
    }
    Object.entries(TOUR_WORDS).forEach(([k, t]) => tri(t, `tour word ${k}`));
    const has = (perms) => (p) => perms.includes(p);
    assert.equal(tourFor(has(['settings.edit', 'orders.create'])), 'owner');
    assert.equal(tourFor(has(['orders.create', 'orders.view'])), 'cashier');
    assert.equal(tourFor(has(['orders.view', 'orders.edit'])), 'kitchen');
    assert.equal(tourFor(has(['finance.view', 'orders.view'])), 'office');
});
