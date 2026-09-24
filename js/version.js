// Snake Arena version — single source of truth for the app version.
//
// Loaded as a classic script before js/game.js (exposes global `SnakeVersion`)
// and required directly by Node tests (`module.exports`). DOM-free: game.js
// reads SnakeVersion.APP_VERSION and paints it into #app-version.
(function (global) {
    'use strict';

    // Current app version. Bump this when shipping user-visible changes;
    // snake.html cache-busters (?v=) track it so deploys bust stale assets.
    const APP_VERSION = '7';

    function displayText() {
        return `v${APP_VERSION}`;
    }

    const SnakeVersion = {
        APP_VERSION,
        displayText,
    };

    global.SnakeVersion = SnakeVersion;
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SnakeVersion;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
