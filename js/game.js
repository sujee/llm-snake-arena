// Game Configuration
const GRID_SIZE = 30;
const CELL_SIZE = 20;
const CANVAS_WIDTH = GRID_SIZE * CELL_SIZE;
const CANVAS_HEIGHT = GRID_SIZE * CELL_SIZE;
const NUM_FRUITS = 3; // Number of fruits on board

// Timing and Retry Constants
const LLM_TIMEOUT_MS = 30000; // 30 second timeout for LLM responses
const API_RETRY_DELAY_MS = 2000; // 2 second delay between API retries
const MAX_API_RETRIES = 10; // Max retry attempts for non-429 errors
const MAX_429_RETRIES = 3; // Max retry attempts specifically for 429 rate limit errors
const MAX_TIMEOUT_RETRIES = 5; // Max consecutive move-timeout retries before the game gives up
const MAX_CONSECUTIVE_FAILURES = 3; // Max consecutive failures before forfeiting (for demo mode)

// Animation and Effects Constants
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

// Max <p> entries kept in the game log DOM. Older entries are trimmed from the
// top as new ones are added, so a long single game (or a resumed loop session)
// can't accumulate unbounded nodes. Reset on restart/loop round still wipes all.
const MAX_LOG_ENTRIES = 100;

// LLM Configuration
// If true, passes the full GRID_SIZE x GRID_SIZE board to the LLM
// Visibility Control System
// LLM_FULL_GRID_VIEW = true for full 30x30 grid visibility
// LLM_FULL_GRID_VIEW = false and adjust VIEW_RADIUS for limited visibility
// VIEW_RADIUS can be controlled from the UI (default initialized to 10)
const LLM_FULL_GRID_VIEW = false;
let VIEW_RADIUS = 10; // Initialized to 10 as requested, can be changed from UI
// If true, provides a list of safe moves in the prompt (helps LLM avoid collisions)
let collisionAvoidanceEnabled = true;
// If true, the prompt includes the FRUITS list (coordinates / value / distance)
// — raw hints only, no target recommendation; the LLM picks its own fruit. When
// false the model must spot fruit emojis on the board view itself — most LLMs
// are too weak at 2D grid reasoning for that (they drift in straight lines), so
// this is effectively always ON. Code-level toggle (formerly an Options UI
// checkbox, removed since the off state isn't viable gameplay).
const fruitGuidanceEnabled = true;
// If true, each fruit in the prompt also gets its wrap-aware Distance and
// compass-bearing hint (e.g. "Distance: 3 (3 right)"). When false, the list
// carries only emoji + coordinates + value — the model must do the
// coordinates→direction/distance arithmetic itself (most small models can't).
// Controlled by the Options UI toggle "🧭 Provide Hints".
let provideHintsEnabled = true;
// If true, lets the model "think"/reason before answering (chat_template_kwargs.enable_thinking)
let thinkingModeEnabled = false;
// If true, every turn and detailed API/Timing log is printed to the game log.
// If false (default), only key game events (food eaten, collisions avoided, deaths, winner) are logged.
let allLogsEnabled = false;

// LLM System Prompt
const SYSTEM_PROMPT1 = `You are a snake game AI with LIMITED VISIBILITY. Goal: SURVIVE longer than your opponent while eating fruits to grow. Respond with ONLY ONE WORD: up, down, left, or right. No thinking, no explanation, no extra text.

- VISIBILITY: you see a {VISIBILITY_SIZE}x{VISIBILITY_SIZE} area centered on your head; beyond it is unknown.
- WALLS: safe - you wrap through to the other side, but the destination must be clear.
- SURVIVAL: never move into YOUR OWN BODY or the ENEMY SNAKE (instant death). Prioritize survival over fruit.
- FRUIT: when safe, prefer HIGH-VALUE fruits (⭐💎🦋🎁). Fruits are drawn on the board as their own emoji and listed with value{HINTS_DESC}. Pick a target and commit to it — don't keep switching goals; oscillating wastes moves.
- DIRECTION: your current direction is reported each turn; you cannot reverse into your own neck, so at most 3 moves are ever really available.
- SPACE: favor moves into open space; avoid tight spots alongside your body. When your body blocks a direction, move away from it.
`;

// Use SYSTEM_PROMPT1 as the system prompt
const SYSTEM_PROMPT = SYSTEM_PROMPT1;

// Fruit types with different points and colors
const FRUIT_TYPES = [
    { emoji: '🍎', value: 1, color: '#FF6B6B' },   // Apple - common
    { emoji: '🍇', value: 2, color: '#9B5DE5' },   // Grapes - medium
    { emoji: '⭐', value: 3, color: '#FFD93D' },   // Star - rare
    { emoji: '🍒', value: 2, color: '#FF4444' },   // Cherry - medium
    { emoji: '💎', value: 4, color: '#00D9FF' },   // Diamond - rare
    { emoji: '🦋', value: 3, color: '#00F5D4' },   // Butterfly - special
    { emoji: '🎁', value: 5, color: '#FF9F1C' },   // Present - rare
];

// Game State
// Universal max_tokens cascade for all models
const MAX_TOKENS_CASCADE = [10, 100, 1000, null]; // null means omit max_tokens parameter

// Track max_tokens level per player (persists across moves in same game)
let playerMaxTokensLevel = {
    1: 0, // Both start at level 0 (max_tokens=10)
    2: 0
};

let gameState = {
    snake1: [],
    snake2: [],
    fruits: [], // Array of fruits instead of single food
    direction1: null,
    direction2: null,
    nextDirection1: null,
    nextDirection2: null,
    gameOver: false,
    paused: false,
    player1Dead: false,
    player2Dead: false,
    player1MoveNumber: 0,
    player2MoveNumber: 0,
    player1ApiCalls: 0,
    player2ApiCalls: 0,
    player1ApiFailures: 0,
    player2ApiFailures: 0,
    player1ConsecutiveFailures: 0,
    player2ConsecutiveFailures: 0,
    turnDelay: 0,
    // Per-player provider credentials (Provider 1 always serves Player 1;
    // Player 2 uses Provider 1 when sameProvider, else Provider 2).
    sameProvider: true,
    player1ApiUrl: '',
    player1ApiKey: '',
    player2ApiUrl: '',
    player2ApiKey: '',
    player1Model: '',
    player2Model: '',
    debugMode: false,
    overlayDismissed: false,
    gameStartTime: null,
    gamePausedTime: 0,
    winnerLogged: false, // Flag to prevent duplicate winner logs
    // LLM data tracking
    player1DataSent: 0,      // Total bytes sent to LLM for player 1
    player1DataReceived: 0,  // Total bytes received from LLM for player 1
    player2DataSent: 0,      // Total bytes sent to LLM for player 2
    player2DataReceived: 0,  // Total bytes received from LLM for player 2
    // Token usage tracking (real `usage` from the API when present,
    // ~chars/4 estimate fallback when the provider omits it)
    player1InputTokens: 0,
    player1OutputTokens: 0,
    player2InputTokens: 0,
    player2OutputTokens: 0,
    // Loop mode
    loopMode: false,
    loopCountdownRemaining: 0,
    loopCountdownInterval: null,
    loopRoundNumber: 0,
    finalElapsedTime: 0 // Final elapsed time when game ends
};

// DOM Elements
const apiUrlInput1 = document.getElementById('api-url-1');
const apiKeyInput1 = document.getElementById('api-key-1');
const apiUrlInput2 = document.getElementById('api-url-2');
const apiKeyInput2 = document.getElementById('api-key-2');
const sameProviderCheckbox = document.getElementById('same-provider-checkbox');
const provider2Block = document.getElementById('provider-2-block');
const p1SrcLabel = document.getElementById('p1-src');
const p2SrcLabel = document.getElementById('p2-src');
const sbP1Score = document.getElementById('sb-p1-score');
const sbP1Sub = document.getElementById('sb-p1-sub');
const sbP2Score = document.getElementById('sb-p2-score');
const sbP2Sub = document.getElementById('sb-p2-sub');
const loadModelsBtn = document.getElementById('load-models-btn');
const loadingDiv = document.getElementById('loading');
const modelsLoadedCount = document.getElementById('models-loaded-count');
const modelSelection = document.getElementById('model-selection');
const startBattleBtn = document.getElementById('start-battle-btn');
const errorMessage = document.getElementById('error-message');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const pauseBtn = document.getElementById('pause-btn');
const restartBtn = document.getElementById('restart-btn');
const debugCheckbox = document.getElementById('debug-checkbox');
const collisionAvoidanceCheckbox = document.getElementById('collision-avoidance-checkbox');
const provideHintsCheckbox = document.getElementById('provide-hints-checkbox');
const thinkingModeCheckbox = document.getElementById('thinking-mode-checkbox');
const loopCheckbox = document.getElementById('loop-checkbox');
const allLogsCheckbox = document.getElementById('all-logs-checkbox');
const viewRadiusInput = document.getElementById('view-radius-input');
const logContent = document.getElementById('log-content');
const gameTimerElement = document.getElementById('game-timer');
const timerValueElement = gameTimerElement?.querySelector('.timer-value');
const themeToggleBtn = document.getElementById('theme-toggle-btn');
const themeToggleIcon = document.getElementById('theme-toggle-icon');
let timerInterval = null;

// Searchable dropdown elements
const player1ModelSearch = document.getElementById('player1-model-search');
const player1ModelOptions = document.getElementById('player1-model-options');
const player2ModelSearch = document.getElementById('player2-model-search');
const player2ModelOptions = document.getElementById('player2-model-options');

// Theme (dark / light) — toggle lives in the topbar, persists to localStorage.
function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function getBoardThemeColors() {
    if (getCurrentTheme() === 'light') {
        return { bg: '#ffffff', grid: 'rgba(17, 24, 39, 0.1)' };
    }
    return { bg: '#0a0a15', grid: 'rgba(255, 255, 255, 0.09)' };
}

// Fruit fills per theme: neon hues vanish on the white board, so light
// mode uses deeper variants of the same hue.
function getFruitFill(emoji) {
    const light = getCurrentTheme() === 'light';
    const palette = {
        '🍎': ['#FF6B6B', '#EF4444'],
        '🍇': ['#9B5DE5', '#7C3AED'],
        '⭐': ['#FFD93D', '#B45309'],
        '🍒': ['#FF4444', '#DC2626'],
        '💎': ['#00D9FF', '#0284C7'],
        '🦋': ['#00F5D4', '#0D9488'],
        '🎁': ['#FF9F1C', '#D97706'],
    };
    const pair = palette[emoji] || [emoji, emoji];
    return light ? pair[1] : pair[0];
}

function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
        localStorage.setItem('snake-arena-theme', next);
    } catch (e) { /* private mode: skip persistence */ }
    if (themeToggleBtn) {
        const toLight = next === 'dark'; // button shows what you switch TO
        themeToggleBtn.title = toLight ? 'Switch to light theme' : 'Switch to dark theme';
        themeToggleBtn.setAttribute('aria-label', themeToggleBtn.title);
        themeToggleBtn.setAttribute('aria-pressed', next === 'light' ? 'true' : 'false');
    }
    if (themeToggleIcon) {
        // Moon (in dark) invites light; sun (in light) invites dark.
        themeToggleIcon.textContent = next === 'dark' ? '🌙' : '☀️';
    }
    // Repaint the board with the new surface colors.
    if (typeof draw === 'function' && typeof gameState !== 'undefined') {
        draw();
    }
    // Repaint latency graphs with the new ink colors.
    if (typeof handleResize === 'function') {
        handleResize();
    }
}

function initTheme() {
    let saved = null;
    try {
        saved = localStorage.getItem('snake-arena-theme');
    } catch (e) { /* ignore */ }
    if (saved !== 'light' && saved !== 'dark') {
        saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    applyTheme(saved);
    if (themeToggleBtn) {
        addTrackedEventListener(themeToggleBtn, 'click', () => {
            applyTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
        });
    }
}

// Paint the app version (single source: js/version.js) next to the header
// title. The static "v10" fallback in snake.html covers no-JS loads.
function applyAppVersion() {
    const el = document.getElementById('app-version');
    if (!el) return;
    try {
        if (typeof SnakeVersion !== 'undefined' && SnakeVersion.APP_VERSION) {
            el.textContent = SnakeVersion.displayText
                ? SnakeVersion.displayText()
                : `v${SnakeVersion.APP_VERSION}`;
        }
    } catch (e) { /* keep static fallback */ }
}

// One provider's URL+key validation. Local servers (Ollama) may skip the key.
function validateProviderInput(apiUrl, apiKey, label) {
    if (!apiUrl) {
        showError(`Please enter ${label} API URL`);
        return false;
    }
    if (!isValidApiUrl(apiUrl)) {
        showError(`Please enter a valid ${label} API URL (e.g., https://api.example.com/v1/)`);
        return false;
    }
    if (!apiKey && !SnakeCore.isLocalBaseUrl(apiUrl)) {
        showError(`Please enter ${label} API key`);
        return false;
    }
    if (apiKey && !isValidApiKey(apiKey)) {
        showError(`Please enter a valid ${label} API key`);
        return false;
    }
    return true;
}

// Preset dropdowns: pick fills the URL; editing the URL flips back to Custom.
function initProviderPresets() {
    const presets = SnakeCore.getProviderPresets();
    const groups = [
        { selId: 'provider-1-preset', urlInput: apiUrlInput1, keyInput: apiKeyInput1, noteId: 'provider-1-note', keyPlaceholder: 'API key' },
        { selId: 'provider-2-preset', urlInput: apiUrlInput2, keyInput: apiKeyInput2, noteId: 'provider-2-note', keyPlaceholder: 'Second API key' },
    ];
    groups.forEach((g) => {
        const selEl = document.getElementById(g.selId);
        const noteEl = document.getElementById(g.noteId);
        if (!selEl || !g.urlInput) return;
        presets.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.label;
            selEl.appendChild(opt);
        });
        const applyNote = (id) => {
            const p = presets.find((x) => x.id === id);
            if (noteEl) {
                noteEl.textContent = (p && p.note) || '';
                noteEl.hidden = !(p && p.note);
                noteEl.classList.toggle('warn', !!(p && p.warn));
            }
            if (g.keyInput) {
                g.keyInput.placeholder = id === 'ollama-local' ? 'Not required for local Ollama' : g.keyPlaceholder;
            }
        };
        const matchPreset = () => {
            const v = normalizeApiUrl((g.urlInput.value || '').trim());
            const hit = presets.find((p) => p.url && normalizeApiUrl(p.url) === v);
            selEl.value = hit ? hit.id : 'custom';
            applyNote(selEl.value);
        };
        addTrackedEventListener(selEl, 'change', () => {
            const p = presets.find((x) => x.id === selEl.value);
            if (p && p.url) g.urlInput.value = p.url;
            applyNote(selEl.value);
            if (g.urlInput === apiUrlInput1 && sameProviderCheckbox?.checked) syncCredentialsFromInputs();
        });
        addTrackedEventListener(g.urlInput, 'input', matchPreset);
        matchPreset();
    });
}

// Timer functions
function updateTimerDisplay() {
    const now = Date.now();
    const elapsed = Math.floor((now - gameState.gameStartTime) / 1000); // in seconds
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const display = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    if (timerValueElement) {
        timerValueElement.textContent = display;
    }
    return elapsed;
}

function startTimer() {
    gameState.gameStartTime = Date.now() - (gameState.gamePausedTime * 1000);
    gameState.gamePausedTime = 0;
    timerInterval = setInterval(updateTimerDisplay, 1000);
    updateTimerDisplay();
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function pauseTimer() {
    stopTimer();
    gameState.gamePausedTime = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
}

function resetTimer() {
    stopTimer();
    gameState.gameStartTime = null;
    gameState.gamePausedTime = 0;
    if (timerValueElement) {
        timerValueElement.textContent = '0:00';
    }
}

function getElapsedSeconds() {
    if (!gameState.gameStartTime) return 0;
    if (gameState.paused) return gameState.gamePausedTime;
    const elapsed = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
    return elapsed;
}

// Initialize canvas
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;

// Store event listener references for cleanup
const eventListeners = [];

// Helper to add tracked event listener
function addTrackedEventListener(element, event, handler) {
    element.addEventListener(event, handler);
    eventListeners.push({ element, event, handler });
}

// Helper to remove all tracked event listeners
function removeTrackedEventListeners() {
    eventListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    eventListeners.length = 0;
}

// Store models
let availableModels = []; // union of both providers (benchmark + compat)
let availableModelsP1 = []; // Provider 1 models (Player 1's dropdown)
let availableModelsP2 = []; // Provider 2 models, or P1's list when sameProvider

// Models list backing a player's dropdown.
function modelsForPlayer(playerKey) {
    return playerKey === 'player2' ? availableModelsP2 : availableModelsP1;
}

// Credentials for a player's move request (impl rule: js/core.js).
function getPlayerCredentials(playerNum) {
    return SnakeCore.resolvePlayerCredentials(
        gameState.sameProvider,
        { apiUrl: gameState.player1ApiUrl, apiKey: gameState.player1ApiKey },
        { apiUrl: gameState.player2ApiUrl, apiKey: gameState.player2ApiKey },
        playerNum
    );
}

// Reads the provider inputs into gameState (P2 mirrors P1 when sameProvider).
function syncCredentialsFromInputs() {
    gameState.sameProvider = sameProviderCheckbox ? sameProviderCheckbox.checked : true;
    gameState.player1ApiUrl = normalizeApiUrl((apiUrlInput1?.value || '').trim());
    gameState.player1ApiKey = (apiKeyInput1?.value || '').trim();
    if (gameState.sameProvider) {
        gameState.player2ApiUrl = gameState.player1ApiUrl;
        gameState.player2ApiKey = gameState.player1ApiKey;
    } else {
        gameState.player2ApiUrl = normalizeApiUrl((apiUrlInput2?.value || '').trim());
        gameState.player2ApiKey = (apiKeyInput2?.value || '').trim();
    }
}

// Source labels under each player's dropdown ("↳ Provider 1" etc.).
function updateProviderLabels() {
    if (p1SrcLabel) p1SrcLabel.textContent = '↳ Provider 1';
    if (p2SrcLabel) p2SrcLabel.textContent = gameState.sameProvider ? '↳ Provider 1 (same)' : '↳ Provider 2';
}

// Same-provider checkbox: dim Provider 2, mirror creds, refresh P2's list.
function initProviders() {
    if (!sameProviderCheckbox) return;
    const applySameProvider = () => {
        const same = sameProviderCheckbox.checked;
        gameState.sameProvider = same;
        if (provider2Block) provider2Block.classList.toggle('off', same);
        if (apiUrlInput2) apiUrlInput2.disabled = same;
        if (apiKeyInput2) apiKeyInput2.disabled = same;
        const preset2 = document.getElementById('provider-2-preset');
        if (preset2) preset2.disabled = same;
        // Provider 2 lives in a <details>: open only when separate.
        const details2 = document.getElementById('provider-2-details');
        if (details2) {
            details2.open = !same;
            details2.classList.toggle('off', same);
        }
        const state2 = document.getElementById('provider-2-state');
        if (state2) state2.textContent = same ? '· same as Provider 1' : '· separate endpoint';
        if (same) {
            // P2 shares P1's list and selection stays valid.
            availableModelsP2 = availableModelsP1;
            populateSearchableDropdown(player2ModelOptions, availableModelsP2, 'player2');
        }
        syncCredentialsFromInputs();
        updateProviderLabels();
    };
    addTrackedEventListener(sameProviderCheckbox, 'change', async () => {
        applySameProvider();
        // Unchecking with a configured Provider 2 auto-loads its models.
        if (!sameProviderCheckbox.checked && apiUrlInput2?.value.trim() && apiKeyInput2?.value.trim()) {
            await loadModels();
        }
    });
    // While same-provider is on, P1 edits flow through to P2's creds.
    [apiUrlInput1, apiKeyInput1].forEach((el) => {
        if (el) addTrackedEventListener(el, 'input', () => {
            if (sameProviderCheckbox.checked) syncCredentialsFromInputs();
        });
    });
    // Don't let the P2 <details> open while it shares Provider 1.
    const details2 = document.getElementById('provider-2-details');
    if (details2) addTrackedEventListener(details2, 'toggle', () => {
        if (sameProviderCheckbox.checked && details2.open) details2.open = false;
    });
    applySameProvider();
}

// Game loop abort controller
let gameLoopAbortController = null;

// Latency tracking
let player1GlobalLatencies = []; // All data for stats
let player2GlobalLatencies = [];

// Animation for continuous visual effects
let animationFrame = null;

// Track active timeouts for cleanup
let activeTimeouts = new Set();
let gameLoopTimeout = null;

let needsRedraw = true;

function startAnimation() {
    function animate() {
        // Only redraw when game state has changed or explicitly needed.
        // During game-over/pause the scene is static except the loop countdown,
        // which ticks once per second via updateLoopCountdownDisplay()
        // (sets needsRedraw=true). So gating both branches on needsRedraw
        // avoids a 60fps full-canvas redraw while the overlay is up.
        if (needsRedraw) {
            draw();
            needsRedraw = false;
        }

        animationFrame = requestAnimationFrame(animate);
    }
    animate();
}

function stopAnimation() {
    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
}

// Cleanup function to clear all tracked resources
function cleanupAllResources() {
    // Stop animation
    stopAnimation();

    // Stop timers
    stopTimer();

    // Stop loop countdown if running
    stopLoopCountdown();

    // Clear all tracked timeouts
    activeTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    activeTimeouts.clear();

    // Clear game loop timeout
    if (gameLoopTimeout) {
        clearTimeout(gameLoopTimeout);
        gameLoopTimeout = null;
    }

    // Remove all tracked event listeners
    removeTrackedEventListeners();

    // Abort any pending requests
    if (gameLoopAbortController) {
        gameLoopAbortController.abort();
        gameLoopAbortController = null;
    }

    // Reset latency data
    player1GlobalLatencies = [];
    player2GlobalLatencies = [];
}

// Event Listeners - use tracked listeners for cleanup
addTrackedEventListener(loadModelsBtn, 'click', loadModels);
addTrackedEventListener(startBattleBtn, 'click', () => {
        startGame(false); // Pass false to indicate this is a manual click
    });
addTrackedEventListener(pauseBtn, 'click', togglePause);
if (restartBtn) addTrackedEventListener(restartBtn, 'click', restartGame);
if (debugCheckbox) {
    addTrackedEventListener(debugCheckbox, 'change', toggleDebug);
    addTrackedEventListener(debugCheckbox, 'click', showDebugTooltip);
}

if (collisionAvoidanceCheckbox) {
    addTrackedEventListener(collisionAvoidanceCheckbox, 'change', toggleCollisionAvoidance);
}

if (provideHintsCheckbox) {
    addTrackedEventListener(provideHintsCheckbox, 'change', toggleProvideHints);
}

if (thinkingModeCheckbox) {
    addTrackedEventListener(thinkingModeCheckbox, 'change', toggleThinkingMode);
}

if (allLogsCheckbox) {
    addTrackedEventListener(allLogsCheckbox, 'change', toggleAllLogs);
}

if (loopCheckbox) {
    addTrackedEventListener(loopCheckbox, 'change', toggleLoopMode);
    // Also add click handler for better responsiveness
    addTrackedEventListener(loopCheckbox, 'click', (e) => {
        if (gameState.debugMode) {
            console.log('Loop checkbox clicked!', e.target.checked);
        }
    });
}

if (viewRadiusInput) {
    addTrackedEventListener(viewRadiusInput, 'change', () => {
        updateViewRadius(viewRadiusInput.value);
    });
    addTrackedEventListener(viewRadiusInput, 'input', () => {
        // Also update on input for real-time feedback
        updateViewRadius(viewRadiusInput.value);
    });
}

// Searchable dropdown event listeners
if (player1ModelSearch && player1ModelOptions) {
    setupSearchableDropdown(player1ModelSearch, player1ModelOptions, 'player1');
}
if (player2ModelSearch && player2ModelOptions) {
    setupSearchableDropdown(player2ModelSearch, player2ModelOptions, 'player2');
}

// Dismiss game over overlay on canvas click
if (canvas) {
    addTrackedEventListener(canvas, 'click', () => {
        if (gameState.gameOver) {
            gameState.overlayDismissed = true;
            needsRedraw = true;
        }
    });
}

// Latency graph mouse interaction - Player 1
const p1LatencyCanvas = document.getElementById('p1-latency-canvas');
if (p1LatencyCanvas) {
    addTrackedEventListener(p1LatencyCanvas, 'mousemove', (e) => handleLatencyGraphMouseMove(e, p1LatencyCanvas, 1));
    addTrackedEventListener(p1LatencyCanvas, 'mouseleave', () => handleLatencyGraphMouseLeave(p1LatencyCanvas));
}

// Latency graph mouse interaction - Player 2
const p2LatencyCanvas = document.getElementById('p2-latency-canvas');
if (p2LatencyCanvas) {
    addTrackedEventListener(p2LatencyCanvas, 'mousemove', (e) => handleLatencyGraphMouseMove(e, p2LatencyCanvas, 2));
    addTrackedEventListener(p2LatencyCanvas, 'mouseleave', () => handleLatencyGraphMouseLeave(p2LatencyCanvas));
}

// Initialize collapsible sections
function initializeCollapsibleSections() {
    const toggleButtons = document.querySelectorAll('.collapse-toggle');

    toggleButtons.forEach(button => {
        addTrackedEventListener(button, 'click', (e) => {
            e.stopPropagation();
            const sectionId = button.dataset.section;
            const content = document.getElementById(sectionId.replace('-section', '-content'));
            const icon = button.querySelector('.collapse-icon');

            if (content) {
                const isCollapsed = content.classList.contains('collapsed');
                if (isCollapsed) {
                    // Expand
                    content.classList.remove('collapsed');
                    content.style.maxHeight = content.scrollHeight + 'px';
                    icon.textContent = '▼';
                    setTimeout(() => {
                        content.style.maxHeight = null;
                    }, 300);
                } else {
                    // Collapse
                    content.style.maxHeight = content.scrollHeight + 'px';
                    content.classList.add('collapsed');
                    setTimeout(() => {
                        content.style.maxHeight = '0';
                    }, 10);
                    icon.textContent = '▶';
                }
            }
        });

        // Whole header row toggles (button clicks are handled above).
        const header = button.closest('.collapsible-section')?.querySelector('.section-header');
        if (header && !header.dataset.toggleWired) {
            header.dataset.toggleWired = '1';
            addTrackedEventListener(header, 'click', (e) => {
                if (e.target.closest('.collapse-toggle')) return;
                e.stopPropagation();
                button.click();
            });
        }
    });
}

// Call initialization
initializeCollapsibleSections();

// Programmatic collapse/expand for a collapsible section (reuses the toggle).
function setSectionCollapsed(sectionId, collapse) {
    const content = document.getElementById(sectionId.replace('-section', '-content'));
    const btn = document.querySelector(`.collapse-toggle[data-section="${sectionId}"]`);
    if (!content || !btn) return;
    if (content.classList.contains('collapsed') !== collapse) btn.click();
}

// Initialize loop mode from checkbox state
if (loopCheckbox) {
    gameState.loopMode = loopCheckbox.checked;
    if (gameState.debugMode) {
        console.log(`Loop mode initialized: ${gameState.loopMode ? 'enabled' : 'disabled'}`);
    }
} else if (gameState.debugMode) {
    console.error('Loop checkbox not found during initialization!');
}

// Initialize all-logs mode from checkbox state (default off)
if (allLogsCheckbox) {
    allLogsEnabled = allLogsCheckbox.checked;
}

// Fruit info with rarity labels (data source for the legend popover)
const FRUIT_LEGEND_INFO = [
    { emoji: '🍎', name: 'Apple', value: 1, rarity: 'Common (40%)' },
    { emoji: '⭐', name: 'Star', value: 3, rarity: 'Uncommon (25%)' },
    { emoji: '🍇', name: 'Grapes', value: 2, rarity: 'Uncommon (15%)' },
    { emoji: '🍒', name: 'Cherry', value: 2, rarity: 'Rare (10%)' },
    { emoji: '🦋', name: 'Butterfly', value: 3, rarity: 'Rare (6%)' },
    { emoji: '💎', name: 'Diamond', value: 4, rarity: 'Very Rare (3%)', isRare: true },
    { emoji: '🎁', name: 'Present', value: 5, rarity: 'Ultra Rare (1%)', isUltraRare: true },
];

// Build the legend fruit rows into the given container (reused by the popover).
function buildFruitLegendRows(container) {
    container.innerHTML = '';
    FRUIT_LEGEND_INFO.forEach(fruit => {
        const item = document.createElement('div');
        item.className = `fruit-item ${fruit.isUltraRare ? 'ultra-rare' : fruit.isRare ? 'rare' : ''}`;

        const icon = document.createElement('div');
        icon.className = 'fruit-icon';
        icon.textContent = fruit.emoji; // trusted constant, no user input

        const info = document.createElement('div');
        info.className = 'fruit-info';

        const name = document.createElement('div');
        name.className = 'fruit-name';
        name.textContent = fruit.name;

        const value = document.createElement('div');
        value.className = 'fruit-value';
        value.textContent = `+${fruit.value}`;

        const rarity = document.createElement('div');
        rarity.className = 'fruit-rarity';
        rarity.textContent = fruit.rarity;

        info.appendChild(name);
        info.appendChild(value);
        info.appendChild(rarity);
        item.appendChild(icon);
        item.appendChild(info);
        container.appendChild(item);
    });
}

// --- Fruit legend popover controller -------------------------------------
// Mirrors the benchmark sort flyout lifecycle (js/benchmark.js sortModelsBySpeed /
// _closeSortMenu / _positionSortMenu): a position:fixed <div> appended to
// <body>, pinned to the trigger button, with outside-click + Escape dismiss
// and scroll/resize repositioning. Full listener teardown on close.
let _fruitLegendPopover = null;
let _fruitLegendOutsideHandler = null;
let _fruitLegendKeyHandler = null;
let _fruitLegendRepositionHandler = null;

function toggleFruitLegendPopover() {
    const btn = document.getElementById('fruit-legend-btn');
    if (!btn) return;

    // Toggle: if already open, close it.
    if (_fruitLegendPopover && _fruitLegendPopover.parentNode) {
        closeFruitLegendPopover();
        return;
    }

    const popover = document.createElement('div');
    popover.className = 'fruit-legend-popover';
    const title = document.createElement('div');
    title.className = 'fruit-legend-popover-title';
    title.textContent = 'Fruit Legend';
    const content = document.createElement('div');
    content.className = 'fruit-legend-content';
    buildFruitLegendRows(content);
    popover.appendChild(title);
    popover.appendChild(content);

    // Append to <body> so the flyout escapes any overflow:hidden / scrollable
    // ancestor, then position relative to the button.
    document.body.appendChild(popover);
    _fruitLegendPopover = popover;
    positionFruitLegendPopover();
    btn.classList.add('fruit-legend-btn-active');
    btn.setAttribute('aria-expanded', 'true');

    // Outside-click / Escape dismisses the popover.
    _fruitLegendOutsideHandler = (e) => {
        if (!popover.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
            closeFruitLegendPopover();
        }
    };
    _fruitLegendKeyHandler = (e) => {
        if (e.key === 'Escape') closeFruitLegendPopover();
    };
    // Keep the popover pinned to the button while the page scrolls/resizes.
    _fruitLegendRepositionHandler = () => positionFruitLegendPopover();
    // Defer attaching so the click that opened the popover doesn't close it.
    setTimeout(() => {
        document.addEventListener('click', _fruitLegendOutsideHandler);
        document.addEventListener('keydown', _fruitLegendKeyHandler);
        window.addEventListener('scroll', _fruitLegendRepositionHandler, true);
        window.addEventListener('resize', _fruitLegendRepositionHandler);
    }, 0);
}

function closeFruitLegendPopover() {
    if (_fruitLegendPopover && _fruitLegendPopover.parentNode) {
        _fruitLegendPopover.parentNode.removeChild(_fruitLegendPopover);
    }
    _fruitLegendPopover = null;
    if (_fruitLegendOutsideHandler) {
        document.removeEventListener('click', _fruitLegendOutsideHandler);
        _fruitLegendOutsideHandler = null;
    }
    if (_fruitLegendKeyHandler) {
        document.removeEventListener('keydown', _fruitLegendKeyHandler);
        _fruitLegendKeyHandler = null;
    }
    if (_fruitLegendRepositionHandler) {
        window.removeEventListener('scroll', _fruitLegendRepositionHandler, true);
        window.removeEventListener('resize', _fruitLegendRepositionHandler);
        _fruitLegendRepositionHandler = null;
    }
    const btn = document.getElementById('fruit-legend-btn');
    if (btn) {
        btn.classList.remove('fruit-legend-btn-active');
        btn.setAttribute('aria-expanded', 'false');
    }
}

/**
 * Pin the popover just below the trigger button, left-aligned to it. Flips to
 * the right side if there's no room on the left, and clamps vertically so a
 * long popover never runs off the bottom of the viewport. Mirrors the edge
 * logic in _positionSortMenu (js/benchmark.js). Uses fixed coords so it isn't
 * affected by page scroll.
 */
function positionFruitLegendPopover() {
    if (!_fruitLegendPopover) return;
    const btn = document.getElementById('fruit-legend-btn');
    if (!btn) return;
    const popover = _fruitLegendPopover;
    const btnRect = btn.getBoundingClientRect();

    // Measure once placed to decide edge flips.
    popover.style.left = '0px';
    popover.style.top = '0px';
    const popoverRect = popover.getBoundingClientRect();

    let left = btnRect.left;
    // Flip to the right side if it would overflow the viewport's left edge.
    if (left + popoverRect.width > window.innerWidth) {
        left = window.innerWidth - popoverRect.width - 8;
    }
    if (left < 8) left = 8;

    let top = btnRect.bottom + 6;
    // Clamp vertically so a long popover never runs off the bottom of the screen.
    const maxTop = Math.max(8, window.innerHeight - popoverRect.height - 8);
    if (top > maxTop) {
        // Not enough room below: open upward from the button's top instead.
        top = Math.max(8, btnRect.top - popoverRect.height - 6);
    }

    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
}

// Wire the trigger button.
const fruitLegendBtn = document.getElementById('fruit-legend-btn');
if (fruitLegendBtn) {
    fruitLegendBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFruitLegendPopover();
    });
}

// Normalize API URL - ensure trailing slash (impl: js/core.js)
function normalizeApiUrl(url) {
    return SnakeCore.normalizeApiUrl(url);
}

// Validate API URL format (impl: js/core.js)
function isValidApiUrl(url) {
    return SnakeCore.isValidApiUrl(url);
}

// Validate API key format (impl: js/core.js)
function isValidApiKey(apiKey) {
    return SnakeCore.isValidApiKey(apiKey);
}

// Filter models to text-to-text only (impl: js/core.js)
function filterTextModels(models) {
    return SnakeCore.filterTextModels(models);
}

// Check if a model is clearly NOT a text-to-text model (impl: js/core.js)
function isNonTextModel(modelId) {
    return SnakeCore.isNonTextModel(modelId);
}

// Sort helper (by id, case-insensitive)
function sortModelsById(a, b) {
    const nameA = (a.name || a.id || '').toLowerCase();
    const nameB = (b.name || b.id || '').toLowerCase();
    return nameA.localeCompare(nameB);
}

// Tag models with their provider (1 or 2) so moves/benchmarks use the right creds.
function tagProvider(models, providerNum) {
    models.forEach(m => { m._provider = providerNum; });
    return models;
}

// Fetch + filter + sort models for ONE provider (verbose→standard fallback).
// Anthropic uses its native `/v1/models` endpoint with x-api-key auth.
// Returns { models, total }. Throws on failure; caller adds provider context.
async function fetchProviderModels(apiUrl, apiKey) {
    if (SnakeCore.isAnthropicEndpoint(apiUrl)) {
        let response;
        try {
            const req = SnakeCore.getAnthropicModelsRequest(apiUrl, apiKey);
            response = await fetch(req.url, { method: 'GET', headers: req.headers, credentials: 'omit' });
        } catch (networkError) {
            throw new Error(SnakeCore.describeFetchFailure(apiUrl, networkError));
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        let data;
        try {
            data = JSON.parse(await response.text());
        } catch (jsonError) {
            throw new Error(`Invalid JSON response: ${jsonError.message}`);
        }
        const allModels = data.data || [];
        if (allModels.length === 0) {
            throw new Error('No models found in API response');
        }
        const models = filterTextModels(allModels);
        if (models.length === 0) {
            throw new Error('No text-to-text models found in API response');
        }
        models.sort(sortModelsById);
        return { models, total: allModels.length };
    }

    let response;
    let data = null;

    // OpenAI has no verbose endpoint — go straight to the standard one.
    if (!SnakeCore.isOpenAIEndpoint(apiUrl)) {
        try {
            response = await fetch(`${apiUrl}models?verbose=true`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                credentials: 'omit'
            });
            if (!response.ok) throw new Error('Verbose request failed');
            data = JSON.parse(await response.text());
            const sample = data.data && data.data[0];
            const hasVerbose = sample && ((sample.architecture && sample.architecture.modality) ||
                (sample.capabilities && sample.capabilities.modalities));
            if (!data.data || data.data.length === 0 || !hasVerbose) {
                data = null;
            }
        } catch (verboseError) {
            data = null;
        }
    } else {
        console.log('ℹ️ Skipping verbose models request (not supported by OpenAI)');
    }

    if (!data) {
        try {
            response = await fetch(`${apiUrl}models`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                credentials: 'omit'
            });
        } catch (networkError) {
            throw new Error(SnakeCore.describeFetchFailure(apiUrl, networkError));
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        try {
            data = JSON.parse(await response.text());
        } catch (jsonError) {
            throw new Error(`Invalid JSON response: ${jsonError.message}`);
        }
    }

    const allModels = data.data || [];
    if (allModels.length === 0) {
        throw new Error('No models found in API response');
    }
    const models = filterTextModels(allModels);
    if (models.length === 0) {
        throw new Error('No text-to-text models found in API response');
    }
    models.sort(sortModelsById);
    return { models, total: allModels.length };
}

// Load models from one or both providers into per-player lists.
async function loadModels() {
    syncCredentialsFromInputs();
    const apiUrl = gameState.player1ApiUrl;
    const apiKey = gameState.player1ApiKey;
    const same = gameState.sameProvider;

    // Clear any previous error messages
    clearError();

    if (!validateProviderInput(apiUrl, apiKey, 'Provider 1')) return;

    if (!same && !validateProviderInput(gameState.player2ApiUrl, gameState.player2ApiKey, 'Provider 2')) return;

    loadingDiv.classList.remove('hidden');

    try {
        // Provider 1: native Anthropic path reuses fetchProviderModels
        // (x-api-key auth, no verbose endpoint). OpenAI-compatible path
        // keeps the verbose→standard fallback below.
        let allModels;
        let p1TotalDisplay = 0;
        if (SnakeCore.isAnthropicEndpoint(apiUrl)) {
            const p1 = await fetchProviderModels(apiUrl, apiKey);
            availableModelsP1 = tagProvider(p1.models, 1);
            if (availableModelsP1.length === 0) {
                throw new Error('No text-to-text models found in API response');
            }
            availableModelsP1.sort(sortModelsById);
            console.log(`✅ Loaded ${availableModelsP1.length} text-to-text models (filtered from ${p1.total} total)`);
            allModels = p1.models;
            p1TotalDisplay = p1.total;
        } else {
        let response;
        let data;
        let hasVerboseData = false;

        // Try verbose=true first (works with Nebius, etc.). OpenAI has no
        // verbose endpoint, so it goes straight to the standard request
        // without a misleading "failed, falling back" message.
        const tryVerbose = !SnakeCore.isOpenAIEndpoint(apiUrl);
        if (tryVerbose) {
            try {
                console.log('🔄 Attempting to fetch models with verbose=true...');
                response = await fetch(`${apiUrl}models?verbose=true`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    },
                    credentials: 'omit'
                });

                if (!response.ok) throw new Error('Verbose request failed');

                const responseText = await response.text();
                data = JSON.parse(responseText);

                // Check if we actually got verbose data with architecture info
                if (data.data && data.data.length > 0) {
                    const sampleModel = data.data[0];

                    // Check for architecture.modality (Nebius style)
                    if (sampleModel.architecture && sampleModel.architecture.modality) {
                        hasVerboseData = true;
                        console.log('✅ Using verbose response with architecture.modality data');
                    }
                    // Check for capabilities.modalities (OpenAI style)
                    else if (sampleModel.capabilities && sampleModel.capabilities.modalities) {
                        hasVerboseData = true;
                        console.log('✅ Using verbose response with capabilities.modalities data');
                    } else {
                        // Verbose response received but no useful data
                        console.log('⚠️ Verbose response received but no architecture/capabilities data');
                        throw new Error('No useful verbose data');
                    }
                } else {
                    throw new Error('No models in verbose response');
                }
            } catch (verboseError) {
                console.log('ℹ️ Verbose request failed, falling back to standard request');
                data = undefined;
            }
        } else {
            console.log('ℹ️ Skipping verbose request (not supported by OpenAI)');
        }

        if (!data) {
            // Standard request (verbose skipped or failed)
            try {
                response = await fetch(`${apiUrl}models`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    },
                    credentials: 'omit'
                });
            } catch (networkError) {
                throw new Error(SnakeCore.describeFetchFailure(apiUrl, networkError));
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const responseText = await response.text();
            try {
                data = JSON.parse(responseText);
            } catch (jsonError) {
                console.error('Failed to parse JSON response:', responseText);
                throw new Error(`Invalid JSON response: ${jsonError.message}`);
            }
            hasVerboseData = false;
        }

        allModels = data.data || [];
        p1TotalDisplay = allModels.length;

        if (allModels.length === 0) {
            throw new Error('No models found in API response');
        }

        // Log sample model structure for debugging
        const sampleModel = allModels[0];
        console.log('📋 Sample model structure:', Object.keys(sampleModel).join(', '));
        if (sampleModel.architecture) {
            console.log(`   architecture.modality: ${sampleModel.architecture.modality || 'not present'}`);
        }
        if (sampleModel.capabilities) {
            console.log(`   capabilities.modalities: ${sampleModel.capabilities.modalities ? sampleModel.capabilities.modalities.join(', ') : 'not present'}`);
        }

        // Filter to text-to-text models only (handles missing attributes gracefully)
        availableModelsP1 = tagProvider(filterTextModels(allModels), 1);

        if (availableModelsP1.length === 0) {
            throw new Error('No text-to-text models found in API response');
        }

        // Sort models alphabetically (case-insensitive)
        availableModelsP1.sort(sortModelsById);

        console.log(`✅ Loaded ${availableModelsP1.length} text-to-text models (filtered from ${allModels.length} total)`);
        } // end OpenAI-compatible Provider 1 path

        // Provider 2: same list when sharing, otherwise its own fetch.
        let p2Total = allModels.length;
        if (same) {
            availableModelsP2 = availableModelsP1;
        } else {
            try {
                const p2 = await fetchProviderModels(gameState.player2ApiUrl, gameState.player2ApiKey);
                availableModelsP2 = tagProvider(p2.models, 2);
                p2Total = p2.total;
                console.log(`✅ Loaded ${availableModelsP2.length} Provider 2 models (filtered from ${p2Total} total)`);
            } catch (p2Error) {
                throw new Error(`Provider 2: ${p2Error.message}`);
            }
        }

        // Union (benchmark + compat); per-player lists back each dropdown.
        availableModels = [...availableModelsP1];
        if (!same) {
            const p1Ids = new Set(availableModelsP1.map(m => m.id));
            availableModelsP2.forEach(m => {
                if (!p1Ids.has(m.id)) availableModels.push(m);
            });
        }

        populateModelSelects();
        loadingDiv.classList.add('hidden');

        // Show how many models loaded (text-to-text, filtered from total)
        if (modelsLoadedCount) {
            modelsLoadedCount.textContent = same
                ? `✓ Loaded ${availableModelsP1.length} models (of ${p1TotalDisplay || allModels.length} total)`
                : `✓ Loaded ${availableModelsP1.length} (P1) + ${availableModelsP2.length} (P2) models`;
            modelsLoadedCount.classList.remove('hidden');
        }

        // Dispatch event for demo mode
        console.log('🎮 Dispatching modelsLoaded event');
        document.dispatchEvent(new CustomEvent('modelsLoaded'));
        console.log('🎮 modelsLoaded event dispatched');

        // Providers are set — collapse the section until they're needed again.
        setSectionCollapsed('connection-section', true);
    } catch (error) {
        loadingDiv.classList.add('hidden');
        if (modelsLoadedCount) modelsLoadedCount.classList.add('hidden');
        showError(`Failed to load models: ${error.message}`);
        // Surface the provider inputs so the failure can be fixed in place.
        setSectionCollapsed('connection-section', false);
        console.error('Error loading models:', error);
    }
}

// Populate model searchable dropdowns (each player from its own provider list)
function populateModelSelects() {
    // Select different default models if available
    if (availableModelsP1.length > 1) {
        gameState.player1Model = availableModelsP1[0].id;
        player1ModelSearch.value = availableModelsP1[0].id.split('/').pop();
    } else if (availableModelsP1.length > 0) {
        gameState.player1Model = availableModelsP1[0].id;
        player1ModelSearch.value = availableModelsP1[0].id.split('/').pop();
    }
    if (availableModelsP2.length > 1) {
        // Prefer a different model than P1 when possible
        const alt = availableModelsP2.find(m => m.id !== gameState.player1Model) || availableModelsP2[0];
        gameState.player2Model = alt.id;
        player2ModelSearch.value = alt.id.split('/').pop();
    } else if (availableModelsP2.length > 0) {
        gameState.player2Model = availableModelsP2[0].id;
        player2ModelSearch.value = availableModelsP2[0].id.split('/').pop();
    }

    // Populate Player 1 dropdown
    populateSearchableDropdown(player1ModelOptions, availableModelsP1, 'player1');
    // Populate Player 2 dropdown
    populateSearchableDropdown(player2ModelOptions, availableModelsP2, 'player2');
}

// Force-close every model dropdown and drop focus — starting a battle must
// never leave a selector open over the arena.
function closeAllModelDropdowns() {
    document.querySelectorAll('.dropdown-options').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.searchable-dropdown.open').forEach(el => el.classList.remove('open'));
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
    }
}

// Populate a single searchable dropdown with options
function populateSearchableDropdown(optionsContainer, models, playerKey) {
    optionsContainer.innerHTML = '';

    // Get the currently selected model for this player
    const selectedModelId = playerKey === 'player1' ? gameState.player1Model : gameState.player2Model;
    // Get the selected model for the other player
    const otherPlayerSelectedModelId = playerKey === 'player1' ? gameState.player2Model : gameState.player1Model;

    // Helper function to extract display name from model id
    const getDisplayName = (modelId) => modelId.split('/').pop();

    // Add all models (including selected one) in their natural order
    models.forEach(model => {
        const option = document.createElement('div');
        option.className = 'dropdown-option';
        option.dataset.modelId = model.id;

        // Mark if this model is selected by this player
        if (model.id === selectedModelId) {
            option.classList.add('selected');
            option.textContent = `✓ ${getDisplayName(model.id)}`;
        }
        // Mark if this model is selected by the other player
        else if (model.id === otherPlayerSelectedModelId) {
            option.textContent = `${getDisplayName(model.id)} (P${playerKey === 'player1' ? '2' : '1'})`;
        } else {
            option.textContent = getDisplayName(model.id);
        }

        optionsContainer.appendChild(option);
    });
}

// Setup searchable dropdown behavior
function setupSearchableDropdown(searchInput, optionsContainer, playerKey) {
    let isOpen = false;
    let previousValue = '';

    // Clicking the input wrapper toggles (explicit user intent only).
    const inputWrapper = searchInput.closest('.searchable-dropdown-input-wrapper');
    if (inputWrapper) {
        addTrackedEventListener(inputWrapper, 'click', (e) => {
            e.stopPropagation();
            if (isOpen) {
                closeDropdown();
            } else {
                previousValue = searchInput.value;
                openDropdown();
            }
            searchInput.focus();
        });
    }

    // Focus alone never opens (stray/programmatic focus must not pop a list).
    // It only snapshots the current value for the outside-click revert below.
    addTrackedEventListener(searchInput, 'focus', () => {
        previousValue = searchInput.value;
    });

    // Close dropdown when clicking outside
    addTrackedEventListener(document, 'click', (e) => {
        const inputWrapper = searchInput.closest('.searchable-dropdown-input-wrapper');
        const dropdownParent = searchInput.closest('.searchable-dropdown');

        // Don't close if clicking on the input, wrapper, or dropdown parent
        if (searchInput.contains(e.target) ||
            (inputWrapper && inputWrapper.contains(e.target)) ||
            (dropdownParent && dropdownParent.contains(e.target)) ||
            optionsContainer.contains(e.target)) {
            return;
        }

        // If the value changed to something not in the dropdown, revert.
        // Compare against display names (inputs show the short name, not the id).
        if (searchInput.value && searchInput.value !== previousValue) {
            const list = modelsForPlayer(playerKey);
            const modelExists = list.some(m => m.id === searchInput.value || m.id.split('/').pop() === searchInput.value);
            if (!modelExists) {
                searchInput.value = previousValue;
            }
        }
        closeDropdown();
    });

    // Filter options when user types
    addTrackedEventListener(searchInput, 'input', (e) => {
        // Always open dropdown when typing to show filtered results
        if (!isOpen) {
            openDropdown();
        }
        filterDropdownOptions(e.target.value);
    });

    // Handle option selection
    addTrackedEventListener(optionsContainer, 'click', (e) => {
        const option = e.target.closest('.dropdown-option');
        if (option && !option.classList.contains('no-results') && option.dataset.modelId) {
            selectModel(option.dataset.modelId);
        }
    });

    function openDropdown() {
        isOpen = true;
        // One-time trace hook: set localStorage snake-debug-dropdown=1,
        // reload, reproduce, and the console shows exactly who opened it.
        try {
            if (localStorage.getItem('snake-debug-dropdown') === '1') {
                console.trace(`[dropdown-trace] openDropdown player=${playerKey}`);
            }
        } catch (e) { /* private mode: skip */ }
        optionsContainer.classList.remove('hidden');
        if (searchInput.parentElement && searchInput.parentElement.parentElement) {
            searchInput.parentElement.parentElement.classList.add('open');
        }
        // Show all options when opening
        showAllOptions();
    }

    function closeDropdown() {
        isOpen = false;
        optionsContainer.classList.add('hidden');
        searchInput.parentElement.parentElement.classList.remove('open');
    }

    function showAllOptions() {
        const options = optionsContainer.querySelectorAll('.dropdown-option');
        options.forEach(option => {
            option.style.display = '';
        });

        // Remove no results message if present
        const noResultsElement = optionsContainer.querySelector('.no-results');
        if (noResultsElement) {
            noResultsElement.remove();
        }

        // If no options and no models loaded, show a message
        if (options.length === 0 && modelsForPlayer(playerKey).length === 0) {
            if (!optionsContainer.querySelector('.no-results')) {
                const noModels = document.createElement('div');
                noModels.className = 'dropdown-option no-results';
                noModels.textContent = 'Please click "Load Models" first';
                optionsContainer.appendChild(noModels);
            }
        }
    }

    function filterDropdownOptions(filterText) {
        const filter = filterText.toLowerCase();
        const options = optionsContainer.querySelectorAll('.dropdown-option');

        options.forEach(option => {
            // Extract the actual model ID (removing the checkmark prefix if present)
            let modelId = option.textContent.toLowerCase();
            if (modelId.startsWith('✓ ')) {
                modelId = modelId.substring(2);
            }

            const isVisible = modelId.includes(filter);
            option.style.display = isVisible ? '' : 'none';
        });

        // Show "no results" message
        const hasVisibleOptions = Array.from(options).some(opt => opt.style.display !== 'none');
        if (!hasVisibleOptions) {
            if (!optionsContainer.querySelector('.no-results')) {
                const noResults = document.createElement('div');
                noResults.className = 'dropdown-option no-results';
                noResults.textContent = 'No models found';
                optionsContainer.appendChild(noResults);
            }
        } else {
            const noResultsElement = optionsContainer.querySelector('.no-results');
            if (noResultsElement) {
                noResultsElement.remove();
            }
        }
    }

    function selectModel(modelId) {
        const displayName = (modelsForPlayer(playerKey).find(m => m.id === modelId)?.id || modelId).split('/').pop();
        searchInput.value = displayName;
        previousValue = displayName;

        if (playerKey === 'player1') {
            gameState.player1Model = modelId;
        } else {
            gameState.player2Model = modelId;
        }

        // Repopulate both dropdowns to show updated selections
        populateSearchableDropdown(player1ModelOptions, availableModelsP1, 'player1');
        populateSearchableDropdown(player2ModelOptions, availableModelsP2, 'player2');

        closeDropdown();
        // Drop focus so a later focus event can't reopen the list.
        searchInput.blur();
    }
}




// Show error message
function showError(message) {
    errorMessage.textContent = `⚠️ ${message}`;
    errorMessage.classList.remove('hidden');
}

// Clear error message
function clearError() {
    errorMessage.textContent = '';
    errorMessage.classList.add('hidden');
}

// Cleanup function to clear all tracked resources
function cleanupResources() {
    // Redirect to cleanupAllResources to avoid duplication
    cleanupAllResources();
}

// Clean up game-specific resources only (for restart/back to setup)
function cleanupGameResources() {
    // Stop animation
    stopAnimation();

    // Stop timer
    stopTimer();

    // Stop loop countdown if running
    stopLoopCountdown();

    // Abort any ongoing game loops
    if (gameLoopAbortController) {
        gameLoopAbortController.abort();
        gameLoopAbortController = null;
    }

    // Clear game loop timeout
    if (gameLoopTimeout) {
        clearTimeout(gameLoopTimeout);
        gameLoopTimeout = null;
    }

    // Clear all tracked timeouts
    activeTimeouts.forEach(timeoutId => {
        clearTimeout(timeoutId);
    });
    activeTimeouts.clear();

    // Clean up overlay canvases
    const p1Canvas = document.getElementById('p1-latency-canvas');
    const p2Canvas = document.getElementById('p2-latency-canvas');
    if (p1Canvas?.parentElement) {
        const overlay = p1Canvas.parentElement.querySelector('.latency-graph-overlay');
        if (overlay) overlay.remove();
    }
    if (p2Canvas?.parentElement) {
        const overlay = p2Canvas.parentElement.querySelector('.latency-graph-overlay');
        if (overlay) overlay.remove();
    }
}

// Add log entry.
// - forceLog: always show, even if the game is over (used for winner banners / critical errors).
// - isInteresting: show even when allLogsEnabled is false (used for key game events: food eaten, collisions, deaths).
// - errors (⚠️/❌ messages) always show, even in quiet-log mode.
function addLog(message, playerNum = null, forceLog = false, isInteresting = false) {
    // Stop adding logs once game is over (unless forced for final messages)
    if (gameState.gameOver && !forceLog) {
        return;
    }

    // In quiet-log mode (allLogs off) we skip routine per-turn/API messages unless
    // they are marked as interesting game events, are forced (e.g. game-over banner),
    // or are errors — errors must always be visible.
    const isError = typeof message === 'string' && /^[⚠️❌]/.test(message);
    if (!allLogsEnabled && !forceLog && !isInteresting && !isError) {
        return;
    }

    // Check if we should auto-scroll BEFORE adding content (when scrollHeight is still stable)
    const threshold = 50; // pixels from bottom to consider "at bottom"
    const shouldScroll = logContent.scrollHeight - logContent.scrollTop - logContent.clientHeight < threshold;

    const p = document.createElement('p');

    if (playerNum !== null) {
        // Player-specific move number
        const moveNum = playerNum === 1 ? gameState.player1MoveNumber : gameState.player2MoveNumber;
        const playerColor = playerNum === 1 ? '#FF6B6B' : '#6EA8FF';
        const playerName = playerNum === 1 ? 'P1' : 'P2';

        // Create main span with player info
        const span = document.createElement('span');
        span.style.color = playerColor;
        span.style.fontWeight = 'bold';

        // Check if message contains latency span (safe HTML)
        if (message.includes('<span class="latency"')) {
            // Parse the message to extract text and latency span
            const textPart = message.substring(0, message.indexOf('<span class="latency"'));
            const latencySpanStr = message.substring(message.indexOf('<span class="latency"'));

            // Create text node for the direction
            const textNode = document.createTextNode(`${playerName} - #${moveNum}: ${textPart}`);
            span.appendChild(textNode);

            // Create latency span
            const latencySpan = document.createElement('span');
            latencySpan.className = 'latency';

            // Parse latency attributes from the HTML string
            const dataAttrRegex = /data-latency-(fast|medium|slow)="true"/;
            const match = latencySpanStr.match(dataAttrRegex);
            if (match) {
                latencySpan.setAttribute(`data-latency-${match[1]}`, 'true');
            }

            // Extract latency value
            const latencyValueRegex = /(\d+)ms/;
            const latencyMatch = latencySpanStr.match(latencyValueRegex);
            if (latencyMatch) {
                latencySpan.textContent = `${latencyMatch[1]}ms`;
            }

            span.appendChild(latencySpan);
        } else {
            // Regular message without latency
            span.textContent = `${playerName} - #${moveNum}: ${message}`;
        }

        p.appendChild(span);
    } else {
        // Non-player specific log (game events)
        const span = document.createElement('span');
        span.className = 'turn';

        // Check if message contains HTML (for game results with styling)
        if (message.includes('<span class=') || message.includes('<span class="')) {
            // For game results, we need to use innerHTML since it contains styled spans
            // This is safe because the message content is controlled by the game logic
            span.innerHTML = message;
        } else {
            span.textContent = message;
        }

        p.appendChild(span);
    }

    logContent.appendChild(p);

    // Cap log size: drop oldest entries beyond MAX_LOG_ENTRIES.
    // We trim in a while-loop (not once) in case MAX_LOG_ENTRIES was lowered;
    // for the normal +1 case this runs a single iteration.
    while (logContent.children.length > MAX_LOG_ENTRIES) {
        logContent.removeChild(logContent.firstChild);
    }

    // Auto-scroll only if we were at the bottom before adding content
    if (shouldScroll) {
        requestAnimationFrame(() => {
            logContent.scrollTop = logContent.scrollHeight;
        });
    }
}

// Initialize game state
// Reset function for new games
function resetMaxTokensLevels() {
    playerMaxTokensLevel = { 1: 0, 2: 0 }; // Reset both players to level 0
}

function initializeGame() {
    // Player 1 (Red) starts on left side
    gameState.snake1 = [
        { x: 5, y: 15 },
        { x: 4, y: 15 },
        { x: 3, y: 15 }
    ];
    gameState.direction1 = { x: 1, y: 0 }; // Moving right
    gameState.nextDirection1 = { x: 1, y: 0 };

    // Player 2 (Blue) starts on right side
    gameState.snake2 = [
        { x: 24, y: 15 },
        { x: 25, y: 15 },
        { x: 26, y: 15 }
    ];
    gameState.direction2 = { x: -1, y: 0 }; // Moving left
    gameState.nextDirection2 = { x: -1, y: 0 };

    // Place multiple fruits
    gameState.fruits = [];
    for (let i = 0; i < NUM_FRUITS; i++) {
        placeFruit();
    }

    gameState.gameOver = false;
    gameState.paused = false;
    gameState.player1Dead = false;
    gameState.player2Dead = false;
    gameState.player1MoveNumber = 0;
    gameState.player2MoveNumber = 0;
    gameState.player1ApiCalls = 0;
    gameState.player2ApiCalls = 0;
    gameState.player1ApiFailures = 0;
    gameState.player2ApiFailures = 0;
    gameState.player1ConsecutiveFailures = 0;
    gameState.player2ConsecutiveFailures = 0;
    gameState.turnDelay = 0;
    gameState.finalElapsedTime = 0;

    // Reset LLM data tracking
    gameState.player1DataSent = 0;
    gameState.player1DataReceived = 0;
    gameState.player2DataSent = 0;
    gameState.player2DataReceived = 0;
    gameState.player1InputTokens = 0;
    gameState.player1OutputTokens = 0;
    gameState.player2InputTokens = 0;
    gameState.player2OutputTokens = 0;
    gameState.overlayDismissed = false;
    gameState.winnerLogged = false;

    // Reset max_tokens levels for both players
    resetMaxTokensLevels();

    // Reset stats display in DOM
    document.getElementById('p1-model-name').textContent = 'Player 1';
    document.getElementById('p2-model-name').textContent = 'Player 2';
    document.getElementById('p1-model-stats').textContent = 'length: 3, moves: 0 ↑0B ↓0B';
    document.getElementById('p2-model-stats').textContent = 'length: 3, moves: 0 ↑0B ↓0B';
    resetScoreboard();

    // Reset latency tracking
    resetLatencyTracking();
}

// Place a single fruit at random location
function placeFruit() {
    let validPosition = false;
    let attempts = 0;
    const maxAttempts = 100;

    while (!validPosition && attempts < maxAttempts) {
        attempts++;
        const x = Math.floor(Math.random() * GRID_SIZE);
        const y = Math.floor(Math.random() * GRID_SIZE);

        // Check if position is occupied by snakes or other fruits
        const occupied = gameState.snake1.some(seg => seg.x === x && seg.y === y) ||
                        gameState.snake2.some(seg => seg.x === x && seg.y === y) ||
                        gameState.fruits.some(f => f.x === x && f.y === y);

        if (!occupied) {
            // Random fruit type with weighted probabilities
            const rand = Math.random();
            let typeIndex;
            if (rand < 0.4) typeIndex = 0;      // 40% Apple
            else if (rand < 0.65) typeIndex = 2; // 25% Star
            else if (rand < 0.8) typeIndex = 1;  // 15% Grapes
            else if (rand < 0.9) typeIndex = 3;  // 10% Cherry
            else if (rand < 0.96) typeIndex = 5; // 6% Butterfly
            else if (rand < 0.99) typeIndex = 4; // 3% Diamond
            else typeIndex = 6;                  // 1% Present

            gameState.fruits.push({
                x,
                y,
                type: FRUIT_TYPES[typeIndex],
                spawned: Date.now()
            });
            validPosition = true;
        }
    }
}

// Remove a fruit at specific position
function removeFruit(x, y) {
    const index = gameState.fruits.findIndex(f => f.x === x && f.y === y);
    if (index !== -1) {
        const removed = gameState.fruits.splice(index, 1)[0];
        return removed;
    }
    return null;
}

// Wrap position to stay within grid (impl: js/core.js)
function wrapPosition(x, y) {
    return SnakeCore.wrapPosition(x, y, GRID_SIZE);
}

// Toroidal (wrap-aware) Manhattan distance (impl: js/core.js)
function toroidalDist(ax, ay, bx, by) {
    return SnakeCore.toroidalDist(ax, ay, bx, by, GRID_SIZE);
}

// Wrap-aware compass hint (impl: js/core.js)
function wrapBearing(head, target) {
    return SnakeCore.wrapBearing(head, target, GRID_SIZE);
}

// Get game board state as text for LLM
function getBoardState(playerNum) {
    const snake = playerNum === 1 ? gameState.snake1 : gameState.snake2;
    const enemySnake = playerNum === 1 ? gameState.snake2 : gameState.snake1;
    const enemyColor = playerNum === 1 ? "blue (B)" : "red (R)";
    const myColor = playerNum === 1 ? "red (R)" : "blue (B)";

    const head = snake[0];
    const enemyHead = enemySnake[0];

    // Current direction, resolved once: used in the prompt header and again to
    // filter the forbidden reverse move out of the safe-moves list below.
    const currentDir = playerNum === 1 ? gameState.direction1 : gameState.direction2;
    const DIR_NAMES = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right' };
    const currentDirName = currentDir ? DIR_NAMES[`${currentDir.x},${currentDir.y}`] : 'unknown';

    const distToEnemy = toroidalDist(head.x, head.y, enemyHead.x, enemyHead.y);

    // Build board representation - either full grid or view around snake head
    let boardView = "";
    let viewSize;

    if (LLM_FULL_GRID_VIEW) {
        // Full grid view - iterate over entire board
        viewSize = GRID_SIZE;
        for (let y = 0; y < GRID_SIZE; y++) {
            let row = "";
            for (let x = 0; x < GRID_SIZE; x++) {
                const fruitHere = gameState.fruits.find(f => f.x === x && f.y === y);
                // Check what's at this position
                if (head.x === x && head.y === y) {
                    row += "@ "; // Your head
                } else if (fruitHere) {
                    row += fruitHere.type.emoji + ' '; // Fruit (real emoji for instant value recognition)
                } else if (enemyHead.x === x && enemyHead.y === y) {
                    row += playerNum === 1 ? "B " : "R "; // Enemy head
                } else if (snake.some(seg => seg.x === x && seg.y === y)) {
                    row += playerNum === 1 ? "r " : "b "; // Your body
                } else if (enemySnake.some(seg => seg.x === x && seg.y === y)) {
                    row += playerNum === 1 ? "b " : "r "; // Enemy body
                } else {
                    row += ". "; // Empty
                }
            }
            boardView += row + "\n";
        }
    } else {
        // Partial view around snake head (with wrap)
        const viewRadius = VIEW_RADIUS;
        viewSize = viewRadius * 2 + 1;
        for (let dy = -viewRadius; dy <= viewRadius; dy++) {
            let row = "";
            for (let dx = -viewRadius; dx <= viewRadius; dx++) {
                const x = ((head.x + dx) % GRID_SIZE + GRID_SIZE) % GRID_SIZE;
                const y = ((head.y + dy) % GRID_SIZE + GRID_SIZE) % GRID_SIZE;

                const fruitHere = gameState.fruits.find(f => f.x === x && f.y === y);
                // Check what's at this position
                if (dx === 0 && dy === 0) {
                    row += "@ "; // Your head
                } else if (fruitHere) {
                    row += fruitHere.type.emoji + ' '; // Fruit (real emoji for instant value recognition)
                } else if (x === enemyHead.x && y === enemyHead.y) {
                    row += playerNum === 1 ? "B " : "R "; // Enemy head
                } else if (snake.some(seg => seg.x === x && seg.y === y)) {
                    row += playerNum === 1 ? "r " : "b "; // Your body
                } else if (enemySnake.some(seg => seg.x === x && seg.y === y)) {
                    row += playerNum === 1 ? "b " : "r "; // Enemy body
                } else {
                    row += ". "; // Empty
                }
            }
            boardView += row + "\n";
        }
    }

    let state = `You are Player ${playerNum} (snake ${myColor}) playing against ${enemyColor}\n`;
    state += `Grid size: ${GRID_SIZE}x${GRID_SIZE}\n`;
    state += `Coordinates: (0,0) is top-left. x increases to the RIGHT, y increases DOWNWARD.\n`;
    state += `Your length: ${snake.length} | Enemy length: ${enemySnake.length}\n`;
    state += `Your head at: (${head.x}, ${head.y})\n`;
    state += `Enemy head at: (${enemyHead.x}, ${enemyHead.y})\n`;
    state += `Your current direction: ${currentDirName}\n\n`;

    // Plain fruit list: emoji, coordinates and value — plus wrap-aware distance
    // and compass hint when provideHintsEnabled is on. No ranking and no target
    // recommendation; choosing a goal is up to the LLM.
    if (fruitGuidanceEnabled) {
        state += `FRUITS (${gameState.fruits.length} available):\n`;
        gameState.fruits.forEach((fruit, i) => {
            let line = `${i + 1}. ${fruit.type.emoji} at (${fruit.x}, ${fruit.y}) - Value: ${fruit.type.value}`;
            if (provideHintsEnabled) {
                const dist = toroidalDist(head.x, head.y, fruit.x, fruit.y);
                line += ` - Distance: ${dist}${wrapBearing(head, fruit)}`;
            }
            state += line + `\n`;
        });
        state += `\n`;
    }

    const lengthAdvantage = snake.length - enemySnake.length;
    state += `Distance to enemy: ${distToEnemy}\n`;
    state += `YOUR LENGTH ADVANTAGE: ${lengthAdvantage > 0 ? '+' : ''}${lengthAdvantage} (Target fruits to maintain or gain advantage)\n\n`;

    // Legend
    const viewDescription = LLM_FULL_GRID_VIEW ? "full board" : `${viewSize}x${viewSize} area around you`;
    state += `Board view (${viewDescription}):\n`;
    state += `@ = your head | fruit = its emoji | ${playerNum === 1 ? "R/ r" : "B/b"} = your body | ${playerNum === 1 ? "B/b" : "R/r"} = enemy | . = empty\n`;
    state += `\n`;
    state += boardView + "\n";

    // Check for immediate dangers (walls don't kill, only snakes do)
    const upPos = wrapPosition(head.x, head.y - 1);
    const downPos = wrapPosition(head.x, head.y + 1);
    const leftPos = wrapPosition(head.x - 1, head.y);
    const rightPos = wrapPosition(head.x + 1, head.y);

    // Reverse movement is forbidden (currentDir was resolved near the head lookups)
    const forbiddenDir = { x: -currentDir.x, y: -currentDir.y };


    // Build safe moves list (with reverse movement prevention)
    const safeMoves = [];

    // UP - only if not going down and position is safe
    if (!(forbiddenDir.x === 0 && forbiddenDir.y === -1)) {
        if (!wouldCollideWithSnakeBody(upPos, snake) &&
            !wouldCollideWithSnake(upPos, enemySnake)) {
            safeMoves.push('up');
        }
    }

    // DOWN - only if not going up and position is safe
    if (!(forbiddenDir.x === 0 && forbiddenDir.y === 1)) {
        if (!wouldCollideWithSnakeBody(downPos, snake) &&
            !wouldCollideWithSnake(downPos, enemySnake)) {
            safeMoves.push('down');
        }
    }

    // LEFT - only if not going right (i.e. reverse = left) and position is safe
    if (!(forbiddenDir.x === -1 && forbiddenDir.y === 0)) {
        if (!wouldCollideWithSnakeBody(leftPos, snake) &&
            !wouldCollideWithSnake(leftPos, enemySnake)) {
            safeMoves.push('left');
        }
    }

    // RIGHT - only if not going left (i.e. reverse = right) and position is safe
    if (!(forbiddenDir.x === 1 && forbiddenDir.y === 0)) {
        if (!wouldCollideWithSnakeBody(rightPos, snake) &&
            !wouldCollideWithSnake(rightPos, enemySnake)) {
            safeMoves.push('right');
        }
    }

    // Only include safe moves in the prompt if configured to do so — a plain,
    // unordered list; which fruit (if any) to pursue is the LLM's decision.
    // The "answer with one word" tag re-states the output contract at the point
    // of decision — small models otherwise fail to ground bearing hints into an
    // actual direction word and just parrot their current direction.
    if (collisionAvoidanceEnabled && safeMoves.length > 0) {
        state += `Safe moves (answer with one word): ${safeMoves.join(', ')}\n`;
    } else if (collisionAvoidanceEnabled && safeMoves.length === 0) {
        state += `Safe moves: DANGER - all moves blocked!\n`;
    }

    return state;
}


// Latency tracking and statistics
const MAX_LATENCY_HISTORY = 50; // Number of samples to show on graph
const MAX_GLOBAL_LATENCY_HISTORY = 1000; // Maximum global latency samples to prevent memory issues

function trackLatency(playerNum, latency) {
    // Add to global history for stats (limit to prevent memory issues)
    const globalLatencies = playerNum === 1 ? player1GlobalLatencies : player2GlobalLatencies;
    globalLatencies.push(latency);

    // Prevent unbounded growth by keeping only the most recent samples
    if (globalLatencies.length > MAX_GLOBAL_LATENCY_HISTORY) {
        globalLatencies.shift(); // Remove oldest sample
    }

    updateLatencyMeter(playerNum);
}

function updateLatencyMeter(playerNum) {
    const globalLatencies = playerNum === 1 ? player1GlobalLatencies : player2GlobalLatencies;
    // Get visible window for graph (last MAX_LATENCY_HISTORY samples)
    const latencies = globalLatencies.slice(-MAX_LATENCY_HISTORY);

    // Draw the time-series graph
    drawLatencyGraph(playerNum, latencies);
}

// Draw continuous time-series latency graph on canvas
function drawLatencyGraph(playerNum, latencies) {
    const canvas = document.getElementById(`p${playerNum}-latency-canvas`);
    if (!canvas) return;

    // Ink colors follow the theme (dark instrument vs light panel).
    const lightTheme = getCurrentTheme() === 'light';
    const ink = lightTheme ? {
        gridH: 'rgba(17, 24, 39, 0.12)',
        gridV: 'rgba(17, 24, 39, 0.06)',
        text: 'rgba(17, 24, 39, 0.55)',
        textStrong: 'rgba(17, 24, 39, 0.75)',
        dot: '#111827',
    } : {
        gridH: 'rgba(255, 255, 255, 0.12)',
        gridV: 'rgba(255, 255, 255, 0.05)',
        text: 'rgba(255, 255, 255, 0.6)',
        textStrong: 'rgba(255, 255, 255, 0.75)',
        dot: '#ffffff',
    };

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Get the displayed size (CSS controls display size: .latcard canvas { width: 100% }).
    // Never write canvas.style.width/height here — pinning inline px sizes would
    // freeze the canvas and break responsive resizing. Clear any stale inline
    // size left by older code before measuring so the canvas can follow its
    // container again without requiring a page reload.
    if (canvas.style.width || canvas.style.height) {
        canvas.style.width = '';
        canvas.style.height = '';
    }
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;

    // Set backing-store resolution for crisp text on high-DPI displays.
    const targetW = Math.max(1, Math.round(width * dpr));
    const targetH = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
    }
    // Reset the transform absolutely on every draw (setting canvas.width resets
    // the context state, and ctx.scale() would compound across redraws).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Add padding to prevent dots from being clipped at edges
    const paddingX = 8;
    const paddingY = 10;
    const drawWidth = width - (paddingX * 2);
    const drawHeight = height - (paddingY * 2);

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate stats from GLOBAL data (all history) for display
    const globalLatencies = playerNum === 1 ? player1GlobalLatencies : player2GlobalLatencies;
    const globalStats = calculateLatencyStats(globalLatencies);
    updateLatencyStatsDisplay(playerNum, globalStats);

    // Calculate stats from VISIBLE window for graph scaling
    const visibleStats = calculateLatencyStats(latencies);

    // Helper function to calculate Y position from latency value (with padding)
    const latencyToY = (latencyValue) => {
        return height - paddingY - (latencyValue / scaleMax) * drawHeight;
    };

    // Helper function to calculate X position from index (with padding)
    const indexToX = (index) => {
        return paddingX + (index / (MAX_LATENCY_HISTORY - 1)) * drawWidth;
    };

    // Draw background grid (horizontal) - within padded area
    ctx.strokeStyle = ink.gridH;
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const y = paddingY + (drawHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(paddingX, y);
        ctx.lineTo(width - paddingX, y);
        ctx.stroke();
    }

    // Draw subtle vertical grid lines
    ctx.strokeStyle = ink.gridV;
    const verticalStep = drawWidth / 10;
    for (let i = 0; i <= 10; i++) {
        const x = paddingX + i * verticalStep;
        ctx.beginPath();
        ctx.moveTo(x, paddingY);
        ctx.lineTo(x, height - paddingY);
        ctx.stroke();
    }

    // Determine scale max based on VISIBLE window (not global)
    // Dynamic scaling with a reasonable baseline to handle very low latencies
    const scaleMax = Math.max(visibleStats.max, 200) * 1.2;

    if (latencies.length < 2) {
        // Draw "waiting for data" text
        ctx.fillStyle = ink.text;
        ctx.font = 'normal 500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Waiting for data...', width / 2, height / 2);
        return;
    }

    // Draw the time series line
    ctx.beginPath();
    for (let i = 0; i < latencies.length; i++) {
        const x = indexToX(i);
        const y = latencyToY(latencies[i]);
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    // Use solid player-specific color for the line
    // Player 1 = red, Player 2 = blue
    const lineColor = playerNum === 1 ? '#ff6b6b' : '#4488ff';

    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.stroke();

    // Draw data points - show all dots
    for (let i = 0; i < latencies.length; i++) {
        const x = indexToX(i);
        const y = latencyToY(latencies[i]);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fillStyle = ink.dot;
        ctx.fill();
    }

    // Draw highlighted current value dot (larger, different color)
    const lastX = indexToX(latencies.length - 1);
    const lastY = latencyToY(latencies[latencies.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = playerNum === 1 ? '#ff9999' : '#8fb8ff';
    ctx.fill();

    // Draw max value label at top
    ctx.fillStyle = ink.textStrong;
    ctx.font = 'normal 500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(`${Math.round(scaleMax)}ms`, width - paddingX, paddingY);

    // Draw min value label at bottom
    ctx.fillStyle = ink.text;
    ctx.textBaseline = 'bottom';
    ctx.fillText('0ms', width - paddingX, height - paddingY);

    // Store graph data for mouse interaction (latencies are accessed directly from global vars)
    canvas.dataset.graphData = JSON.stringify({
        scaleMax,
        width,
        height,
        paddingX,
        paddingY,
        drawWidth,
        drawHeight
    });
}

// Tooltip styles
function addTooltipStyles() {
    if (document.getElementById('latency-tooltip-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'latency-tooltip-styles';
    styles.textContent = `
        .latency-graph-tooltip {
            position: fixed;
            background: rgba(0, 0, 0, 0.95);
            border: 2px solid;
            border-radius: 8px;
            padding: 10px 14px;
            z-index: 10000;
            pointer-events: none;
            opacity: 0;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.6);
            font-size: 13px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-width: 120px;
        }
        .latency-graph-tooltip.visible {
            opacity: 1;
        }
        .tooltip-row {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 5px;
            align-items: center;
        }
        .tooltip-row:last-child {
            margin-bottom: 0;
        }
        .tooltip-label {
            color: #aaa;
            font-weight: 500;
        }
        .tooltip-value {
            color: #4ecdc4;
            font-weight: 600;
            text-align: right;
        }
        .tooltip-value.speed-fast {
            color: #4ade80;
            text-shadow: 0 0 6px rgba(74, 222, 128, 0.5);
        }
        .tooltip-value.speed-medium {
            color: #facc15;
            text-shadow: 0 0 6px rgba(250, 204, 21, 0.5);
        }
        .tooltip-value.speed-slow {
            color: #f87171;
            text-shadow: 0 0 6px rgba(248, 113, 113, 0.5);
        }
        .latency-graph-overlay {
            position: absolute;
            top: 0;
            left: 0;
            pointer-events: none;
            z-index: 10;
        }
    `;
    document.head.appendChild(styles);
}

// Create or get tooltip element
function getOrCreateTooltip() {
    addTooltipStyles();
    let tooltip = document.getElementById('latency-graph-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'latency-graph-tooltip';
        tooltip.className = 'latency-graph-tooltip';
        document.body.appendChild(tooltip);
    }
    return tooltip;
}

// Show tooltip at position with content
function showTooltip(x, y, playerNum, index, latency, borderColor) {
    const tooltip = getOrCreateTooltip();

    // Determine speed category
    const latencyValue = Math.round(latency);
    let speedCategory;
    let speedClass;
    if (latencyValue < 500) {
        speedCategory = 'FAST';
        speedClass = 'speed-fast';
    } else if (latencyValue < 1500) {
        speedCategory = 'MEDIUM';
        speedClass = 'speed-medium';
    } else if (latencyValue < 3000) {
        speedCategory = 'SLOW';
        speedClass = 'speed-slow';
    } else {
        speedCategory = 'VERY SLOW';
        speedClass = 'speed-slow';
    }

    // Set border color
    tooltip.style.borderColor = borderColor;

    // Player-specific move number (index + 1 = move number)
    const playerLabel = playerNum === 1 ? 'P1' : 'P2';
    const playerMove = index + 1;

    // Set content
    tooltip.innerHTML = `
        <div class="tooltip-row">
            <span class="tooltip-label">${playerLabel} Move:</span>
            <span class="tooltip-value">#${playerMove}</span>
        </div>
        <div class="tooltip-row">
            <span class="tooltip-label">Latency:</span>
            <span class="tooltip-value">${latencyValue}ms</span>
        </div>
        <div class="tooltip-row">
            <span class="tooltip-label">Speed:</span>
            <span class="tooltip-value ${speedClass}">${speedCategory}</span>
        </div>
    `;

    // Position tooltip
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;

    // Add visible class
    tooltip.classList.add('visible');
}

// Hide tooltip
function hideLatencyTooltip() {
    const tooltip = document.getElementById('latency-graph-tooltip');
    if (tooltip) {
        tooltip.classList.remove('visible');
    }
}

function handleLatencyGraphMouseMove(e, canvas, playerNum) {
    const rect = canvas.getBoundingClientRect();

    // Check if mouse is within canvas bounds
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < 0 || x > rect.width || y < 0 || y > rect.height) {
        hideLatencyTooltip();
        return;
    }

    // Get latencies from display window (fresh data)
    const displayLatencies = playerNum === 1 ? player1GlobalLatencies : player2GlobalLatencies;

    if (!displayLatencies || displayLatencies.length === 0) {
        hideLatencyTooltip();
        return;
    }

    // Use current canvas dimensions for calculations
    const paddingX = 8;
    const drawWidth = rect.width - (paddingX * 2);

    // Adjust mouse X to account for padding, then find closest data point
    const adjustedX = x - paddingX;
    const stepX = drawWidth / (MAX_LATENCY_HISTORY - 1);

    // Find the closest data point based on x position (clamp to valid range)
    const maxIndex = displayLatencies.length - 1;
    const index = Math.min(Math.max(0, Math.round(adjustedX / stepX)), maxIndex);
    const latency = displayLatencies[index];

    // Only show tooltip if mouse is within the padded drawing area
    if (adjustedX < 0 || adjustedX > drawWidth) {
        hideLatencyTooltip();
        return;
    }

    // Validate that we got a valid latency value before showing tooltip
    if (typeof latency !== 'number' || isNaN(latency) || latency < 0) {
        hideLatencyTooltip();
        return;
    }

    // Calculate tooltip position
    const tooltipX = e.clientX + 12;
    const tooltipY = e.clientY - 12;

    // Show tooltip with player-specific border color
    const borderColor = playerNum === 1 ? '#ff6b6b' : '#4488ff';
    showTooltip(tooltipX, tooltipY, playerNum, index, latency, borderColor);

    // Store current hover state for overlay
    canvas.dataset.hoverIndex = index;
    canvas.dataset.hoverLatency = latency;

    // Redraw with overlay line
    redrawGraphWithOverlay(canvas, playerNum, index);
}

function handleLatencyGraphMouseLeave(canvas) {
    hideLatencyTooltip();
    delete canvas.dataset.hoverIndex;
    delete canvas.dataset.hoverLatency;

    // Clear overlay
    const overlay = canvas.parentElement.querySelector('.latency-graph-overlay');
    if (overlay) {
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
    }
}

function redrawGraphWithOverlay(canvas, playerNum, highlightIndex) {
    const graphDataStr = canvas.dataset.graphData;
    if (!graphDataStr) return;

    let data;
    try {
        data = JSON.parse(graphDataStr);
    } catch (err) {
        return;
    }

    const { scaleMax } = data;

    // Get display latencies (fresh data)
    const displayLatencies = playerNum === 1 ? player1GlobalLatencies : player2GlobalLatencies;
    if (displayLatencies.length === 0) return;

    // Get current canvas dimensions
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const paddingX = 8;
    const paddingY = 10;
    const drawWidth = width - (paddingX * 2);
    const drawHeight = height - (paddingY * 2);

    // Helper functions
    const latencyToY = (latencyValue) => {
        return height - paddingY - (latencyValue / scaleMax) * drawHeight;
    };

    const indexToX = (index) => {
        return paddingX + (index / (MAX_LATENCY_HISTORY - 1)) * drawWidth;
    };

    // Get the appropriate color based on player
    const lineColor = playerNum === 1 ? '#ff6b6b' : '#4488ff';

    // Create or get overlay canvas
    let overlay = canvas.parentElement.querySelector('.latency-graph-overlay');
    if (!overlay) {
        overlay = document.createElement('canvas');
        overlay.className = 'latency-graph-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.pointerEvents = 'none';
        canvas.parentElement.appendChild(overlay);
    }

    // Scale overlay canvas for high-DPI displays (transient hover layer, so
    // inline px sizing to the current canvas rect is fine here).
    const dpr = window.devicePixelRatio || 1;
    const overlayW = Math.max(1, Math.round(width * dpr));
    const overlayH = Math.max(1, Math.round(height * dpr));
    if (overlay.width !== overlayW || overlay.height !== overlayH) {
        overlay.width = overlayW;
        overlay.height = overlayH;
        overlay.style.width = `${width}px`;
        overlay.style.height = `${height}px`;
    }

    const ctx = overlay.getContext('2d');
    // Reset the transform absolutely on every call (setTransform, not scale):
    // the context is reused across mousemove events, so ctx.scale(dpr,dpr)
    // would compound the matrix every move and break rendering on high-DPI.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Draw vertical line at hover position (within padded area)
    const x = indexToX(highlightIndex);
    ctx.beginPath();
    ctx.moveTo(x, paddingY);
    ctx.lineTo(x, height - paddingY);
    ctx.strokeStyle = getCurrentTheme() === 'light' ? 'rgba(17, 24, 39, 0.4)' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw circle at data point
    const latency = displayLatencies[highlightIndex];
    const y = latencyToY(latency);

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = getCurrentTheme() === 'light' ? 'rgba(17, 24, 39, 0.15)' : 'rgba(255, 255, 255, 0.9)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
}

// Calculate statistics from latency array (impl: js/core.js)
function calculateLatencyStats(latencies) {
    return SnakeCore.calculateLatencyStats(latencies);
}

// Token counter in the latency-card title (right-aligned): cumulative
// input/output tokens for this player, e.g. "↑12.3k ↓0.4k".
function formatTokens(n) {
    return SnakeCore.formatTokens(n);
}

function updateTokenTitle(playerNum) {
    const el = document.getElementById(`p${playerNum}-token-count`);
    if (!el) return;
    const input = playerNum === 1 ? gameState.player1InputTokens : gameState.player2InputTokens;
    const output = playerNum === 1 ? gameState.player1OutputTokens : gameState.player2OutputTokens;
    el.textContent = `↑${formatTokens(input)} ↓${formatTokens(output)}`;
    el.title = `Input ${Math.round(input)} tok / output ${Math.round(output)} tok (real usage when the provider reports it, else ~chars/4 estimate)`;
}

// Update the statistics display HTML
function updateLatencyStatsDisplay(playerNum, stats) {
    const container = document.getElementById(`p${playerNum}-latency-stats`);
    if (!container) return;

    const globalLatencies = playerNum === 1 ? player1GlobalLatencies : player2GlobalLatencies;
    const apiErrors = playerNum === 1 ? gameState.player1ApiFailures : gameState.player2ApiFailures;

    const current = globalLatencies.length > 0 ? globalLatencies[globalLatencies.length - 1] : 0;
    const calls = globalLatencies.length;

    // Format API error display if errors exist: "API: number ⚠️ error count"
    const errorDisplay = apiErrors > 0 ? ` ⚠️ ${apiErrors}` : '';

    container.innerHTML = `
        <div class="latency-stat">
            <label>API</label>
            <value>${calls} ${apiErrors > 0 ? `<span class="api-error-count">⚠️ ${apiErrors}</span>` : ''}</value>
        </div>
        <div class="latency-stat">
            <label>Latest</label>
            <value>${Math.round(current)}</value>
        </div>
        <div class="latency-stat">
            <label>Min</label>
            <value>${Math.round(stats.min)}</value>
        </div>
        <div class="latency-stat">
            <label>Median</label>
            <value>${Math.round(stats.median)}</value>
        </div>
        <div class="latency-stat">
            <label>P90</label>
            <value>${Math.round(stats.p90)}</value>
        </div>
        <div class="latency-stat">
            <label>Max</label>
            <value>${Math.round(stats.max)}</value>
        </div>
    `;
}

function calculatePercentile(sortedArray, percentile) {
    return SnakeCore.calculatePercentile(sortedArray, percentile);
}

// Reset latency tracking
function resetLatencyTracking() {
    player1GlobalLatencies = [];
    player2GlobalLatencies = [];

    // Clear canvas and redraw empty state
    const c1 = document.getElementById('p1-latency-canvas');
    const c2 = document.getElementById('p2-latency-canvas');
    if (c1) {
        const ctx = c1.getContext('2d');
        ctx.clearRect(0, 0, c1.width, c1.height);
    }
    if (c2) {
        const ctx = c2.getContext('2d');
        ctx.clearRect(0, 0, c2.width, c2.height);
    }

    // Initialize stats displays with default values
    const initialStats = { min: 0, max: 0, median: 0, p90: 0 };
    updateLatencyStatsDisplay(1, initialStats);
    updateLatencyStatsDisplay(2, initialStats);
    updateTokenTitle(1);
    updateTokenTitle(2);

    // Clean up overlay canvases to prevent memory leaks
    const c1Container = c1?.parentElement;
    const c2Container = c2?.parentElement;
    if (c1Container) {
        const overlay = c1Container.querySelector('.latency-graph-overlay');
        if (overlay) overlay.remove();
    }
    if (c2Container) {
        const overlay = c2Container.querySelector('.latency-graph-overlay');
        if (overlay) overlay.remove();
    }

    // Redraw empty graph state (shows "Waiting for data...")
    drawLatencyGraph(1, []);
    drawLatencyGraph(2, []);
}

// Helper to format timestamp for logging
function formatTimestamp(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
}

// Get LLM decision - returns { direction, latency }
// Get LLM direction with retry logic for rate limiting
async function getLLMDirectionWithRetry(playerNum, attempt = 0) {
    try {
        // Use current max_tokens level for this player
        const maxTokens = MAX_TOKENS_CASCADE[playerMaxTokensLevel[playerNum]];

        if (gameState.debugMode) {
            console.log(`P${playerNum}: Request with max_tokens=${maxTokens || 'unset'}`);
        }

        return await getLLMDirection(playerNum, maxTokens);
    } catch (error) {
        // Don't fail or log if game is paused or aborted
        if (gameState.paused || gameState.gameOver) {
            throw error;
        }

        // If limited content error (null or length), advance to next max_tokens level for this player only
        if ((error.message.includes('Limited API response') || error.message.includes('Null API response')) &&
            playerMaxTokensLevel[playerNum] < MAX_TOKENS_CASCADE.length - 1) {

            // Log the max_tokens cascade attempt in game log
            const currentTokens = MAX_TOKENS_CASCADE[playerMaxTokensLevel[playerNum]];
            const nextLevel = playerMaxTokensLevel[playerNum] + 1;
            const nextTokens = MAX_TOKENS_CASCADE[nextLevel];

            addLog(`⚙️ Upping max_tokens: ${currentTokens || 'unset'} → ${nextTokens || 'unset'}`, playerNum);

            // Advance to next max_tokens level for this player (with bounds checking)
            if (playerMaxTokensLevel[playerNum] < MAX_TOKENS_CASCADE.length - 1) {
                playerMaxTokensLevel[playerNum]++;
            } else {
                // Cap at the maximum level
                playerMaxTokensLevel[playerNum] = MAX_TOKENS_CASCADE.length - 1;
            }

            if (gameState.debugMode) {
                console.log(`P${playerNum}: Advancing max_tokens level to ${playerMaxTokensLevel[playerNum]} (max_tokens=${nextTokens || 'unset'})`);
            }

            // Retry with new max_tokens level
            return getLLMDirectionWithRetry(playerNum, attempt);
        }

        const failuresKey = playerNum === 1 ? 'player1ApiFailures' : 'player2ApiFailures';
        const consecutiveFailuresKey = playerNum === 1 ? 'player1ConsecutiveFailures' : 'player2ConsecutiveFailures';

        gameState[failuresKey]++;
        gameState[consecutiveFailuresKey]++; // Increment consecutive failures

        updateScores(); // Update stats to show failure count

        // Check for forfeit condition in demo mode
        if (gameState[consecutiveFailuresKey] >= MAX_CONSECUTIVE_FAILURES) {
            // Dispatch forfeit event for demo mode
            document.dispatchEvent(new CustomEvent('playerForfeited', {
                detail: { player: playerNum === 1 ? 'player1' : 'player2' }
            }));
        }

        // Update latency stats display to show error count
        const globalLatencies = playerNum === 1 ? player1GlobalLatencies : player2GlobalLatencies;
        const globalStats = calculateLatencyStats(globalLatencies);
        updateLatencyStatsDisplay(playerNum, globalStats);

        // Check if this is a rate limit error
        if (error.message.includes('HTTP 429')) {
            // For 429 errors, use exponential backoff with max retries
            if (attempt < MAX_429_RETRIES) {
                const delay = API_RETRY_DELAY_MS * Math.pow(2, attempt);
                addLog(`⚠️ Rate limit (429), retrying in ${delay/1000}s... (${attempt + 1}/${MAX_429_RETRIES})`, playerNum);

                if (gameState.debugMode) {
                    console.log(`[${formatTimestamp(new Date())}] 🔄 P${playerNum}: Retrying after ${delay}ms (attempt ${attempt + 1})`);
                }

                await new Promise(resolve => setTimeout(resolve, delay));
                return getLLMDirectionWithRetry(playerNum, attempt + 1);
            }
            // After max 429 retries, stop the game
            addLog(`❌ API error: Too many rate limit failures (${MAX_429_RETRIES} attempts). Game stopped.`, playerNum, true);
            gameState.gameOver = true;
            needsRedraw = true; // Mark canvas for redraw
            checkGameOver();
            throw new Error(`Rate limit error after ${MAX_429_RETRIES} attempts`);
        }

        // For other errors, check max retry limit
        if (attempt >= MAX_API_RETRIES) {
            addLog(`❌ API error: Too many consecutive failures (${MAX_API_RETRIES} attempts): ${error.message}. Game stopped.`, playerNum, true);
            gameState.gameOver = true;
            needsRedraw = true; // Mark canvas for redraw
            checkGameOver();
            throw new Error(`Too many failures after ${MAX_API_RETRIES} attempts: ${error.message}`);
        }

        // Retry with delay
        addLog(`⚠️ API error: ${error.message}, retrying in 2s... (${attempt + 1}/${MAX_API_RETRIES})`, playerNum);

        if (gameState.debugMode) {
            console.log(`[${formatTimestamp(new Date())}] P${playerNum}: Retrying after ${API_RETRY_DELAY_MS}ms (error: ${error.message}, attempt ${attempt + 1}/${MAX_API_RETRIES})`);
        }

        await new Promise(resolve => setTimeout(resolve, API_RETRY_DELAY_MS));

        // Retry with incremented attempt counter
        return getLLMDirectionWithRetry(playerNum, attempt + 1);
    }
}

async function getLLMDirection(playerNum, maxTokens = null) {
    const snake = playerNum === 1 ? gameState.snake1 : gameState.snake2;
    const currentDir = playerNum === 1 ? gameState.direction1 : gameState.direction2;
    const otherSnake = playerNum === 1 ? gameState.snake2 : gameState.snake1;
    const prompt = getBoardState(playerNum);
    const model = playerNum === 1 ? gameState.player1Model : gameState.player2Model;
    const playerMove = playerNum === 1 ? gameState.player1MoveNumber + 1 : gameState.player2MoveNumber + 1;
    const requestNum = playerNum === 1 ? gameState.player1ApiCalls + 1 : gameState.player2ApiCalls + 1;

    const startTime = Date.now();

    try {
        // Credentials up front; the shared builder cleans per provider.
        const creds = getPlayerCredentials(playerNum);
        const systemPrompt = SYSTEM_PROMPT
            .replace('{VISIBILITY_SIZE}', VIEW_RADIUS * 2 + 1)
            // {HINTS_DESC} mirrors the provideHintsEnabled toggle so the
            // system prompt never describes hints the user prompt lacks.
            .replace('{HINTS_DESC}', provideHintsEnabled
                ? ', distance and compass hint (e.g. "8 right, 1 down") — to move toward a fruit, answer with a word from its compass hint'
                : '');
        const isAnthropic = SnakeCore.isAnthropicEndpoint(creds.apiUrl);
        let requestUrl;
        let requestHeaders;
        let requestBody;
        if (isAnthropic) {
            // Native Anthropic: system is top-level, messages are user-only.
            ({ url: requestUrl, headers: requestHeaders, body: requestBody } = SnakeCore.buildAnthropicRequest({
                apiUrl: creds.apiUrl,
                apiKey: creds.apiKey,
                model: model,
                system: systemPrompt,
                messages: [{ role: 'user', content: prompt }],
                maxTokens: maxTokens
            }));
        } else {
        const { url: openaiUrl, headers: openaiHeaders, body: openaiBody } = SnakeCore.buildChatRequest({
            apiUrl: creds.apiUrl,
            apiKey: creds.apiKey,
            model: model,
            messages: [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0,
            maxTokens: maxTokens,
            thinkingEnabled: thinkingModeEnabled
        });
            requestUrl = openaiUrl;
            requestHeaders = openaiHeaders;
            requestBody = openaiBody;
        }

        // Calculate request size for logging
        const requestBodyString = JSON.stringify(requestBody);
        const requestBytes = new Blob([requestBodyString]).size;
        const requestTokens = Math.ceil(requestBodyString.length / 4); // Rough approximation: ~4 chars per token

        // Track data sent to LLM
        if (playerNum === 1) {
            gameState.player1DataSent += requestBytes;
        } else {
            gameState.player2DataSent += requestBytes;
        }

        // Create abort controller for timeout
        const timeoutMs = LLM_TIMEOUT_MS;
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

        if (gameState.debugMode) {
            console.log(`[${formatTimestamp(new Date(startTime))}] ======== P${playerNum}: Move ${playerMove}: Request ${requestNum} (${requestBytes} bytes, ~${requestTokens} tokens) ======`);
            console.log('URL:', requestUrl);
            console.log('Headers:', isAnthropic
                ? { 'Content-Type': 'application/json', 'x-api-key': '***HIDDEN***' }
                : {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ***HIDDEN***'
            });
            // Print metadata + prompts human-readably (real newlines; the raw
            // JSON Body dump escaped every \n and made prompts unreadable).
            console.log(`Model: ${model} | temp: 0 | max_tokens: ${maxTokens === null ? (isAnthropic ? '300 (anthropic default)' : 'omitted') : maxTokens} | thinking: ${thinkingModeEnabled}`);
            console.log('--- System prompt ---');
            console.log(isAnthropic ? (requestBody.system || '') : requestBody.messages[0].content);
            console.log('--- User prompt ---');
            console.log(isAnthropic ? (requestBody.messages[0].content) : requestBody.messages[1].content);
            console.log('--------------------');
            console.log('Body (raw JSON):', JSON.stringify(requestBody, null, 2));
        }

        let response;
        try {
            response = await fetch(requestUrl, {
                method: 'POST',
                headers: requestHeaders,
                body: JSON.stringify(requestBody),
                signal: abortController.signal,
                credentials: 'omit'
            });
            clearTimeout(timeoutId);
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
                throw new Error(`Timeout (>${LLM_TIMEOUT_MS/1000}s)`);
            }
            throw fetchError;
            }

        const endTime = Date.now();
        const latency = endTime - startTime;

        let data;
        let content;
        let isNullContent;
        let isLengthLimited;
        let finishReason;
        if (isAnthropic) {
            data = await response.json();
            if (!response.ok) {
                const detail = data && data.error ? (data.error.message || data.error.type) : response.statusText;
                throw new Error(`HTTP ${response.status}: ${detail || response.statusText}`);
            }
            content = SnakeCore.parseAnthropicText(data);
            // Strip out any thinking/reasoning tags and their content
            content = content.replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
            isNullContent = !content;
            isLengthLimited = data.stop_reason === 'max_tokens';
            finishReason = data.stop_reason || 'unknown';
        } else {
        data = await response.json();

        // Check if response contains an error
        if (data.error) {
            throw new Error(`API Error: ${data.error.message || data.error.type || JSON.stringify(data.error)}`);
        }

        // Check if choices array exists and is not empty
        if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
            throw new Error('Invalid response: No choices in API response');
        }

        content = data.choices[0]?.message?.content?.trim() || '';

        // Strip out any thinking/reasoning tags and their content
        content = content.replace(/<(thinking|think|thought|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
        }

        const choice = content.toLowerCase();

        // Extract the first direction word, tolerating punctuation/chattiness
        // ("down.", "\"Up\"", "I'll go left"). See SnakeCore.parseDirectionReply.
        const directionWord = SnakeCore.parseDirectionReply(choice);

        if (!isAnthropic) {
        // Check if content is null
        isNullContent = !data.choices || !data.choices[0] || !data.choices[0].message || data.choices[0].message.content === null;

        // Check if response was cut off due to length limit
        isLengthLimited = data.choices?.[0]?.finish_reason === 'length';
        finishReason = data.choices?.[0]?.finish_reason || 'unknown';
        }

        // Calculate response length (bytes) from full API response
        const responseLength = new Blob([JSON.stringify(data)]).size;

        // Track data received from LLM
        if (playerNum === 1) {
            gameState.player1DataReceived += responseLength;
        } else {
            gameState.player2DataReceived += responseLength;
        }

        // Track token usage: real `usage` when the provider reports it,
        // ~chars/4 estimate fallback (request body + reply text) otherwise.
        const usage = SnakeCore.extractUsage(data);
        let inputTokens = usage.input;
        let outputTokens = usage.output;
        if (!usage.hasUsage) {
            inputTokens = Math.ceil(requestBodyString.length / 4);
            outputTokens = Math.ceil((content || '').length / 4);
        }
        if (playerNum === 1) {
            gameState.player1InputTokens += inputTokens;
            gameState.player1OutputTokens += outputTokens;
        } else {
            gameState.player2InputTokens += inputTokens;
            gameState.player2OutputTokens += outputTokens;
        }
        updateTokenTitle(playerNum);

        if (gameState.debugMode) {
            console.log(`[${formatTimestamp(new Date(endTime))}] ====== P${playerNum}: Move ${playerMove}: Response ${requestNum} (length=${responseLength} bytes, latency=${latency} ms) ====`);
            if (isNullContent || isLengthLimited) {
                if (isNullContent) {
                    console.warn('⚠️ NULL CONTENT DETECTED!');
                } else if (isLengthLimited) {
                    console.warn('⚠️ LENGTH-LIMITED RESPONSE DETECTED!');
                }
                console.warn('Full Response:', JSON.stringify(data, null, 2));
                if (isAnthropic) {
                    console.warn('stop_reason:', data.stop_reason);
                } else if (data.choices && data.choices[0]) {
                    console.warn('finish_reason:', data.choices[0].finish_reason);
                    console.warn('message:', JSON.stringify(data.choices[0].message, null, 2));
                }
            } else {
                console.log('Choice:', choice);
                console.log(isAnthropic ? 'stop_reason:' : 'finish_reason:', isAnthropic ? data.stop_reason : data.choices[0]?.finish_reason);
            }
        }

        // Throw error for null content or length-limited responses so they're counted as failures and retried with higher max_tokens
        if (isNullContent || isLengthLimited) {
            throw new Error(`Limited API response (finish_reason: ${finishReason})`);
        }

        // Map direction string to vector
        const directionMap = {
            'up': { x: 0, y: -1 },
            'down': { x: 0, y: 1 },
            'left': { x: -1, y: 0 },
            'right': { x: 1, y: 0 }
        };

        if (!directionWord) {
            // No usable direction in the reply — treat as a failure so the
            // standard retry/forfeit machinery handles it (instead of freezing).
            throw new Error(`No direction in response: "${content.slice(0, 80)}"`);
        }

        const direction = directionMap[directionWord];

        // Reset consecutive failures counter on successful API call
        const consecutiveFailuresKey = playerNum === 1 ? 'player1ConsecutiveFailures' : 'player2ConsecutiveFailures';
        gameState[consecutiveFailuresKey] = 0;

        // Always use LLM response - no fallback
        return { direction, latency };

    } catch (error) {
        console.warn(`Warning getting Player ${playerNum} decision:`, error);
        const latency = Date.now() - startTime;

        if (gameState.debugMode) {
            console.log(`[${formatTimestamp(new Date())}] ====== P${playerNum}: Move ${playerMove}: Response ${requestNum} (${latency} ms) ====`);
            console.log('Error:', error.message);
        }

        // Re-throw error so retry logic can handle it
        throw error;
    }
}

// Move a snake (with wall wrap)
function moveSnake(snake, direction) {
    const head = snake[0];
    const newHead = wrapPosition(head.x + direction.x, head.y + direction.y);
    snake.unshift(newHead);
    return newHead;
}

// Check collision (impl: js/core.js)
function checkCollision(snake, head, otherSnake) {
    return SnakeCore.checkCollision(snake, head, otherSnake);
}

// Check if head-to-head collision (impl: js/core.js)
function checkHeadToHead(head1, head2) {
    return SnakeCore.checkHeadToHead(head1, head2);
}

// Check if a position would collide with a snake (impl: js/core.js)
function wouldCollideWithSnake(position, snake) {
    return SnakeCore.wouldCollideWithSnake(position, snake);
}

// Calculate new head position without moving the snake (impl: js/core.js)
function calculateNewHead(head, direction) {
    return SnakeCore.calculateNewHead(head, direction, GRID_SIZE);
}

// Find a safe direction (impl: js/core.js)
function findSafeDirection(head, preferredDirection, snake, otherSnake) {
    return SnakeCore.findSafeDirection(head, preferredDirection, snake, otherSnake, GRID_SIZE);
}

// Check if a position would collide with a snake body (impl: js/core.js)
function wouldCollideWithSnakeBody(position, snake) {
    return SnakeCore.wouldCollideWithSnakeBody(position, snake);
}

// Move a single snake
function moveSingleSnake(playerNum, latency) {
    if (gameState.gameOver || gameState.paused) {
        return;
    }

    const snake = playerNum === 1 ? gameState.snake1 : gameState.snake2;
    const otherSnake = playerNum === 1 ? gameState.snake2 : gameState.snake1;
    const directionKey = playerNum === 1 ? 'direction1' : 'direction2';
    const deadKey = playerNum === 1 ? 'player1Dead' : 'player2Dead';
    const moveNumberKey = playerNum === 1 ? 'player1MoveNumber' : 'player2MoveNumber';
    const apiCallsKey = playerNum === 1 ? 'player1ApiCalls' : 'player2ApiCalls';

    // Check if this snake is already dead
    if (gameState[deadKey]) {
        return;
    }

    gameState[moveNumberKey]++;
    gameState[apiCallsKey]++;
    updateScores();
    needsRedraw = true; // Mark canvas for redraw after game state changes

    const dirNames = { '0,-1': '↑', '0,1': '↓', '-1,0': '←', '1,0': '→' };
    const dirKey = `${gameState[directionKey].x},${gameState[directionKey].y}`;

    let latencyDisplay = '';
    if (latency !== undefined) {
        let latencyClass = 'latency';
        let latencyAttr = '';
        // Color code based on latency: <500ms fast, 500-1500ms medium, >1500ms slow
        if (latency < 500) {
            latencyAttr = 'data-latency-fast="true"';
        } else if (latency < 1500) {
            latencyAttr = 'data-latency-medium="true"';
        } else {
            latencyAttr = 'data-latency-slow="true"';
        }
        latencyDisplay = `<span class="${latencyClass}" ${latencyAttr}>${latency}ms</span>`;
    }

    addLog(`${dirNames[dirKey] || '?'} ${latencyDisplay}`, playerNum);

    // Simple collision avoidance: Check if the intended move would collide with self or other snake
    if (collisionAvoidanceEnabled) {
        const intendedHeadPos = calculateNewHead(snake[0], gameState[directionKey]);

        // Check collision with self body or other snake
        if (wouldCollideWithSnakeBody(intendedHeadPos, snake) ||
            wouldCollideWithSnake(intendedHeadPos, otherSnake)) {
            // Find a safe fallback direction to avoid collision with both snakes
            const safeDirection = findSafeDirection(snake[0], gameState[directionKey], snake, otherSnake);
            if (safeDirection.x !== gameState[directionKey].x || safeDirection.y !== gameState[directionKey].y) {
                gameState[directionKey] = safeDirection;
                addLog(`🔄 Collision avoided!`, playerNum, false, true);
            }
        }
    }

    // Move snake (with wall wrap)
    const newHead = moveSnake(snake, gameState[directionKey]);

    // Check collision with self and enemy
    const collision = checkCollision(snake, newHead, otherSnake);
    const otherHead = otherSnake[0];
    const headToHead = checkHeadToHead(newHead, otherHead) && !gameState[playerNum === 1 ? 'player2Dead' : 'player1Dead'];

    let playerDead = false;

    if (headToHead) {
        // Snake crashed into enemy's head - both may die
        playerDead = true;
        gameState[deadKey] = true;
        const otherDeadKey = playerNum === 1 ? 'player2Dead' : 'player1Dead';
        gameState[otherDeadKey] = true;
        addLog(`💥 HEAD-ON COLLISION!`, playerNum, false, true);
        checkGameOver();
    } else if (collision) {
        playerDead = true;
        gameState[deadKey] = true;
        addLog(`💀 Hit ${collision}!`, playerNum, false, true);
        checkGameOver();
    }

    // Check if snake ate any fruit
    let growth = 0;
    for (let i = gameState.fruits.length - 1; i >= 0; i--) {
        const fruit = gameState.fruits[i];
        if (newHead.x === fruit.x && newHead.y === fruit.y) {
            growth = fruit.type.value;
            addLog(`${fruit.type.emoji} Ate +${growth}`, playerNum, false, true);
            gameState.fruits.splice(i, 1);
            placeFruit(); // Replace with new fruit
        }
    }

    // Grow snake if ate fruit and didn't die
    if (growth > 0 && !playerDead) {
        for (let i = 0; i < growth - 1; i++) {
            snake.push({...snake[snake.length - 1]});
        }
    } else if (!playerDead) {
        // Normal snake movement - remove tail
        snake.pop();
    } else {
        // Snake died - keep the head to show where it crashed
        // Don't pop the tail
    }

    // Redraw is handled by the rAF loop (needsRedraw was set above on every
    // state change), so no direct draw() here — avoids a double redraw per move.

    // Check game over
    checkGameOver();
}

// Check for game over condition
function checkGameOver() {
    // Prevent duplicate winner logs from race conditions
    if (gameState.winnerLogged) {
        return;
    }

    const p1ModelName = gameState.player1Model.split('/').pop();
    const p2ModelName = gameState.player2Model.split('/').pop();

    let winner = null; // Declare winner at function scope

    if (gameState.player1Dead && gameState.player2Dead) {
        winner = gameState.snake1.length > gameState.snake2.length ? 'player1' :
                     gameState.snake2.length > gameState.snake1.length ? 'player2' : 'draw';
        gameState.gameOver = true;
            needsRedraw = true; // Mark canvas for redraw
        gameState.winnerLogged = true; // Mark that winner has been logged
        let winnerMsg = '';
        if (winner === 'player1') {
            winnerMsg = `<span class="p1">🏆 PLAYER 1 (${p1ModelName}) WINS!</span>`;
        } else if (winner === 'player2') {
            winnerMsg = `<span class="p2">🏆 PLAYER 2 (${p2ModelName}) WINS!</span>`;
        } else {
            winnerMsg = '🤝 DRAW!';
        }
        addLog(`<span class="crash">${winnerMsg} Red:${gameState.snake1.length} | Blue:${gameState.snake2.length}</span>`, null, true);
        pauseBtn.disabled = true;
    } else if (gameState.player1Dead) {
        winner = 'player2';
        gameState.gameOver = true;
            needsRedraw = true; // Mark canvas for redraw
        gameState.winnerLogged = true; // Mark that winner has been logged
        pauseBtn.disabled = true;
        addLog(`<span class="p2">🏆 PLAYER 2 (${p2ModelName}) WINS! Red:${gameState.snake1.length} | Blue:${gameState.snake2.length}</span>`, null, true);
    } else if (gameState.player2Dead) {
        winner = 'player1';
        gameState.gameOver = true;
            needsRedraw = true; // Mark canvas for redraw
        gameState.winnerLogged = true; // Mark that winner has been logged
        pauseBtn.disabled = true;
        addLog(`<span class="p1">🏆 PLAYER 1 (${p1ModelName}) WINS! Red:${gameState.snake1.length} | Blue:${gameState.snake2.length}</span>`, null, true);
    }

    // Update stats panel with final values when game ends
    if (gameState.gameOver) {
        updateScores();
        // Capture the final elapsed time before stopping the timer
        gameState.finalElapsedTime = getElapsedSeconds();
        // Stop the timer when game ends
        stopTimer();
        // Redraw to ensure final state (including losing snake's head) is visible
        draw();

        // Dispatch game ended event for demo mode
        if (typeof winner !== 'undefined' && winner) {
            document.dispatchEvent(new CustomEvent('gameEnded', {
                detail: { winner: winner }
            }));
        }

        // Start loop countdown if loop mode is enabled
        if (gameState.loopMode) {
            startLoopCountdown();
        }
    }
}

// Main game loop - starts independent LLM calls for each snake
function gameLoop() {
    if (gameState.gameOver || gameState.paused) {
        return;
    }

    // Create new abort controller for this game session
    if (!gameLoopAbortController) {
        gameLoopAbortController = new AbortController();
    }

    // Start both LLM calls in parallel - each moves independently when it responds
    moveSnakeWithLLM(1, gameLoopAbortController.signal);
    moveSnakeWithLLM(2, gameLoopAbortController.signal);
}

// Move snake with LLM decision (called independently for each snake)
async function moveSnakeWithLLM(playerNum, abortSignal, timeoutAttempt = 0) {
    if (gameState.gameOver || gameState.paused) {
        return;
    }

    // Check if aborted
    if (abortSignal?.aborted) {
        return;
    }

    const deadKey = playerNum === 1 ? 'player1Dead' : 'player2Dead';
    if (gameState[deadKey]) {
        return;
    }

    // Race the API call against a timeout
    let result;

    // Capture the race timer so we can clear it on success (otherwise every
    // successful move would leave a 30s timer pending — a slow leak over a
    // long game). Also tracked in activeTimeouts for pause/stop teardown.
    let outerTimeoutId;
    try {
        result = await Promise.race([
            getLLMDirectionWithRetry(playerNum),
            new Promise((_, reject) => {
                outerTimeoutId = setTimeout(() => {
                    activeTimeouts.delete(outerTimeoutId);
                    if (gameState.debugMode) {
                        console.log(`[${formatTimestamp(new Date())}] ⚠️ P${playerNum}: Move timeout (${LLM_TIMEOUT_MS}ms)`);
                    }
                    reject(new Error('Timeout'));
                }, LLM_TIMEOUT_MS);
                activeTimeouts.add(outerTimeoutId);
            })
        ]);
        // Race resolved (success or inner error) before the timer fired — cancel it.
        clearTimeout(outerTimeoutId);
        activeTimeouts.delete(outerTimeoutId);
    } catch (error) {
        // Race rejected. If the inner error won (not the outer timer), the
        // timer is still armed — cancel it so it can't fire late.
        if (outerTimeoutId) {
            clearTimeout(outerTimeoutId);
            activeTimeouts.delete(outerTimeoutId);
        }
        // Recognize both timeout shapes: the outer race ('Timeout') and the inner
        // AbortController timeout (e.g. 'Timeout (>30s)'). Treat both identically
        // so the inner-timeout rejection doesn't escape as Uncaught (in promise).
        if (error && error.message && error.message.startsWith('Timeout')) {
            // Timeout occurred - count as API failure and retry after delay
            const failuresKey = playerNum === 1 ? 'player1ApiFailures' : 'player2ApiFailures';
            const consecutiveFailuresKey = playerNum === 1 ? 'player1ConsecutiveFailures' : 'player2ConsecutiveFailures';

            gameState[failuresKey]++;
            gameState[consecutiveFailuresKey]++; // Increment consecutive failures

            updateScores();

            // Check for forfeit condition in demo mode
            if (gameState[consecutiveFailuresKey] >= MAX_CONSECUTIVE_FAILURES) {
                // Dispatch forfeit event for demo mode
                document.dispatchEvent(new CustomEvent('playerForfeited', {
                    detail: { player: playerNum === 1 ? 'player1' : 'player2' }
                }));
            }

            // Update latency stats display to show error count
            const globalLatencies = playerNum === 1 ? player1GlobalLatencies : player2GlobalLatencies;
            const globalStats = calculateLatencyStats(globalLatencies);
            updateLatencyStatsDisplay(playerNum, globalStats);

            // Hard cap: give up after MAX_TIMEOUT_RETRIES consecutive move-timeout
            // retries instead of looping forever (the playerForfeited event is
            // only handled by an external demo harness, so in normal play there
            // is otherwise no terminator for persistent timeouts).
            if (timeoutAttempt + 1 > MAX_TIMEOUT_RETRIES) {
                const modelName = (playerNum === 1 ? gameState.player1Model : gameState.player2Model).split('/').pop();
                addLog(`❌ ${playerNum === 1 ? 'Red' : 'Blue'} (${modelName}) timed out ${timeoutAttempt + 1}x — forfeits.`, playerNum, false, true);
                // Mark this player dead so checkGameOver declares the opponent
                // the winner, logs the banner, and disables pause. (Mirrors the
                // collision-death path in moveSingleSnake.)
                gameState[deadKey] = true;
                gameState.gameOver = true;
                needsRedraw = true; // Mark canvas for redraw
                checkGameOver();
                return;
            }

            // Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped by MAX_TIMEOUT_RETRIES).
            const delayMs = API_RETRY_DELAY_MS * Math.pow(2, timeoutAttempt);
            if (gameState.debugMode) {
                console.log(`[${formatTimestamp(new Date())}] ⚠️ P${playerNum}: Timeout - retrying in ${delayMs/1000}s... (attempt ${timeoutAttempt + 1}/${MAX_TIMEOUT_RETRIES})`);
            }
            // Only log to game log if not aborted (paused)
            if (!abortSignal?.aborted) {
                addLog(`⏱️ Timeout - retrying in ${delayMs/1000}s... (${timeoutAttempt + 1}/${MAX_TIMEOUT_RETRIES})`, playerNum);
            }

            // Wait for delay then retry if game still active, escalating the attempt counter.
            const timeoutRetryId = setTimeout(() => {
                activeTimeouts.delete(timeoutRetryId);
                if (!gameState.gameOver && !abortSignal?.aborted && !gameState.paused) {
                    moveSnakeWithLLM(playerNum, abortSignal, timeoutAttempt + 1);
                }
            }, delayMs);
            activeTimeouts.add(timeoutRetryId);

            return;
        }
        // Other errors - handle as before
        throw error;
    }

    const direction = result?.direction;
    const latency = result?.latency;
    const directionKey = playerNum === 1 ? 'direction1' : 'direction2';

    // Check if aborted after API call
    if (abortSignal?.aborted || gameState.paused) {
        return;
    }

    if (direction) {
        gameState[directionKey] = direction;
        // Track latency for statistics
        if (latency !== undefined) {
            trackLatency(playerNum, latency);
        }
        // Immediately move this snake
        moveSingleSnake(playerNum, latency);
        // Trigger next move for this snake (loop)
        if (!gameState.gameOver && !abortSignal?.aborted) {
            moveSnakeWithLLM(playerNum, abortSignal);
        }
    }
}

// Draw the game
function draw() {
    // Clear canvas (theme-aware surface)
    const boardColors = getBoardThemeColors();
    ctx.fillStyle = boardColors.bg;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid (subtle)
    ctx.strokeStyle = boardColors.grid;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= GRID_SIZE; x++) {
        ctx.beginPath();
        ctx.moveTo(x * CELL_SIZE, 0);
        ctx.lineTo(x * CELL_SIZE, CANVAS_HEIGHT);
        ctx.stroke();
    }
    for (let y = 0; y <= GRID_SIZE; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * CELL_SIZE);
        ctx.lineTo(CANVAS_WIDTH, y * CELL_SIZE);
        ctx.stroke();
    }

    // Draw fruits
    gameState.fruits.forEach(fruit => {
        const x = fruit.x * CELL_SIZE + CELL_SIZE / 2;
        const y = fruit.y * CELL_SIZE + CELL_SIZE / 2;
        const emoji = fruit.type.emoji;

        // Draw fruit based on type
        if (emoji === '🍎') {
            // Apple - simple red circle with leaf
            ctx.fillStyle = getFruitFill(emoji);
            ctx.beginPath();
            ctx.arc(x, y + 1, CELL_SIZE / 2 - 2, 0, Math.PI * 2);
            ctx.fill();

            // Glow
            ctx.shadowBlur = 10;
            ctx.shadowColor = getFruitFill(emoji);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Leaf
            ctx.fillStyle = '#4CAF50';
            ctx.beginPath();
            ctx.ellipse(x + 2, y - 5, 3, 5, Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

        } else if (emoji === '💎') {
            // Diamond - sparkling diamond shape
            ctx.fillStyle = getFruitFill(emoji);
            ctx.shadowBlur = 20;
            ctx.shadowColor = getFruitFill(emoji);

            ctx.beginPath();
            ctx.moveTo(x, y - 7);
            ctx.lineTo(x + 6, y);
            ctx.lineTo(x, y + 8);
            ctx.lineTo(x - 6, y);
            ctx.closePath();
            ctx.fill();

            // Sparkle effect
            ctx.strokeStyle = '#FFFFFF';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x - 2, y - 2);
            ctx.lineTo(x + 2, y + 2);
            ctx.moveTo(x + 2, y - 2);
            ctx.lineTo(x - 2, y + 2);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Pulse animation (size varies based on time)
            const pulse = Math.sin(Date.now() / 200) * 2;
            ctx.fillRect(x - 1 - pulse/2, y - 1 - pulse/2, 2 + pulse, 2 + pulse);

        } else if (emoji === '⭐') {
            // Star - 5-pointed star
            ctx.fillStyle = getFruitFill(emoji);
            ctx.shadowBlur = 15;
            ctx.shadowColor = getFruitFill(emoji);

            const outerRadius = 7;
            const innerRadius = 3;

            ctx.beginPath();
            for (let i = 0; i < 5; i++) {
                const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
                const x1 = x + Math.cos(angle) * outerRadius;
                const y1 = y + Math.sin(angle) * outerRadius;
                const angle2 = angle + Math.PI / 5;
                const x2 = x + Math.cos(angle2) * innerRadius;
                const y2 = y + Math.sin(angle2) * innerRadius;
                if (i === 0) {
                    ctx.moveTo(x1, y1);
                } else {
                    ctx.lineTo(x1, y1);
                }
                ctx.lineTo(x2, y2);
            }
            ctx.closePath();
            ctx.fill();
            ctx.shadowBlur = 0;

        } else if (emoji === '🍇') {
            // Grapes - cluster of small circles
            ctx.fillStyle = getFruitFill(emoji);
            ctx.shadowBlur = 12;
            ctx.shadowColor = getFruitFill(emoji);

            // Main cluster
            const grapePositions = [
                { dx: 0, dy: -4, r: 4 },
                { dx: -3, dy: 0, r: 3.5 },
                { dx: 3, dy: 0, r: 3.5 },
                { dx: -1, dy: 3, r: 3.5 },
                { dx: 1, dy: 3, r: 3.5 },
            ];

            grapePositions.forEach(grape => {
                ctx.beginPath();
                ctx.arc(x + grape.dx, y + grape.dy, grape.r, 0, Math.PI * 2);
                ctx.fill();
            });

            // Stem
            ctx.strokeStyle = '#6B4D91';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - 8);
            ctx.lineTo(x + 2, y - 10);
            ctx.stroke();
            ctx.shadowBlur = 0;

        } else if (emoji === '🍒') {
            // Cherries - two red circles connected
            ctx.fillStyle = getFruitFill(emoji);
            ctx.shadowBlur = 12;
            ctx.shadowColor = getFruitFill(emoji);

            // First cherry
            ctx.beginPath();
            ctx.arc(x - 3, y + 2, 4, 0, Math.PI * 2);
            ctx.fill();

            // Second cherry
            ctx.beginPath();
            ctx.arc(x + 3, y + 1, 4, 0, Math.PI * 2);
            ctx.fill();

            // Stem
            ctx.strokeStyle = '#4CAF50';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x - 3, y - 2);
            ctx.quadraticCurveTo(x, y - 10, x + 3, y - 3);
            ctx.stroke();
            ctx.shadowBlur = 0;

        } else if (emoji === '🦋') {
            // Butterfly - winged shape
            ctx.fillStyle = getFruitFill(emoji);
            ctx.shadowBlur = 15;
            ctx.shadowColor = getFruitFill(emoji);

            // Left wing
            ctx.beginPath();
            ctx.ellipse(x - 4, y, 5, 6, -0.3, 0, Math.PI * 2);
            ctx.fill();

            // Right wing
            ctx.beginPath();
            ctx.ellipse(x + 4, y, 5, 6, 0.3, 0, Math.PI * 2);
            ctx.fill();

            // Body
            ctx.fillStyle = getCurrentTheme() === 'light' ? '#0F766E' : '#00A888';
            ctx.beginPath();
            ctx.ellipse(x, y, 1.5, 6, 0, 0, Math.PI * 2);
            ctx.fill();

            // Wings flutter animation
            const flutter = Math.sin(Date.now() / 100) * 0.1;
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.beginPath();
            ctx.ellipse(x - 4, y, 3, 4, -0.3 + flutter, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(x + 4, y, 3, 4, 0.3 - flutter, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

        } else if (emoji === '🎁') {
            // Present - gift box
            ctx.fillStyle = getFruitFill(emoji);
            ctx.shadowBlur = 20;
            ctx.shadowColor = getFruitFill(emoji);

            // Box
            ctx.fillRect(x - 5, y - 4, 10, 9);

            // Ribbon (vertical)
            ctx.fillStyle = '#FF6B6B';
            ctx.fillRect(x - 1.5, y - 4, 3, 9);

            // Ribbon (horizontal)
            ctx.fillRect(x - 5, y - 1.5, 10, 3);

            // Bow
            ctx.beginPath();
            ctx.arc(x - 2, y - 5, 2, 0, Math.PI * 2);
            ctx.arc(x + 2, y - 5, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Sparkle particles
            const particles = [
                { dx: -5, dy: -6 },
                { dx: 5, dy: -6 },
                { dx: -6, dy: 3 },
                { dx: 6, dy: 3 },
            ];

            ctx.fillStyle = getFruitFill('🎁');
            particles.forEach(p => {
                const offset = Math.sin(Date.now() / 150 + p.dx + p.dy) * 1;
                ctx.fillRect(x + p.dx + offset - 1, y + p.dy - 1, 2, 2);
            });
        }

        // Value indicator (small number overlay)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.font = `bold 8px ${SYSTEM_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 3;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(fruit.type.value, x, y + 1);
        ctx.shadowBlur = 0;
    });

    // Draw snakes
    drawSnake(gameState.snake1, '#FF6B6B', '#FF4444'); // Red
    drawSnake(gameState.snake2, '#4488FF', '#2F6AE0'); // Blue

    // Draw game over overlay (only if not dismissed)
    if (gameState.gameOver && !gameState.overlayDismissed) {
        // Semi-transparent dark overlay with gradient
        const gradient = ctx.createRadialGradient(
            CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 0,
            CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_WIDTH / 1.5
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
        gradient.addColorStop(1, 'rgba(10, 10, 21, 0.95)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Determine winner
        let winnerText = '';
        let winnerColor = '#ffffff';
        let subtitleText = '';
        let emoji = '🏆';

        const p1ModelName = gameState.player1Model.split('/').pop();
        const p2ModelName = gameState.player2Model.split('/').pop();

        if (gameState.player1Dead && gameState.player2Dead) {
            if (gameState.snake1.length > gameState.snake2.length) {
                winnerText = 'PLAYER 1 WINS!';
                winnerColor = '#FF6B6B';
                subtitleText = p1ModelName;
            } else if (gameState.snake2.length > gameState.snake1.length) {
                winnerText = 'PLAYER 2 WINS!';
                winnerColor = '#4488FF';
                subtitleText = p2ModelName;
            } else {
                winnerText = 'DRAW!';
                emoji = '🤝';
                subtitleText = 'Both snakes eliminated';
            }
        } else if (gameState.player1Dead) {
            winnerText = 'PLAYER 2 WINS!';
            winnerColor = '#4488FF';
            subtitleText = p2ModelName;
        } else if (gameState.player2Dead) {
            winnerText = 'PLAYER 1 WINS!';
            winnerColor = '#FF6B6B';
            subtitleText = p1ModelName;
        }

        const centerX = CANVAS_WIDTH / 2;
        const centerY = CANVAS_HEIGHT / 2;

        // Trophy emoji with glow
        ctx.font = `72px ${SYSTEM_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowBlur = 30;
        ctx.shadowColor = winnerColor;
        ctx.fillText(emoji, centerX, centerY - 70);
        ctx.shadowBlur = 0;

        // Winner text
        ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillStyle = winnerColor;
        ctx.textAlign = 'center';
        ctx.shadowBlur = 20;
        ctx.shadowColor = winnerColor;
        ctx.fillText('🎮 GAME OVER 🎮', centerX, centerY - 35);
        ctx.shadowBlur = 0;

        ctx.font = 'bold 52px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillText(winnerText, centerX, centerY + 20);

        // Model name subtitle
        ctx.font = '28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.3)';
        ctx.fillText(subtitleText, centerX, centerY + 60);
        ctx.shadowBlur = 0;

        // Stats in a nice box
        const statsY = centerY + 100;
        const statsBoxHeight = 100;
        const statsBoxWidth = 380;
        const statsBoxX = centerX - statsBoxWidth / 2;

        // Background for stats
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(statsBoxX, statsY, statsBoxWidth, statsBoxHeight, 10);
        ctx.fill();
        ctx.stroke();

        // Stats text
        ctx.font = '21px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
        ctx.textAlign = 'center';
        ctx.fillText(`🔴 ${p1ModelName}: ${gameState.snake1.length} segments • ${gameState.player1MoveNumber} moves`, centerX, statsY + 30);
        ctx.fillText(`🔵 ${p2ModelName}: ${gameState.snake2.length} segments • ${gameState.player2MoveNumber} moves`, centerX, statsY + 58);

        // Game time - use final elapsed time if game is over
        const elapsed = gameState.finalElapsedTime;
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        const timeDisplay = `⏱️ ${minutes}:${seconds.toString().padStart(2, '0')}`;
        ctx.font = '18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillText(`⏱️ Game Time: ${timeDisplay}`, centerX, statsY + 85);

        // Dismiss hint / Loop countdown
        ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.textAlign = 'center';

        if (gameState.loopMode && gameState.loopCountdownRemaining > 0) {
            // Show loop countdown
            ctx.fillStyle = '#FFD93D';
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#FFD93D';
            ctx.fillStyle = 'rgba(255, 217, 61, 0.9)';
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#FFD93D';
            ctx.fillText(`🔁 Next round in ${gameState.loopCountdownRemaining}s`, centerX, CANVAS_HEIGHT - 30);
            ctx.shadowBlur = 0;
        } else {
            ctx.fillText('Click anywhere to view game board', centerX, CANVAS_HEIGHT - 30);
        }
    }
}

// Draw a single snake
function drawSnake(snake, bodyColor, headColor) {
    const headPos = snake[0];

    snake.forEach((segment, index) => {
        const x = segment.x * CELL_SIZE;
        const y = segment.y * CELL_SIZE;

        // Skip drawing body segments that overlap with the head (snake crashed into itself)
        if (index > 0 && segment.x === headPos.x && segment.y === headPos.y) {
            return;
        }

        // Body/head color
        ctx.fillStyle = index === 0 ? headColor : bodyColor;

        // Draw rounded rectangle for each segment
        const padding = 1;
        ctx.fillRect(x + padding, y + padding, CELL_SIZE - padding * 2, CELL_SIZE - padding * 2);

        // Add glow to head
        if (index === 0) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = headColor;
            ctx.fillRect(x + padding, y + padding, CELL_SIZE - padding * 2, CELL_SIZE - padding * 2);
            ctx.shadowBlur = 0;

            // Draw eyes
            ctx.fillStyle = '#000000';
            const eyeSize = 3;
            const eyeOffset = 4;
            ctx.beginPath();
            ctx.arc(x + CELL_SIZE / 2 - eyeOffset, y + CELL_SIZE / 2 - eyeOffset, eyeSize, 0, Math.PI * 2);
            ctx.arc(x + CELL_SIZE / 2 + eyeOffset, y + CELL_SIZE / 2 - eyeOffset, eyeSize, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}

// Format bytes to compact notation (impl: js/core.js)
function formatBytes(bytes) {
    return SnakeCore.formatBytes(bytes);
}

// Update score display (compact stats line + scoreboard strip)
function updateScores() {
    // Update main stats panel - update only the stats portion with condensed data tracking
    const p1DataDisplay = `↑${formatBytes(gameState.player1DataSent)} ↓${formatBytes(gameState.player1DataReceived)}`;
    const p2DataDisplay = `↑${formatBytes(gameState.player2DataSent)} ↓${formatBytes(gameState.player2DataReceived)}`;

    document.getElementById('p1-model-stats').textContent = `length: ${gameState.snake1.length}, moves: ${gameState.player1MoveNumber} ${p1DataDisplay}`;
    document.getElementById('p2-model-stats').textContent = `length: ${gameState.snake2.length}, moves: ${gameState.player2MoveNumber} ${p2DataDisplay}`;

    // Scoreboard strip: big length + compact sub-line
    if (sbP1Score) sbP1Score.textContent = gameState.snake1.length;
    if (sbP1Sub) sbP1Sub.textContent = `length ${gameState.snake1.length} · ${gameState.player1MoveNumber} moves`;
    if (sbP2Score) sbP2Score.textContent = gameState.snake2.length;
    if (sbP2Sub) sbP2Sub.textContent = `length ${gameState.snake2.length} · ${gameState.player2MoveNumber} moves`;
}

// Reset scoreboard strip to the initial 3-length state
function resetScoreboard() {
    if (sbP1Score) sbP1Score.textContent = '3';
    if (sbP1Sub) sbP1Sub.textContent = 'length 3 · 0 moves';
    if (sbP2Score) sbP2Score.textContent = '3';
    if (sbP2Sub) sbP2Sub.textContent = 'length 3 · 0 moves';
}

// Toggle pause
function togglePause() {
    closeAllModelDropdowns();
    gameState.paused = !gameState.paused;
    // Either entering or leaving pause changes the on-canvas overlay, so
    // request a redraw (the rAF loop is now fully gated on needsRedraw).
    needsRedraw = true;
    if (typeof pauseBtn !== 'undefined' && pauseBtn) {
        pauseBtn.textContent = gameState.paused ? 'Resume' : 'Pause';
    }

    if (gameState.paused) {
        // Dispatch pause event for demo mode
        document.dispatchEvent(new CustomEvent('gamePaused'));

        // Pause the timer
        pauseTimer();
        // Abort all outstanding API requests
        if (gameLoopAbortController) {
            gameLoopAbortController.abort();
            gameLoopAbortController = null;
        }
    } else {
        // Dispatch resume event for demo mode
        document.dispatchEvent(new CustomEvent('gameResumed'));

        // Resume the timer
        startTimer();
        // Create new abort controller for resumed session
        if (!gameLoopAbortController) {
            gameLoopAbortController = new AbortController();
        }
        // When resuming, restart both snake loops
        if (!gameState.gameOver) {
            gameLoop();
        }
    }
}

// Toggle collision avoidance
function toggleCollisionAvoidance() {
    collisionAvoidanceEnabled = collisionAvoidanceCheckbox.checked;
    if (gameState.debugMode) {
        console.log(`Collision avoidance: ${collisionAvoidanceEnabled ? 'enabled' : 'disabled'}`);
    }
    addLog(`${collisionAvoidanceEnabled ? '🛡️ Collision avoidance enabled' : '🚫 Collision avoidance disabled'}`, 1);
    addLog(`${collisionAvoidanceEnabled ? '🛡️ Collision avoidance enabled' : '🚫 Collision avoidance disabled'}`, 2);
}

// Toggle navigation hints (per-fruit distance + compass) — next API call
function toggleProvideHints() {
    provideHintsEnabled = provideHintsCheckbox.checked;
    if (gameState.debugMode) {
        console.log(`Provide hints: ${provideHintsEnabled ? 'on' : 'off'}`);
    }
    const msg = provideHintsEnabled
        ? '🧭 Hints enabled (fruit distance + compass directions in prompt)'
        : '🚫 Hints disabled (fruit coordinates + value only)';
    addLog(msg, 1);
    addLog(msg, 2);
}

// Toggle model reasoning (thinking) mode — changes take effect immediately (next API call)
function toggleThinkingMode() {
    thinkingModeEnabled = thinkingModeCheckbox.checked;
    if (gameState.debugMode) {
        console.log(`Model reasoning (thinking): ${thinkingModeEnabled ? 'enabled' : 'disabled'}`);
    }
    const msg = thinkingModeEnabled
        ? '🧠 Model reasoning enabled (thinking on, may be slower)'
        : '🚫 Model reasoning disabled (thinking off)';
    addLog(msg, 1);
    addLog(msg, 2);
}

// Toggle loop mode
function toggleLoopMode() {
    // Check if loopCheckbox exists
    if (!loopCheckbox) {
        console.error('Loop checkbox not found!');
        return;
    }

    gameState.loopMode = loopCheckbox.checked;
    console.log(`Loop mode: ${gameState.loopMode ? 'enabled' : 'disabled'}`);
    addLog(`${gameState.loopMode ? '🔁 Loop mode enabled - Auto-restart after each game' : '🚫 Loop mode disabled'}`);

    // Stop countdown if loop mode is disabled during countdown
    if (!gameState.loopMode && gameState.loopCountdownInterval) {
        stopLoopCountdown();
        addLog('🚫 Loop countdown cancelled');
        needsRedraw = true;
    }
}

// Start countdown for next round
function startLoopCountdown() {
    if (!gameState.loopMode) {
        return;
    }

    gameState.loopCountdownRemaining = 5;
    addLog(`🔁 Round ${gameState.loopRoundNumber + 1} starting in 5 seconds...`, null, false, true);

    // Update overlay to show countdown
    updateLoopCountdownDisplay();

    gameState.loopCountdownInterval = setInterval(() => {
        gameState.loopCountdownRemaining--;

        if (gameState.loopCountdownRemaining > 0) {
            updateLoopCountdownDisplay();
        } else {
            // Countdown complete, start next round
            clearInterval(gameState.loopCountdownInterval);
            gameState.loopCountdownInterval = null;
            startNextLoopRound();
        }
    }, 1000);
}

// Update the countdown display on canvas
function updateLoopCountdownDisplay() {
    if (!gameState.gameOver) return;

    // Mark for redraw to show countdown updates
    needsRedraw = true;
}

// Start next round in loop mode
function startNextLoopRound() {
    gameState.loopRoundNumber++;

    // Clean up game-specific resources
    cleanupGameResources();

    // Clear log
    logContent.innerHTML = '';

    // Reset pause button
    pauseBtn.disabled = false;
    const iconSpan = pauseBtn.querySelector('.btn-icon');
    if (iconSpan) {
        iconSpan.textContent = '⏸️';
    }

    // Initialize new game
    initializeGame();
    draw();

    // Update player names with model names - AFTER initializeGame
    updatePlayerNamesWithModels();

    // Update score display to reset the stats
    updateScores();

    // Add log entry for new round
    addLog(`🔁 Round ${gameState.loopRoundNumber} started!`, null, false, true);

    // Reset and start timer
    resetTimer();
    startTimer();

    // Start animation loop for continuous visual effects
    startAnimation();

    // Track game loop startup timer
    gameLoopTimeout = setTimeout(() => {
        gameLoopTimeout = null;
        gameLoop();
    }, gameState.turnDelay);
}

// Stop loop countdown (called when loop mode is disabled)
function stopLoopCountdown() {
    if (gameState.loopCountdownInterval) {
        clearInterval(gameState.loopCountdownInterval);
        gameState.loopCountdownInterval = null;
        gameState.loopCountdownRemaining = 0;
    }
}

// Toggle debug mode
function toggleDebug() {
    gameState.debugMode = debugCheckbox.checked;
}

// Toggle all-logs mode (verbose vs. quiet game log)
function toggleAllLogs() {
    allLogsEnabled = allLogsCheckbox.checked;
    if (gameState.debugMode) {
        console.log(`All logs mode: ${allLogsEnabled ? 'enabled' : 'disabled'}`);
    }
}

// Update visibility radius
function updateViewRadius(newRadius) {
    VIEW_RADIUS = parseInt(newRadius);
    if (isNaN(VIEW_RADIUS) || VIEW_RADIUS < 1) {
        VIEW_RADIUS = 1;
    }
    if (VIEW_RADIUS > GRID_SIZE) {
        VIEW_RADIUS = GRID_SIZE;
    }

    // Update UI to reflect the new value
    const viewRadiusInput = document.getElementById('view-radius-input');
    if (viewRadiusInput) {
        viewRadiusInput.value = VIEW_RADIUS;
    }
}

// Show debug tooltip
function showDebugTooltip() {
    // Show tooltip whenever debug button is clicked (both enabling and disabling)
    const message = debugCheckbox.checked ? 'Debug mode enabled - Check console logs' : 'Debug mode disabled';

    // Get the position of the debug checkbox
    const rect = debugCheckbox.getBoundingClientRect();

    // Create temporary tooltip
    const tooltip = document.createElement('div');
    tooltip.textContent = message;
    tooltip.style.cssText = `
        position: fixed;
        top: ${rect.bottom + 8}px;
        left: ${rect.left + (rect.width / 2)};
        transform: translateX(-50%);
        background: #333;
        color: #fff;
        padding: 8px 14px;
        border-radius: 6px;
        font-size: 13px;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        opacity: 0;
        transition: opacity 0.2s;
        white-space: nowrap;
    `;
    document.body.appendChild(tooltip);

    // Fade in
    requestAnimationFrame(() => {
        tooltip.style.opacity = '1';
    });

    // Remove after 2 seconds (tracked for cleanup)
    const fadeOutTimeout = setTimeout(() => {
        tooltip.style.opacity = '0';
        const removeTimeout = setTimeout(() => {
            if (tooltip.parentElement) {
                document.body.removeChild(tooltip);
            }
            activeTimeouts.delete(removeTimeout);
        }, 200);
        activeTimeouts.add(removeTimeout);
        activeTimeouts.delete(fadeOutTimeout);
    }, 2000);
    activeTimeouts.add(fadeOutTimeout);
}

// Restart game
function restartGame() {
    // Clean up game-specific resources
    cleanupGameResources();
    closeAllModelDropdowns();

    logContent.innerHTML = '';
    pauseBtn.disabled = false;
    pauseBtn.textContent = 'Pause';
    gameState.debugMode = false;
    debugCheckbox.checked = false;

    // Initialize view radius input
    if (viewRadiusInput) {
        viewRadiusInput.value = VIEW_RADIUS;
    }

    initializeGame();
    draw();

    // Update player names with model names - AFTER initializeGame
    updatePlayerNamesWithModels();

    // Update score display to reset the stats
    updateScores();

    // Explicitly clear latency overlays
    const p1Canvas = document.getElementById('p1-latency-canvas');
    const p2Canvas = document.getElementById('p2-latency-canvas');
    if (p1Canvas?.parentElement) {
        const overlay = p1Canvas.parentElement.querySelector('.latency-graph-overlay');
        if (overlay) overlay.remove();
    }
    if (p2Canvas?.parentElement) {
        const overlay = p2Canvas.parentElement.querySelector('.latency-graph-overlay');
        if (overlay) overlay.remove();
    }

    addLog('🎮 New battle started!', null, false, true);

    // Reset and start timer
    resetTimer();
    startTimer();

    startAnimation(); // Start fresh animation
    // Track game loop startup timer
    gameLoopTimeout = setTimeout(() => {
        gameLoopTimeout = null;
        gameLoop();
    }, 0);

    // Dispatch event for demo mode
    document.dispatchEvent(new CustomEvent('gameRestarted'));
}

// Helper function to update player names with model names
function updatePlayerNamesWithModels() {
    const player1Name = gameState.player1Model.split('/').pop();
    const player2Name = gameState.player2Model.split('/').pop();

    // Truncate model names if too long and set full name as tooltip
    const p1Element = document.getElementById('p1-model-name');
    const p2Element = document.getElementById('p2-model-name');

    // Truncate to 25 characters with ellipsis
    p1Element.textContent = player1Name.length > 25 ? player1Name.substring(0, 22) + '...' : player1Name;
    p1Element.title = player1Name; // Full name as tooltip

    p2Element.textContent = player2Name.length > 25 ? player2Name.substring(0, 22) + '...' : player2Name;
    p2Element.title = player2Name; // Full name as tooltip
}

// Start game
function startGame(fromDemoMode = false) {
    // Check if demo mode should intercept (only for manual user clicks, not demo mode calls)
    if (!fromDemoMode && typeof window.demoMode !== 'undefined' && window.demoMode.shouldInterceptStartBattle()) {
        console.log('Demo mode is active. Stop demo mode to start manual battles.');
        return;
    }

    syncCredentialsFromInputs();

    if (!gameState.player1ApiUrl) {
        showError('Please load models first (Provider 1 credentials required)');
        return;
    }
    if (!gameState.sameProvider && !gameState.player2ApiUrl) {
        showError('Please provide Provider 2 credentials (or check "Use same provider")');
        return;
    }

    if (!gameState.player1Model || !gameState.player2Model) {
        showError('Please select both player models');
        return;
    }

    logContent.innerHTML = '';
    initializeGame();
    draw();
    closeAllModelDropdowns();

    // Update player names with model names - AFTER initializeGame
    updatePlayerNamesWithModels();

    // Update stats
    document.getElementById('p1-model-stats').textContent = 'length: 3, moves: 0 ↑0B ↓0B';
    document.getElementById('p2-model-stats').textContent = 'length: 3, moves: 0 ↑0B ↓0B';
    resetScoreboard();

    addLog(`🐍 Snake battle: ${gameState.player1Model} vs ${gameState.player2Model}`, null, false, true);

    // Reset and start game timer
    resetTimer();
    startTimer();

    // Start animation loop for continuous visual effects
    startAnimation();

    // Track game loop startup timer
    gameLoopTimeout = setTimeout(() => {
        gameLoopTimeout = null;
        gameLoop();
    }, gameState.turnDelay);
}

// Handle window resize to redraw latency graphs
function handleResize() {
    // Drop stale hover overlays (sized to the pre-resize rect); they are
    // recreated on the next mousemove.
    document.querySelectorAll('.latency-graph-overlay').forEach((el) => el.remove());
    // Get visible latency windows
    const p1Latencies = player1GlobalLatencies.slice(-MAX_LATENCY_HISTORY);
    const p2Latencies = player2GlobalLatencies.slice(-MAX_LATENCY_HISTORY);
    drawLatencyGraph(1, p1Latencies);
    drawLatencyGraph(2, p2Latencies);
}

// Cleanup on page unload to prevent memory leaks
window.addEventListener('beforeunload', cleanupResources);
window.addEventListener('pagehide', cleanupResources);

// Initialize game stats on page load
initTheme();
applyAppVersion();
initProviders();
initProviderPresets();
updateProviderLabels();
initializeGame();

// Handle window resize to redraw latency graphs
addTrackedEventListener(window, 'resize', handleResize);
