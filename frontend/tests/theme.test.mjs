// Brand colours: the readability rule, the deeper-shade fix and the clean-up of saved values.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrast, readable, deeper, normaliseTheme, PRESETS, DEFAULT_THEME, MIN_CONTRAST } from '../src/lib/theme.js';

test('every ready-made colour set is readable on white and with white text', () => {
    for (const p of PRESETS) assert.ok(readable(p.main), `${p.name} ${p.main} ${contrast(p.main, '#ffffff').toFixed(2)}`);
});

test('pale colours are refused and the deeper shade passes', () => {
    for (const pale of ['#F5D90A', '#F9A8D4', '#A3E635', '#FFFFFF']) {
        assert.equal(readable(pale), false, pale);
        const fixed = deeper(pale);
        assert.ok(contrast(fixed, '#ffffff') >= MIN_CONTRAST, `${pale} -> ${fixed}`);
    }
});

test('saved values are cleaned: bad or pale colours, unknown fonts and corners fall back to the default', () => {
    assert.deepEqual(normaliseTheme({}), DEFAULT_THEME);
    assert.deepEqual(normaliseTheme({ main: '#f5d90a', accent: 'red', corners: 'wavy', font: 'Comic Sans' }), DEFAULT_THEME);
    assert.deepEqual(normaliseTheme({ main: '#0f766e', accent: '#f59e0b', corners: 'round', font: 'Mukta' }),
        { main: '#0F766E', accent: '#F59E0B', corners: 'round', font: 'Mukta' });
});
