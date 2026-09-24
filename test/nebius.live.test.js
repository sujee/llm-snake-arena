'use strict';
// Live integration tests against Nebius Token Factory. They exercise the exact
// request the game sends (Core.buildChatRequest) for the three models we
// profiled, asserting the response is a single, parseable direction and that
// reasoning is suppressed rather than blowing past the budget.
//
// Zero-dependency: node:test + global fetch (Node 18+). The whole live section
// skips when NEBIUS_API_KEY is not in the environment or .env, so the suite
// stays green offline / in CI without secrets.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../js/core.js');

const BASE = 'https://api.tokenfactory.nebius.com/v1/';
const MODELS = [
    'deepseek-ai/DeepSeek-V4.1-Flash',
    'zai-org/GLM-5.3-Flash',
    'zai-org/GLM-5.3',
];
// Regression guard: with reasoning_effort:'low' these finish in a bounded
// number of completion tokens (GLM ~30-150, DeepSeek ~2k). If suppression
// stops working, GLM-5.3-Flash runs to the provider's 8192-token default over
// ~90s, which this ceiling catches.
const MAX_COMPLETION_TOKENS = 4000;
const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);

function loadNebiusKey() {
    if (process.env.NEBIUS_API_KEY) return process.env.NEBIUS_API_KEY.trim();
    try {
        const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        const m = env.match(/^\s*NEBIUS_API_KEY\s*=\s*(.+?)\s*$/m);
        if (m) return m[1].trim();
    } catch (e) { /* no .env — live tests will skip */ }
    return '';
}

const API_KEY = loadNebiusKey();
const skip = API_KEY ? false : 'NEBIUS_API_KEY not set';

// Same shape as the game: a one-word system contract plus a compact board.
const SYSTEM_PROMPT =
    'You are a snake game AI with LIMITED VISIBILITY. Goal: SURVIVE longer than ' +
    'your opponent while eating fruits to grow. Respond with ONLY ONE WORD: ' +
    'up, down, left, or right. No thinking, no explanation, no extra text.';
const USER_PROMPT =
    'Move 140. You are Player 1 (red). Current direction: right. Head at (10,10). ' +
    'Body length 5. Enemy length 5.\n' +
    'FRUITS:\n' +
    '- 🍎 at (18,15) value 1\n' +
    '- 💎 at (5,17) value 4\n' +
    'Safe moves (answer with one word): up, right, down. Reply with ONE WORD only.';

async function callModel(model, thinkingEnabled = false) {
    const { url, headers, body } = Core.buildChatRequest({
        apiUrl: BASE,
        apiKey: API_KEY,
        model,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: USER_PROMPT },
        ],
        temperature: 0,
        thinkingEnabled,
    });
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { res, data, body };
}

// ---- Pure (offline) wire-shape checks ------------------------------------

test('Nebius request omits max_tokens and suppresses reasoning by default', () => {
    for (const model of MODELS) {
        const { body } = Core.buildChatRequest({
            apiUrl: BASE,
            apiKey: 'k-1234567890',
            model,
            messages: [{ role: 'user', content: 'hi' }],
            temperature: 0,
            thinkingEnabled: false,
        });
        assert.ok(!('max_tokens' in body), `${model}: max_tokens must be omitted`);
        assert.ok(!('max_completion_tokens' in body), `${model}: no completion cap either`);
        assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
        assert.equal(body.reasoning_effort, 'low');
    }
});

test('Nebius request drops reasoning_effort when thinking is requested', () => {
    const { body } = Core.buildChatRequest({
        apiUrl: BASE,
        apiKey: 'k-1234567890',
        model: 'deepseek-ai/DeepSeek-V4.1-Flash',
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0,
        thinkingEnabled: true,
    });
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: true });
    assert.ok(!('reasoning_effort' in body));
    assert.ok(!('max_tokens' in body));
});

test('parser recovers the committed direction from realistic Nebius replies', () => {
    // DeepSeek answer after a reasoning segment.
    assert.equal(
        Core.parseDirectionReply('We need answer only one word. Head (10,10).  up'),
        'up'
    );
    // GLM-5.x style essay (orphan thinking closer) ending in the pick.
    assert.equal(
        Core.parseDirectionReply(
            'The snake is at (10,10) heading right. Safe moves are up, right, down. ' +
            'I should pick one. Either works. Let me pick "up".  up'
        ),
        'up'
    );
});

// ---- Live checks (skip without a key) ------------------------------------

for (const model of MODELS) {
    test(`Nebius ${model}: returns a parseable direction within budget`, { skip, timeout: 90000 }, async () => {
        const { res, data, body } = await callModel(model, false);

        assert.ok(!('max_tokens' in body), 'game must not cap max_tokens');
        assert.equal(res.status, 200, `HTTP ${res.status}`);
        assert.ok(data && Array.isArray(data.choices) && data.choices.length > 0, 'has choices');

        const choice = data.choices[0];
        assert.equal(choice.finish_reason, 'stop', 'must finish, not truncate mid-reasoning');

        const content = choice.message && choice.message.content;
        assert.ok(typeof content === 'string' && content.trim().length > 0, 'non-empty content');

        const dir = Core.parseDirectionReply(content);
        assert.ok(DIRECTIONS.has(dir), `parseable direction, got ${JSON.stringify(dir)} from ${JSON.stringify(content.slice(0, 80))}`);

        const usage = data.usage || {};
        assert.ok(Number.isFinite(usage.prompt_tokens) && usage.prompt_tokens > 0, 'reports prompt tokens');
        assert.ok(
            Number.isFinite(usage.completion_tokens) && usage.completion_tokens < MAX_COMPLETION_TOKENS,
            `reasoning suppressed: completion_tokens=${usage.completion_tokens} (cap ${MAX_COMPLETION_TOKENS})`
        );
    });
}
