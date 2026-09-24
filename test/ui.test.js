'use strict';
// UI sweep guard: the Options/Extra panels must use the theme-aware
// option system (.option-hint / .option-check) — no legacy inline
// styles or hardcoded #888 grey text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'snake.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets', 'style.css'), 'utf8');

function section(id) {
    const start = html.indexOf(`id="${id}"`);
    assert.ok(start !== -1, `missing #${id}`);
    // Slice to the start of the next top-level card/column so checks stay scoped.
    const nextCard = html.indexOf('<div class="card', start + 1);
    const nextCol = html.indexOf('<!-- Center:', start + 1);
    const end = Math.min(nextCard === -1 ? Infinity : nextCard, nextCol === -1 ? Infinity : nextCol);
    return html.slice(start, end);
}

// The collapse mechanism drives max-height from JS (game.js sets
// style.maxHeight on toggle), so max-height is the only inline style
// allowed inside these sections — legacy visual styling must live in CSS.
function inlineStyles(block) {
    return [...block.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
}

function assertNoLegacyInlineStyles(block, name) {
    for (const value of inlineStyles(block)) {
        assert.match(value, /^[\s;]*max-height\s*:\s*[^;]+;?\s*$/, `legacy inline style in ${name}: ${value}`);
    }
}

test('options panel has no legacy inline styles', () => {
    assertNoLegacyInlineStyles(section('options-section'), '#options-section');
});

test('extra panel has no legacy inline styles', () => {
    assertNoLegacyInlineStyles(section('extra-section'), '#extra-section');
});

test('visibility hint uses the theme-aware .option-hint class', () => {
    assert.ok(html.includes('class="option-hint"'), 'snake.html missing .option-hint');
    assert.ok(/\.option-hint\s*\{[^}]*color:\s*#8b94a7/.test(css), '.option-hint missing dark muted color');
    assert.ok(
        /html\[data-theme="light"\]\s*\.option-hint\s*\{[^}]*color:\s*#6b7280/.test(css),
        '.option-hint missing light-theme override'
    );
});

test('option checkboxes use the canonical .option-check classes', () => {
    for (const id of [
        'collision-avoidance-checkbox',
        'provide-hints-checkbox',
        'debug-checkbox',
        'thinking-mode-checkbox',
    ]) {
        const labelStart = html.lastIndexOf('<label', html.indexOf(`id="${id}"`));
        const labelTag = html.slice(labelStart, html.indexOf('>', labelStart));
        assert.ok(labelTag.includes('option-check'), `${id} label missing .option-check`);
    }
    assert.ok(css.includes('.option-check'), 'style.css missing .option-check');
    assert.ok(css.includes('.option-check-label'), 'style.css missing .option-check-label');
});

test('no hardcoded #888 grey left in options styling', () => {
    const hintRule = css.match(/\.option-hint\s*\{[^}]*\}/)[0];
    assert.ok(!/#888/.test(hintRule), '.option-hint still uses legacy #888');
});

test('benchmark empty state uses a class, not an inline style', () => {
    const benchmark = fs.readFileSync(path.join(root, 'js', 'benchmark.js'), 'utf8');
    assert.ok(!/style="/.test(benchmark), 'inline style= found in js/benchmark.js');
    assert.ok(css.includes('.benchmark-no-results-sub'), 'style.css missing .benchmark-no-results-sub');
});

test('light theme keeps buttons, timer, and status text readable', () => {
    for (const sel of [
        '.btn-disabled',
        '.timer-display',
        '.models-loaded-count',
        '.error',
        '.preset-note',
        '.latency-graph-title',
        '.dropdown-option.no-results',
    ]) {
        assert.ok(css.includes(`html[data-theme="light"] ${sel}`), `missing light override for ${sel}`);
    }
});

test('light theme keeps game-log accents readable', () => {
    for (const sel of [
        '#log-content .food',
        '#log-content .p1',
        '#log-content .p2',
        '#log-content .latency',
        '.log-control-checkbox',
    ]) {
        assert.ok(css.includes(`html[data-theme="light"] ${sel}`), `missing light override for ${sel}`);
    }
    assert.match(
        css,
        /html\[data-theme="light"\]\s*#log-content\s*\.food\s*\{[^}]*color:\s*#b45309/,
        'food log accent not deepened for light'
    );
});

test('light theme keeps benchmark modal chrome readable', () => {
    for (const sel of [
        '.benchmark-modal-header h2',
        '.benchmark-tab.active',
        '.benchmark-summary-title',
        '.benchmark-summary-content',
        '.benchmark-no-results',
    ]) {
        assert.ok(css.includes(`html[data-theme="light"] ${sel}`), `missing light override for ${sel}`);
    }
});
