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

    // Extracted from getLLMDirection: first direction word in a chatty reply.
    // Returns 'up'|'down'|'left'|'right' or null.
    function parseDirectionReply(text) {
        if (typeof text !== 'string') return null;
        return text.toLowerCase().match(/\b(up|down|left|right)\b/)?.[1] || null;
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
        parseDirectionReply,
        calculatePercentile,
        calculateLatencyStats,
        formatBytes,
    };

    global.SnakeCore = SnakeCore;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SnakeCore;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
