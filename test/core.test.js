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

test('parseDirectionReply prefers the committed answer over a considered option', () => {
    // First mention is a rejected option; the answer marker precedes the pick.
    assert.equal(Core.parseDirectionReply("I'll go up, not down"), 'up');
    assert.equal(Core.parseDirectionReply('Moving up is blocked, so I go down'), 'down');
    // No marker: chatty models restate the pick last.
    assert.equal(Core.parseDirectionReply('Should I go left or right? Up is risky. I pick right'), 'right');
});

test('parseDirectionReply ignores directions inside reasoning wrappers', () => {
    // GLM-5.x emits an implicit opening token, so only `</think>` is present.
    assert.equal(
        Core.parseDirectionReply('The head is at (5,5). I could go left or down. </think>right'),
        'right'
    );
    // Paired block whose reasoning mentions other directions.
    assert.equal(
        Core.parseDirectionReply('<thinking>Options are up and down; left is fatal.</thinking>down'),
        'down'
    );
    // Discussion before the closer must not win.
    assert.equal(
        Core.parseDirectionReply('I considered left, then up.  up'),
        'up'
    );
    // Stray trailing closer after the answer: salvage from the reply.
    assert.equal(Core.parseDirectionReply('right</thinking>'), 'right');
    // Answer only inside a paired block still yields nothing.
    assert.equal(Core.parseDirectionReply('<thinking>left</thinking>'), null);
});

test('stripThinkingTags removes paired and orphan wrappers', () => {
    assert.equal(
        Core.stripThinkingTags('<thinking>secret left</thinking>right'),
        'right'
    );
    assert.equal(Core.stripThinkingTags('reasoning...</think>up'), 'reasoning... up');
    assert.equal(Core.stripThinkingTags('plain right'), 'plain right');
    assert.equal(Core.stripThinkingTags(null), '');
});

test('sortByValueAsc orders by value, is stable, and does not mutate', () => {
    const input = [
        { name: 'Star', value: 3 },
        { name: 'Apple', value: 1 },
        { name: 'Grapes', value: 2 },
        { name: 'Cherry', value: 2 },
        { name: 'Present', value: 5 },
        { name: 'Diamond', value: 4 },
    ];
    const out = Core.sortByValueAsc(input);
    assert.deepEqual(out.map(f => f.value), [1, 2, 2, 3, 4, 5]);
    // Ties keep their original relative order (Grapes before Cherry).
    assert.deepEqual(out.slice(1, 3).map(f => f.name), ['Grapes', 'Cherry']);
    // Returns a copy: the source array is untouched.
    assert.equal(input[0].name, 'Star');
    // Non-array input degrades to an empty list.
    assert.deepEqual(Core.sortByValueAsc(null), []);
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

test('resolvePlayerCredentials routes players to providers', () => {
    const p1 = { apiUrl: 'https://one/v1/', apiKey: 'key-one-12345' };
    const p2 = { apiUrl: 'https://two/v1/', apiKey: 'key-two-12345' };
    assert.deepEqual(Core.resolvePlayerCredentials(true, p1, p2, 1), p1);
    assert.deepEqual(Core.resolvePlayerCredentials(true, p1, p2, 2), p1);
    assert.deepEqual(Core.resolvePlayerCredentials(false, p1, p2, 1), p1);
    assert.deepEqual(Core.resolvePlayerCredentials(false, p1, p2, 2), p2);
    assert.deepEqual(Core.resolvePlayerCredentials(false, null, null, 2), { apiUrl: '', apiKey: '' });
});

test('isOpenAIEndpoint detects OpenAI hosts', () => {
    assert.equal(Core.isOpenAIEndpoint('https://api.openai.com/v1/'), true);
    assert.equal(Core.isOpenAIEndpoint('https://api.openai.com/v1'), true);
    assert.equal(Core.isOpenAIEndpoint('https://api.tokenfactory.nebius.com/v1/'), false);
    assert.equal(Core.isOpenAIEndpoint('http://localhost:11434/v1/'), false);
    assert.equal(Core.isOpenAIEndpoint('not a url'), false);
    assert.equal(Core.isOpenAIEndpoint(''), false);
});

test('describeFetchFailure explains CORS, with OpenAI guidance', () => {
    const openaiMsg = Core.describeFetchFailure('https://api.openai.com/v1/', new TypeError('Failed to fetch'));
    assert.match(openaiMsg, /CORS/);
    assert.match(openaiMsg, /proxy/);
    assert.match(openaiMsg, /Failed to fetch/);
    const otherMsg = Core.describeFetchFailure('https://example.com/v1/', new TypeError('Failed to fetch'));
    assert.match(otherMsg, /CORS/);
    assert.doesNotMatch(otherMsg, /proxy/);
    assert.equal(Core.describeFetchFailure('https://example.com/v1/', null), 'Network error — check connectivity, or the endpoint may block browser requests (CORS).');
});

test('buildChatRequest cleans per provider in one place', () => {    const msgs = [{ role: 'user', content: 'hi' }];
    const openai = Core.buildChatRequest({ apiUrl: 'https://api.openai.com/v1/', apiKey: 'sk-1234567890', model: 'gpt-4o', messages: msgs, temperature: 0, thinkingEnabled: true });
    assert.equal(openai.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(openai.headers['Authorization'], 'Bearer sk-1234567890');
    assert.ok(!('chat_template_kwargs' in openai.body));
    const openaiCapped = Core.buildChatRequest({ apiUrl: 'https://api.openai.com/v1/', apiKey: 'sk-1234567890', model: 'gpt-4o', messages: msgs, temperature: 0, maxTokens: 10 });
    assert.equal(openaiCapped.body.max_completion_tokens, 10);
    assert.ok(!('max_tokens' in openaiCapped.body));
    const nebius = Core.buildChatRequest({ apiUrl: 'https://api.tokenfactory.nebius.com/v1/', apiKey: 'k-1234567890', model: 'm', messages: msgs, temperature: 0, maxTokens: 10, stream: true, thinkingEnabled: true });
    assert.deepEqual(nebius.body.chat_template_kwargs, { enable_thinking: true });
    assert.equal(nebius.body.max_tokens, 10);
    assert.equal(nebius.body.stream, true);
    // Thinking enabled -> no reasoning_effort override.
    assert.ok(!('reasoning_effort' in nebius.body));
    // Thinking off (default) -> reasoning_effort:none, and no max_tokens when unset.
    const nebiusNoThink = Core.buildChatRequest({ apiUrl: 'https://api.tokenfactory.nebius.com/v1/', apiKey: 'k-1234567890', model: 'm', messages: msgs, temperature: 0 });
    assert.deepEqual(nebiusNoThink.body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(nebiusNoThink.body.reasoning_effort, 'low');
    assert.ok(!('max_tokens' in nebiusNoThink.body));
    // OpenAI rejects unknown fields -> neither suppression field is sent.
    assert.ok(!('reasoning_effort' in openai.body));
    const local = Core.buildChatRequest({ apiUrl: 'http://localhost:11434/v1/', apiKey: '', model: 'm', messages: msgs, temperature: 0 });
    assert.equal(local.headers['Authorization'], 'Bearer ollama');
    assert.equal(local.body.temperature, 0);
    const reasoning = Core.buildChatRequest({ apiUrl: 'https://api.openai.com/v1/', apiKey: 'sk-1234567890', model: 'o1-mini', messages: msgs, temperature: 0, maxTokens: 10 });
    assert.ok(!('temperature' in reasoning.body));
    assert.equal(reasoning.body.max_completion_tokens, 10);
    const gpt4o = Core.buildChatRequest({ apiUrl: 'https://api.openai.com/v1/', apiKey: 'sk-1234567890', model: 'gpt-4o', messages: msgs, temperature: 0 });
    assert.ok(!('temperature' in gpt4o.body));
});

test('isLocalBaseUrl detects loopback hosts', () => {
    assert.equal(Core.isLocalBaseUrl('http://localhost:11434/v1/'), true);
    assert.equal(Core.isLocalBaseUrl('http://127.0.0.1:11434/v1/'), true);
    assert.equal(Core.isLocalBaseUrl('https://api.openai.com/v1/'), false);
    assert.equal(Core.isLocalBaseUrl('not a url'), false);
    assert.equal(Core.isLocalBaseUrl(''), false);
});

test('effectiveApiKey substitutes placeholder for local servers', () => {
    assert.equal(Core.effectiveApiKey('http://localhost:11434/v1/', ''), 'ollama');
    assert.equal(Core.effectiveApiKey('http://localhost:11434/v1/', 'real-key-123'), 'real-key-123');
    assert.equal(Core.effectiveApiKey('https://api.openai.com/v1/', ''), '');
});

test('getProviderPresets lists known providers with URLs', () => {
    const presets = Core.getProviderPresets();
    const byId = Object.fromEntries(presets.map(p => [p.id, p]));
    assert.equal(byId['openai'].url, 'https://api.openai.com/v1/');
    assert.equal(byId['together'].url, 'https://api.together.xyz/v1/');
    assert.equal(byId['ollama-local'].url, 'http://localhost:11434/v1/');
    assert.equal(byId['anthropic'].url, 'https://api.anthropic.com/');
    assert.equal(byId['anthropic'].label, 'Anthropic');
    assert.equal(byId['custom'].url, '');
    assert.equal(byId['openai'].url, 'https://api.openai.com/v1/');
});

test('isAnthropicEndpoint detects Anthropic hosts', () => {
    assert.equal(Core.isAnthropicEndpoint('https://api.anthropic.com/'), true);
    assert.equal(Core.isAnthropicEndpoint('https://api.anthropic.com/v1/'), true);
    assert.equal(Core.isAnthropicEndpoint('https://api.openai.com/v1/'), false);
    assert.equal(Core.isAnthropicEndpoint('https://api.tokenfactory.nebius.com/v1/'), false);
    assert.equal(Core.isAnthropicEndpoint('not a url'), false);
    assert.equal(Core.isAnthropicEndpoint(''), false);
});

test('getAnthropicBase strips version segment', () => {
    assert.equal(Core.getAnthropicBase('https://api.anthropic.com/'), 'https://api.anthropic.com/');
    assert.equal(Core.getAnthropicBase('https://api.anthropic.com/v1/'), 'https://api.anthropic.com/');
    assert.equal(Core.getAnthropicBase('https://api.anthropic.com/v1'), 'https://api.anthropic.com/');
    assert.equal(Core.getAnthropicBase(''), '');
});

test('buildAnthropicRequest uses native shape with required max_tokens', () => {
    const r = Core.buildAnthropicRequest({
        apiUrl: 'https://api.anthropic.com/', apiKey: 'sk-ant-test-12345', model: 'claude-sonnet-4-20250514',
        system: 'sys', messages: [{ role: 'user', content: 'hi' }], temperature: 0, maxTokens: 10
    });
    assert.equal(r.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(r.headers['x-api-key'], 'sk-ant-test-12345');
    assert.equal(r.headers['anthropic-version'], Core.ANTHROPIC_API_VERSION);
    assert.equal(r.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(r.body.model, 'claude-sonnet-4-20250514');
    assert.equal(r.body.max_tokens, 10);
    assert.equal(r.body.system, 'sys');
    assert.deepEqual(r.body.messages, [{ role: 'user', content: 'hi' }]);
    assert.ok(!('temperature' in r.body));
    // null max_tokens (game cascade end) must still satisfy Anthropic's required field
    const def = Core.buildAnthropicRequest({
        apiUrl: 'https://api.anthropic.com/v1/', apiKey: 'k', model: 'm',
        messages: [{ role: 'user', content: 'hi' }], maxTokens: null
    });
    assert.equal(def.url, 'https://api.anthropic.com/v1/messages');
    assert.equal(def.body.max_tokens, 300);
    const streamed = Core.buildAnthropicRequest({
        apiUrl: 'https://api.anthropic.com/', apiKey: 'k', model: 'm',
        messages: [{ role: 'user', content: 'hi' }], stream: true
    });
    assert.equal(streamed.body.stream, true);
});

test('getAnthropicModelsRequest targets native models endpoint', () => {
    const req = Core.getAnthropicModelsRequest('https://api.anthropic.com/v1/', 'sk-ant-test-12345');
    assert.equal(req.url, 'https://api.anthropic.com/v1/models');
    assert.equal(req.headers['x-api-key'], 'sk-ant-test-12345');
    assert.equal(req.headers['anthropic-version'], Core.ANTHROPIC_API_VERSION);
});

test('parseAnthropicText joins text blocks and rejects errors', () => {
    assert.equal(Core.parseAnthropicText({ content: [{ type: 'text', text: '  left ' }] }), 'left');
    assert.equal(Core.parseAnthropicText({ content: [{ type: 'text', text: 'go ' }, { type: 'tool_use', id: 'x' }, { type: 'text', text: 'up' }] }), 'go up');
    assert.throws(() => Core.parseAnthropicText({ type: 'error', error: { type: 'auth', message: 'bad key' } }), /bad key/);
    assert.throws(() => Core.parseAnthropicText({ error: { message: 'boom' } }), /boom/);
    assert.throws(() => Core.parseAnthropicText(null), /Invalid response/);
});

test('extractUsage reads OpenAI + Anthropic shapes', () => {
    assert.deepEqual(Core.extractUsage({ usage: { prompt_tokens: 120, completion_tokens: 7 } }), { input: 120, output: 7, hasUsage: true });
    assert.deepEqual(Core.extractUsage({ usage: { input_tokens: 200, output_tokens: 15 } }), { input: 200, output: 15, hasUsage: true });
    assert.deepEqual(Core.extractUsage({ usage: {} }), { input: 0, output: 0, hasUsage: false });
    assert.deepEqual(Core.extractUsage({}), { input: 0, output: 0, hasUsage: false });
    assert.deepEqual(Core.extractUsage(null), { input: 0, output: 0, hasUsage: false });
    // Partial usage still counts as measured
    assert.deepEqual(Core.extractUsage({ usage: { prompt_tokens: 50 } }), { input: 50, output: 0, hasUsage: true });
});

test('formatTokens compacts counts', () => {
    assert.equal(Core.formatTokens(0), '0');
    assert.equal(Core.formatTokens(999), '999');
    assert.equal(Core.formatTokens(1000), '1k');
    assert.equal(Core.formatTokens(1500), '1.5k');
    assert.equal(Core.formatTokens(12345), '12.3k');
    assert.equal(Core.formatTokens(2500000), '2.5M');
    assert.equal(Core.formatTokens(-5), '0');
});
