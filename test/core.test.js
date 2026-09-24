'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

const G = 30;

test('normalizeApiUrl adds trailing slash', () => {
    assert.equal(Core.normalizeApiUrl('https://x.com/v1/'), 'https://x.com/v1/');
    assert.equal(Core.normalizeApiUrl('https://x.com/v1'), 'https://x.com/v1/');
    assert.equal(Core.normalizeApiUrl(''), '');
    assert.equal(Core.normalizeApiUrl(null), '');
});

test('isValidApiUrl accepts http/https only', () => {
    assert.equal(Core.isValidApiUrl('https://api.example.com/v1/'), true);
    assert.equal(Core.isValidApiUrl('http://localhost:11434/v1/'), true);
    assert.equal(Core.isValidApiUrl('ftp://x/'), false);
    assert.equal(Core.isValidApiUrl('not a url'), false);
    assert.equal(Core.isValidApiUrl(''), false);
});

test('isValidApiKey enforces length + charset', () => {
    assert.equal(Core.isValidApiKey('abcdefghij'), true);
    assert.equal(Core.isValidApiKey('sk-abc.def_123'), true);
    assert.equal(Core.isValidApiKey('short'), false);
    assert.equal(Core.isValidApiKey('has space here!'), false);
    assert.equal(Core.isValidApiKey(''), false);
    assert.equal(Core.isValidApiKey(null), false);
});

test('isNonTextModel flags known non-text ids', () => {
    assert.equal(Core.isNonTextModel('openai/whisper-1'), true);
    assert.equal(Core.isNonTextModel('dall-e-3'), true);
    assert.equal(Core.isNonTextModel('org/stable-diffusion-xl'), true);
    assert.equal(Core.isNonTextModel('meta/llama-3'), false);
    assert.equal(Core.isNonTextModel(null), false);
});

test('filterTextModels respects modality metadata', () => {
    const models = [
        { id: 'a/text-model', architecture: { modality: 'text->text' } },
        { id: 'b/vision-llm', architecture: { modality: 'text+image->text' } },
        { id: 'c/img', architecture: { modality: 'text->image' } },
        { id: 'd/open', capabilities: { modalities: ['text', 'image'] } },
        { id: 'e/audio-only', capabilities: { modalities: ['audio'] } },
        { id: 'f/plain-llm' },
        { id: 'g/whisper-x' },
    ];
    const out = Core.filterTextModels(models, { quiet: true }).map(m => m.id);
    assert.deepEqual(out, ['a/text-model', 'b/vision-llm', 'd/open', 'f/plain-llm']);
});

test('wrapPosition wraps both axes', () => {
    assert.deepEqual(Core.wrapPosition(30, 0, G), { x: 0, y: 0 });
    assert.deepEqual(Core.wrapPosition(-1, -1, G), { x: 29, y: 29 });
    assert.deepEqual(Core.wrapPosition(5, 15, G), { x: 5, y: 15 });
});

test('toroidalDist is wrap-aware', () => {
    assert.equal(Core.toroidalDist(0, 0, 29, 0, G), 1); // across left wall
    assert.equal(Core.toroidalDist(0, 0, 15, 15, G), 30);
    assert.equal(Core.toroidalDist(5, 5, 5, 5, G), 0);
});

test('wrapBearing gives shortest-path compass', () => {
    assert.equal(Core.wrapBearing({ x: 0, y: 0 }, { x: 29, y: 0 }, G), ' (1 left)');
    assert.equal(Core.wrapBearing({ x: 5, y: 5 }, { x: 8, y: 5 }, G), ' (3 right)');
    assert.equal(Core.wrapBearing({ x: 5, y: 5 }, { x: 5, y: 5 }, G), '');
    const both = Core.wrapBearing({ x: 0, y: 0 }, { x: 3, y: 28 }, G);
    assert.match(both, /3 right/);
    assert.match(both, /2 up/);
});

test('calculateNewHead wraps', () => {
    assert.deepEqual(Core.calculateNewHead({ x: 29, y: 0 }, { x: 1, y: 0 }, G), { x: 0, y: 0 });
    assert.deepEqual(Core.calculateNewHead({ x: 0, y: 0 }, { x: 0, y: -1 }, G), { x: 0, y: 29 });
});

test('collision helpers', () => {
    const snake = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    const enemy = [{ x: 10, y: 10 }, { x: 10, y: 11 }];
    assert.equal(Core.checkCollision(snake, { x: 4, y: 5 }, enemy), 'self');
    assert.equal(Core.checkCollision(snake, { x: 10, y: 10 }, enemy), 'enemy');
    assert.equal(Core.checkCollision(snake, { x: 0, y: 0 }, enemy), null);
    assert.equal(Core.checkHeadToHead({ x: 1, y: 1 }, { x: 1, y: 1 }), true);
    assert.equal(Core.checkHeadToHead({ x: 1, y: 1 }, { x: 1, y: 2 }), false);
    assert.equal(Core.wouldCollideWithSnake({ x: 5, y: 5 }, snake), true); // incl. head
    assert.equal(Core.wouldCollideWithSnakeBody({ x: 5, y: 5 }, snake), false); // excl. head
    assert.equal(Core.wouldCollideWithSnakeBody({ x: 4, y: 5 }, snake), true);
});

test('findSafeDirection prefers safe preferred dir, else fallback', () => {
    const head = { x: 5, y: 5 };
    const body = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }];
    const enemy = [{ x: 20, y: 20 }];
    // down is blocked by own body -> should pick something else (up)
    const picked = Core.findSafeDirection(head, { x: 0, y: 1 }, body, enemy, G);
    assert.deepEqual(picked, { x: 0, y: -1 });
    // preferred safe -> kept
    const kept = Core.findSafeDirection(head, { x: 1, y: 0 }, body, enemy, G);
    assert.deepEqual(kept, { x: 1, y: 0 });
});

test('parseDirectionReply tolerates chatter', () => {
    assert.equal(Core.parseDirectionReply('up'), 'up');
    assert.equal(Core.parseDirectionReply('Down.'), 'down');
    assert.equal(Core.parseDirectionReply("I'll go left"), 'left');
    assert.equal(Core.parseDirectionReply('"RIGHT"'), 'right');
    assert.equal(Core.parseDirectionReply('no direction here'), null);
    assert.equal(Core.parseDirectionReply(null), null);
});

test('calculatePercentile interpolates', () => {
    assert.equal(Core.calculatePercentile([10, 20, 30, 40], 50), 25);
    assert.equal(Core.calculatePercentile([5], 90), 5);
    assert.equal(Core.calculatePercentile([], 50), 0);
});

test('calculateLatencyStats handles empty + normal', () => {
    assert.deepEqual(Core.calculateLatencyStats([]), { min: 0, max: 0, median: 0, p90: 0 });
    const s = Core.calculateLatencyStats([100, 200, 300, 400]);
    assert.equal(s.min, 100);
    assert.equal(s.max, 400);
    assert.equal(s.median, 250);
    assert.ok(s.p90 > s.median && s.p90 <= s.max);
});

test('formatBytes thresholds', () => {
    assert.equal(Core.formatBytes(512), '512B');
    assert.equal(Core.formatBytes(2048), '2.0KB');
    assert.equal(Core.formatBytes(5 * 1024 * 1024), '5.0MB');
});
