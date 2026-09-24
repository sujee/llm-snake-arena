// Snake Arena core logic — DOM-free pure functions.
//
// Loaded as a classic script before js/game.js (exposes global `SnakeCore`)
// and required directly by Node tests (`module.exports`).
// Grid-dependent helpers take `gridSize` explicitly so tests don't rely on
// the browser's GRID_SIZE global.
(function (global) {
    'use strict';

    function normalizeApiUrl(url) {
        if (!url) return '';
        return url.endsWith('/') ? url : url + '/';
    }

    function isValidApiUrl(url) {
        try {
            const parsedUrl = new URL(url);
            return parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:';
        } catch (e) {
            return false;
        }
    }

    function isValidApiKey(apiKey) {
        if (!apiKey || apiKey.length < 10) {
            return false;
        }
        const apiKeyRegex = /^[A-Za-z0-9\-_\.]+$/;
        return apiKeyRegex.test(apiKey);
    }

    const NON_TEXT_PATTERNS = [
        'whisper',
        'tts',
        'stt',
        'audio',
        'image',
        'vision',
        'speech',
        'dall-e',
        'stable-diffusion',
        'midjourney',
    ];

    function isNonTextModel(modelId) {
        const id = (modelId || '').toLowerCase();
        return NON_TEXT_PATTERNS.some(pattern => id.includes(pattern));
    }

    function filterTextModels(models, opts = {}) {
        const quiet = opts.quiet === true;
        if (!quiet && typeof console !== 'undefined') {
            console.log(`Filtering ${models.length} models to text-to-text only...`);
        }
        const filtered = models.filter(model => {
            if (model.architecture && model.architecture.modality) {
                return /->\s*text\b/.test(model.architecture.modality);
            }
            if (model.capabilities && model.capabilities.modalities) {
                return model.capabilities.modalities.includes('text');
            }
            return !isNonTextModel(model.id);
        });
        if (!quiet && typeof console !== 'undefined') {
            console.log(`Filtered to ${filtered.length} text-to-text models`);
        }
        return filtered;
    }

    function wrapPosition(x, y, gridSize) {
        return {
            x: ((x % gridSize) + gridSize) % gridSize,
            y: ((y % gridSize) + gridSize) % gridSize
        };
    }

    function toroidalDist(ax, ay, bx, by, gridSize) {
        const dx = Math.abs(ax - bx);
        const dy = Math.abs(ay - by);
        return Math.min(dx, gridSize - dx) + Math.min(dy, gridSize - dy);
    }

    function wrapBearing(head, target, gridSize) {
        const parts = [];
        for (const [raw, neg, pos] of [
            [target.x - head.x, 'left', 'right'],
            [target.y - head.y, 'up', 'down'],
        ]) {
            const abs = Math.abs(raw);
            if (abs === 0) continue;
            const mag = Math.min(abs, gridSize - abs);
            const dirName = (abs <= gridSize - abs ? raw > 0 : raw < 0) ? pos : neg;
            parts.push({ mag, label: `${mag} ${dirName}` });
        }
        parts.sort((a, b) => b.mag - a.mag);
        return parts.length ? ` (${parts.map(p => p.label).join(', ')})` : '';
    }

    function calculateNewHead(head, direction, gridSize) {
        return wrapPosition(head.x + direction.x, head.y + direction.y, gridSize);
    }

    function wouldCollideWithSnake(position, snake) {
        for (const segment of snake) {
            if (position.x === segment.x && position.y === segment.y) {
                return true;
            }
        }
        return false;
    }

    function wouldCollideWithSnakeBody(position, snake) {
        for (let i = 1; i < snake.length; i++) {
            if (position.x === snake[i].x && position.y === snake[i].y) {
                return true;
            }
        }
        return false;
    }

    function checkCollision(snake, head, otherSnake) {
        for (let i = 1; i < snake.length; i++) {
            if (head.x === snake[i].x && head.y === snake[i].y) {
                return 'self';
            }
        }
        for (const segment of otherSnake) {
            if (head.x === segment.x && head.y === segment.y) {
                return 'enemy';
            }
        }
        return null;
    }

    function checkHeadToHead(head1, head2) {
        return head1.x === head2.x && head1.y === head2.y;
    }

    function findSafeDirection(head, preferredDirection, snake, otherSnake, gridSize) {
        const directions = [
            { x: 0, y: -1 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 0 }
        ];
        let newPosition = calculateNewHead(head, preferredDirection, gridSize);
        if (!wouldCollideWithSnakeBody(newPosition, snake) &&
            !wouldCollideWithSnake(newPosition, otherSnake)) {
            return preferredDirection;
        }
        for (const dir of directions) {
            if (dir.x === preferredDirection.x && dir.y === preferredDirection.y) {
                continue;
            }
            newPosition = calculateNewHead(head, dir, gridSize);
            if (!wouldCollideWithSnakeBody(newPosition, snake) &&
                !wouldCollideWithSnake(newPosition, otherSnake)) {
                return dir;
            }
        }
        return preferredDirection;
    }

    // Removes model reasoning wrappers before parsing. Handles paired blocks
    // (`<thinking>…</thinking>`) AND orphan tags: some templates emit only a
    // leading/closing marker (e.g. GLM's `</think>` with no opening tag), so
    // stripping paired blocks alone left the whole reasoning prefix in band.
    function stripThinkingTags(text) {
        if (typeof text !== 'string') return '';
        return text
            .replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<\/?(thinking|think|thought|reasoning)>/gi, ' ')
            .trim();
    }

    // Markers that signal "the answer follows" — used to pick the direction
    // word the model actually committed to, not one it merely considered.
    const DIRECTION_ANSWER_MARKERS = /\b(answer|move|go|choose|pick|play|direction|respond|final|select)\b/;

    // Extracted from getLLMDirection. Returns 'up'|'down'|'left'|'right'|null.
    // Stronger than a plain first-match:
    //  1. Drops reasoning wrappers up front (paired or orphan tags).
    //  2. If a thinking block was closed, parses only the text after the LAST
    //     closer (the post-think answer segment).
    //  3. Prefers a direction word introduced by an answer marker in the span
    //     since the previous direction mention ("I'll go left", "answer: up"),
    //     scanning from the end. Scoping to that span stops a marker from an
    //     earlier clause ("go up, not down") from claiming a later option.
    //  4. Otherwise returns the LAST mention — chatty models restate their
    //     pick at the end, while a one-word reply is unchanged either way.
    function parseDirectionReply(text) {
        if (typeof text !== 'string') return null;
        const lower = text.toLowerCase();

        // Prefer the post-reasoning segment when a closer is present.
        let s = lower;
        const closers = [...lower.matchAll(/<\/(thinking|think|thought|reasoning)>/g)];
        if (closers.length) {
            const last = closers[closers.length - 1];
            s = lower.slice(last.index + last[0].length);
        }
        s = stripThinkingTags(s);

        let matches = [...s.matchAll(/\b(up|down|left|right)\b/g)];
        if (matches.length === 0 && closers.length) {
            // Nothing after the closer (e.g. "right</thinking>") — salvage
            // from the whole reply instead of failing.
            s = stripThinkingTags(lower);
            matches = [...s.matchAll(/\b(up|down|left|right)\b/g)];
        }
        if (matches.length === 0) return null;

        for (let i = matches.length - 1; i >= 0; i--) {
            const segStart = i > 0 ? matches[i - 1].index + matches[i - 1][0].length : 0;
            const between = s.slice(segStart, matches[i].index);
            if (DIRECTION_ANSWER_MARKERS.test(between)) return matches[i][1];
        }
        return matches[matches.length - 1][1];
    }

    // Stable ascending sort by numeric `value`, returning a new array. Used to
    // present the fruit legend cheapest-first regardless of source order.
    function sortByValueAsc(items) {
        if (!Array.isArray(items)) return [];
        return [...items].sort((a, b) => (a.value || 0) - (b.value || 0));
    }

    function calculatePercentile(sortedArray, percentile) {
        if (!sortedArray.length) return 0;
        const index = (percentile / 100) * (sortedArray.length - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index - lower;
        if (upper >= sortedArray.length) {
            return sortedArray[sortedArray.length - 1];
        }
        return sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight;
    }

    function calculateLatencyStats(latencies) {
        const sorted = [...latencies].sort((a, b) => a - b);
        const len = sorted.length;
        if (len === 0) {
            return { min: 0, max: 0, median: 0, p90: 0 };
        }
        return {
            min: sorted[0],
            max: sorted[len - 1],
            median: calculatePercentile(sorted, 50),
            p90: calculatePercentile(sorted, 90)
        };
    }

    function formatBytes(bytes) {
        if (bytes < 1024) {
            return `${bytes}B`;
        } else if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)}KB`;
        } else {
            return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
        }
    }

    // Compact token counts for the latency-panel title (0 -> "0",
    // 999 -> "999", 1500 -> "1.5k", 2.5M -> "2.5M").
    function formatTokens(n) {
        if (!Number.isFinite(n) || n < 0) return '0';
        const rounded = Math.round(n);
        if (rounded < 1000) return `${rounded}`;
        if (rounded < 1000000) {
            const v = (rounded / 1000).toFixed(1).replace(/\.0$/, '');
            return `${v}k`;
        }
        const v = (rounded / 1000000).toFixed(1).replace(/\.0$/, '');
        return `${v}M`;
    }

    // One place that reads token usage off an LLM response body.
    // OpenAI-compatible: data.usage.{prompt_tokens, completion_tokens}.
    // Anthropic native: data.usage.{input_tokens, output_tokens}.
    // Returns { input, output, hasUsage }; missing/non-numeric fields
    // become 0 and hasUsage is false so callers can fall back to an
    // estimate instead of silently reporting 0.
    function extractUsage(data) {
        if (!data || typeof data !== 'object') return { input: 0, output: 0, hasUsage: false };
        const usage = data.usage;
        if (!usage || typeof usage !== 'object') return { input: 0, output: 0, hasUsage: false };
        const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
        let input = num(usage.input_tokens);
        let output = num(usage.output_tokens);
        if (input === null) input = num(usage.prompt_tokens);
        if (output === null) output = num(usage.completion_tokens);
        const hasUsage = input !== null || output !== null;
        return { input: input === null ? 0 : input, output: output === null ? 0 : output, hasUsage };
    }

    // Dual-provider credentials. Player 1 always uses provider 1. Player 2
    // uses provider 1 when `sameProvider` is true, otherwise provider 2.
    // Pure so the resolution rule is unit-testable; DOM reads stay in game.js.
    function resolvePlayerCredentials(sameProvider, provider1, provider2, playerNum) {
        const p1 = provider1 || { apiUrl: '', apiKey: '' };
        const p2 = provider2 || { apiUrl: '', apiKey: '' };
        const chosen = (playerNum === 2 && !sameProvider) ? p2 : p1;
        return { apiUrl: chosen.apiUrl || '', apiKey: effectiveApiKey(chosen.apiUrl, chosen.apiKey) };
    }

    function isLocalBaseUrl(url) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
        } catch (e) {
            return false;
        }
    }

    // Anthropic's native API uses x-api-key (not Bearer) plus a version
    // header. Direct browser calls additionally require the
    // `anthropic-dangerous-direct-browser-access` header; without it the
    // endpoint blocks cross-origin requests.
    const ANTHROPIC_API_VERSION = '2023-06-01';

    // Anthropic requires max_tokens on every request, unlike the
    // OpenAI-compatible providers where the game omits it (GAME_MAX_TOKENS =
    // null) so reasoning models finish naturally. When no explicit cap is
    // supplied we fall back to this generous value: it is a ceiling, not a
    // target (the model stops on its own), but 300 was too small once the
    // model emits any thinking/reasoning tokens — those count against
    // max_tokens, so a low cap produced `stop_reason: 'max_tokens'` with empty
    // text and the game logged "Limited API response".
    const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

    function isAnthropicEndpoint(apiUrl) {
        try {
            const host = new URL(apiUrl).hostname.toLowerCase();
            return host === 'api.anthropic.com' || host.endsWith('.anthropic.com');
        } catch (e) {
            return false;
        }
    }

    // Accepts both `https://api.anthropic.com/` and `.../v1/` inputs and
    // returns the origin base with trailing slash, so callers can append
    // `v1/messages` / `v1/models` without doubling the version segment.
    function getAnthropicBase(apiUrl) {
        let s = (apiUrl || '').trim().replace(/\/+$/, '');
        if (/\/v1$/i.test(s)) s = s.slice(0, -3);
        if (!s) return '';
        return s + '/';
    }

    function buildAnthropicRequest({ apiUrl, apiKey, model, system, messages, maxTokens = null, stream = false }) {
        const base = getAnthropicBase(apiUrl);
        const url = `${base}v1/messages`;
        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': apiKey || '',
            'anthropic-version': ANTHROPIC_API_VERSION,
            'anthropic-dangerous-direct-browser-access': 'true'
        };
        // max_tokens is required by Anthropic; the game's cascade ends with
        // null (omit for OpenAI), so substitute the shared default.
        // temperature is intentionally never sent (Anthropic default).
        const body = { model, max_tokens: (maxTokens === null || maxTokens === undefined) ? ANTHROPIC_DEFAULT_MAX_TOKENS : maxTokens };
        if (system) body.system = system;
        if (messages) body.messages = messages;
        if (stream) body.stream = true;
        return { url, headers, body };
    }

    function getAnthropicModelsRequest(apiUrl, apiKey) {
        const base = getAnthropicBase(apiUrl);
        return {
            url: `${base}v1/models`,
            headers: {
                'x-api-key': apiKey || '',
                'anthropic-version': ANTHROPIC_API_VERSION,
                'anthropic-dangerous-direct-browser-access': 'true'
            }
        };
    }

    // Extracts plain text from a native Anthropic messages response
    // (`{ content: [{ type: 'text', text }] }`). Throws on API errors so
    // callers share the retry/forfeit path with OpenAI errors.
    function parseAnthropicText(data) {
        if (!data || typeof data !== 'object') throw new Error('Invalid response: empty Anthropic reply');
        if (data.type === 'error' || data.error) {
            const err = data.error || {};
            throw new Error(`API Error: ${err.message || err.type || JSON.stringify(data.error)}`);
        }
        const blocks = Array.isArray(data.content) ? data.content : [];
        const text = blocks.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
        return (text || '').trim();
    }

    // OpenAI's API rejects unknown body fields like chat_template_kwargs,
    // so the thinking param must be omitted for OpenAI endpoints.
    function isOpenAIEndpoint(apiUrl) {
        try {
            const host = new URL(apiUrl).hostname.toLowerCase();
            return host === 'openai.com' || host.endsWith('.openai.com');
        } catch (e) {
            return false;
        }
    }

    // Browser fetch failures surface as bare TypeErrors ("Failed to fetch"),
    // which hides the usual cause: the endpoint blocking cross-origin calls.
    function describeFetchFailure(apiUrl, err) {
        const detail = (err && err.message) ? ` (${err.message})` : '';
        if (isOpenAIEndpoint(apiUrl)) {
            return 'Network error — api.openai.com blocks direct browser requests (CORS). ' +
                'Route through a local OpenAI-compatible proxy and use the Custom preset.' + detail;
        }
        return 'Network error — check connectivity, or the endpoint may block browser requests (CORS).' + detail;
    }

    // ONE place where chat-completions requests are built and cleaned per
    // provider. All callers (game moves, benchmarks) go through here so
    // provider quirks live in exactly one spot:
    // - OpenAI: no temperature (newer/reasoning models reject non-default
    //   values, so it is omitted for the whole endpoint), no
    //   chat_template_kwargs (unknown body fields are rejected), and
    //   max_completion_tokens instead of max_tokens.
    // - Non-OpenAI: chat_template_kwargs.enable_thinking mirrors the toggle,
    //   plus reasoning_effort:'low' when thinking is off (some models ignore
    //   enable_thinking but honor reasoning_effort; 'low' suppresses runaway
    //   output where 'none' can backfire).
    // - Local servers ignore auth → empty key becomes the placeholder.
    function buildChatRequest({ apiUrl, apiKey, model, messages, temperature, maxTokens = null, stream = false, thinkingEnabled = false }) {
        const url = `${apiUrl}chat/completions`;
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${effectiveApiKey(apiUrl, apiKey)}`
        };
        const body = { model, messages };
        const isOpenAI = isOpenAIEndpoint(apiUrl);
        if (!isOpenAI) {
            body.temperature = temperature;
        }
        if (maxTokens !== null && maxTokens !== undefined) {
            body[isOpenAI ? 'max_completion_tokens' : 'max_tokens'] = maxTokens;
        }
        if (stream) {
            body.stream = true;
        }
        if (!isOpenAI) {
            body.chat_template_kwargs = { enable_thinking: !!thinkingEnabled };
            // Reasoning suppression. `enable_thinking:false` alone is ignored by
            // several models; a reasoning_effort hint is honored. Value 'low'
            // (not 'none'): on GLM-5.3-Flash 'none' paradoxically *increases*
            // output — it ran to 8192 tokens over ~93s (finish_reason length) —
            // while 'low' finishes in 2-4s / <150 tokens. DeepSeek ignores the
            // hint's magnitude but still stops naturally. Only sent when the
            // user wants no thinking; models that don't know the field ignore it.
            if (!thinkingEnabled) {
                body.reasoning_effort = 'low';
            }
        }
        return { url, headers, body };
    }

    // Local servers (Ollama) ignore auth: an empty key becomes a placeholder
    // so requests still send a well-formed Bearer header.
    function effectiveApiKey(apiUrl, apiKey) {
        if (apiKey) return apiKey;
        return isLocalBaseUrl(apiUrl) ? 'ollama' : '';
    }

    // Well-known providers. Anthropic now uses its native API
    // (`/v1/messages`, `/v1/models` with x-api-key); everything else stays
    // OpenAI-compatible. Key requirement is relaxed for local URLs (see above).
    function getProviderPresets() {
        return [
            { id: 'nebius', label: 'Nebius Token Factory', url: 'https://api.tokenfactory.nebius.com/v1/', note: '' },
            { id: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1/', note: '' },
            { id: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com/', note: '' },
            { id: 'together', label: 'Together AI', url: 'https://api.together.xyz/v1/', note: '' },
            { id: 'ollama-cloud', label: 'Ollama Cloud', url: 'https://ollama.com/v1/', note: '' },
            { id: 'ollama-local', label: 'Ollama Local', url: 'http://localhost:11434/v1/', note: 'Local Ollama needs no API key — leave it blank.' },
            { id: 'custom', label: 'Custom', url: '', note: '' },
        ];
    }

    const SnakeCore = {
        normalizeApiUrl,
        isValidApiUrl,
        isValidApiKey,
        isNonTextModel,
        filterTextModels,
        wrapPosition,
        toroidalDist,
        wrapBearing,
        calculateNewHead,
        wouldCollideWithSnake,
        wouldCollideWithSnakeBody,
        checkCollision,
        checkHeadToHead,
        findSafeDirection,
        stripThinkingTags,
        parseDirectionReply,
        sortByValueAsc,
        calculatePercentile,
        calculateLatencyStats,
        formatBytes,
        formatTokens,
        extractUsage,
        resolvePlayerCredentials,
        isLocalBaseUrl,
        isOpenAIEndpoint,
        isAnthropicEndpoint,
        getAnthropicBase,
        buildAnthropicRequest,
        getAnthropicModelsRequest,
        parseAnthropicText,
        ANTHROPIC_API_VERSION,
        ANTHROPIC_DEFAULT_MAX_TOKENS,
        describeFetchFailure,
        buildChatRequest,
        effectiveApiKey,
        getProviderPresets,
    };

    global.SnakeCore = SnakeCore;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SnakeCore;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
