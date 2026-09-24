# Snake Battle — Game Specification

## Overview

A visual competitive snake battle where two LLM-controlled snakes race for survival and growth by collecting fruits. Each snake moves **independently and asynchronously** — as soon as its model responds — so faster models move more often. Built to demonstrate AI decision-making against an OpenAI-compatible API.

**Tech stack:** plain HTML/CSS/JS, no build tools.

---

## File Structure

```
snake-battle/
├── snake.html        # Main HTML structure
├── assets/
│   └── style.css     # All styling and animations
├── js/
│   ├── game.js       # Game logic, rendering, LLM + latency integration
│   ├── core.js       # DOM-free pure logic (tested, no browser APIs)
│   └── benchmark.js  # Model performance testing system
├── test/
│   └── core.test.js  # `node --test test/` — 15 tests, zero deps
├── README.md         # User documentation
├── AGENTS.md          # Contributor rules for AI assistants
└── spec-snake-game.md # This file
```

---

## Core Mechanics

- **Independent movement:** Each snake moves the moment its LLM responds. No synchronized turns; `gameLoop()` fires `moveSnakeWithLLM(1)` and `moveSnakeWithLLM(2)` in parallel, and each loop self-recurses.
- **Move counter:** `player1MoveNumber` / `player2MoveNumber` increment per snake, shown as `P1 - #43` in logs.
- **30s timeout:** `LLM_TIMEOUT_MS = 30000`. Enforced both by an `AbortController` on the fetch (throws `Timeout (>30s)`) and an outer `Promise.race` in `moveSnakeWithLLM` (the race's `setTimeout` handle is captured and cleared on success/non-timeout rejection to avoid a per-move timer leak, and registered in `activeTimeouts` for pause/stop teardown). Both timeout shapes are caught (any error message starting with `Timeout`). On timeout: increments API failures + consecutive failures, checks forfeit, then retries with **exponential backoff** (`API_RETRY_DELAY_MS * 2^timeoutAttempt` → 2s, 4s, 8s, 16s, 32s). After `MAX_TIMEOUT_RETRIES = 5` consecutive timeouts the player is marked dead and `checkGameOver` declares the opponent the winner (forfeit) — this is the terminator for persistent timeouts in normal play, since `playerForfeited` is only handled by an external demo harness. A successful move resets the backoff counter.
- **Wall wrapping:** `wrapPosition` → `((x % GRID_SIZE) + GRID_SIZE) % GRID_SIZE` on both axes (negatives handled). Walls are safe.
- **Collisions are deadly:** self-collision or hitting the enemy snake = death. Head-on (both heads land on the same cell) = both die. Otherwise the surviving snake wins; equal length = draw.
- **Growth:** eating a fruit of value `V` adds `V-1` extra tail segments (net `+V` length); a replacement fruit spawns immediately.
- **Starting positions:** P1 (red) segments at x=5,4,3 / y=15 moving right; P2 (blue) at x=24,25,26 / y=15 moving left. Each snake starts length 3.
- **Snakes start at length 3** on opposite sides of the 30×30 grid; cannot reverse direction.

### LLM Integration

- **Endpoints:** `GET {apiUrl}models` (load; tries `?verbose=true` first for modality metadata, falls back to plain `/models`); `POST {apiUrl}chat/completions` (decisions).
- **Request body:** `{ model, messages:[{system}, {user}], temperature: 0, chat_template_kwargs: { enable_thinking }, reasoning_effort }` with **`max_tokens` omitted** (see No `max_tokens` below). `enable_thinking` mirrors the **Model Reasoning** Options toggle (`thinkingModeEnabled`, default `false`); when the toggle is off, `reasoning_effort: 'low'` is sent too — some reasoning models ignore `enable_thinking` but honor `reasoning_effort` (GLM-5.3-Flash goes from 8192 tokens / ~93s to <150 tokens / 2-4s). `'low'` rather than `'none'`: on GLM-5.3-Flash `'none'` paradoxically spikes output to the provider's 8192-token default. Models that don't recognize either field ignore them. The benchmark Speed Test sends the same value for apples-to-apples comparison.
- **System prompt** (`SYSTEM_PROMPT1`): survival goal + instructions to respond with ONLY `up`/`down`/`left`/`right`, no thinking; placeholders `{VISIBILITY_SIZE}` → `VIEW_RADIUS * 2 + 1` and `{HINTS_DESC}` → compass-hint wording (or empty) filled at request time.
- **Board state prompt** (`getBoardState`): player color/length/head pos, coordinate-system note ((0,0) top-left; x→right, y→down — without it LLMs' Cartesian prior makes them botch vertical moves and drift horizontally), current direction, enemy info, distance to enemy + length advantage, ASCII board view centered on head (full 30×30 OR `(VIEW_RADIUS*2+1)` square with wrap; legend `@`=head, fruits drawn as their real emoji, `R/r`/`B/b`=bodies `.`=empty), per-direction danger checks, and — if `collisionAvoidanceEnabled` — a `Safe moves:` line (plain, unordered; excludes the exact reverse direction and any colliding cell; phrased `Safe moves (answer with one word):` to restate the output contract at the decision point — otherwise small models parrot their current direction instead of grounding the compass hints). The prompt deliberately recommends NO target fruit — the LLM must pick its own goal from the FRUITS list (emoji, coordinates, value; plus toroidal distance and a wrap-aware compass hint per fruit — e.g. `(8 right, 1 down)`, dominant axis first — when the Options UI toggle `provideHintsEnabled` / "🧭 Provide Hints" is on, which it is by default; with it off the list is coordinates + value only, and the system prompt's `{HINTS_DESC}` placeholder swaps out the compass-hint wording to match). The FRUITS list itself is gated behind `const fruitGuidanceEnabled = true` (code-level toggle; a former Options checkbox was removed since the off state isn't viable — without the list, most LLMs can't read fruit positions from the board view and drift in straight lines).
- **Content stripping:** `SnakeCore.stripThinkingTags` removes reasoning wrappers before the null-check / token estimates — paired `<(thinking|think|thought|reasoning)>…</\1>` blocks *and* orphan open/close tags (some templates, e.g. GLM-5.x, emit only `</think>` with no opening tag). `SnakeCore.parseDirectionReply` receives the raw reply and returns `up`/`down`/`left`/`right` or null: it drops wrappers, keeps only the text after the last closing marker if present, prefers a direction word introduced by an answer marker (`go`/`pick`/`answer`/`choose`/…) within the span since the previous direction mention, and otherwise falls back to the *last* mention (chatty models restate their pick at the end; a one-word reply is unchanged). If no direction is found the response is thrown as an API failure (feeding the retry/forfeit machinery) rather than silently freezing the snake's move loop.
- **No `max_tokens`:** game moves omit the field (`GAME_MAX_TOKENS = null`) so the model finishes on its own. Reasoning models that can't disable thinking emit 1.5k–3.7k completion tokens on hard boards (DeepSeek-V4.1-Flash), which any fixed cap truncates mid-reasoning (`finish_reason: 'length'`, empty content) — an escalation ladder would waste time/tokens and the top rung can't finish within the timeout. `LLM_TIMEOUT_MS` (45s) is the wall-clock backstop; a provider-side truncation is treated as a normal failure (retry/forfeit). Anthropic's native API requires the field, so its builder substitutes a default when `maxTokens` is null.
- **Retries:** on HTTP 429 → exponential backoff `2000 * 2^attempt`, up to `MAX_429_RETRIES = 3`. Other (non-timeout) errors retry up to `MAX_API_RETRIES = 10`. Move timeouts retry with exponential backoff (`2000 * 2^timeoutAttempt`) up to `MAX_TIMEOUT_RETRIES = 5` before stopping the game.
- **Forfeit:** `MAX_CONSECUTIVE_FAILURES = 3` consecutive failures dispatches a `playerForfeited` event and ends the game.
- **Fallback:** on error/invalid response, direction falls back via `findSafeDirection` (still records a latency sample).
- **Pause support:** `togglePause` aborts `gameLoopAbortController` (cancels in-flight fetches); resume creates a fresh controller and restarts the loop. Aborted requests are not logged.
- **Debug mode:** masks the Authorization header, timestamps logs `[HH:MM:SS.mmm]`, correlates request/response with per-player move numbers. `formatTimestamp(date)` helper.

### AI Safety (`collisionAvoidanceEnabled`, default on)

- `findSafeDirection(head, preferredDirection, snake, otherSnake)`: tries preferred dir, then up/right/down/left, excluding the reverse direction and any cell colliding with own body (excl. head) or the whole enemy. Returns preferred if nothing is safe.
- Used in two places: (1) `moveSingleSnake` pre-checks the intended cell; if deadly, overrides direction and logs `🔄 Collision avoided!`; (2) feeds "Safe moves" hints into the LLM prompt.
- Toggle affects both hint injection and automatic override simultaneously; change takes effect immediately, no restart.

---

## Fruit System

3 fruits on board at all times (`NUM_FRUITS = 3`). `placeFruit()` picks a random empty cell (≤100 tries) with weighted spawn. FRUIT_TYPES carry only `emoji`/`value`/`color`; spawn weights + rarity labels live separately.

| Emoji | Name | Growth | Spawn | Color | Animation |
|-------|------|--------|-------|-------|-----------|
| 🍎 | Apple | +1 | 40% | `#FF6B6B` | static (circle + green leaf) |
| ⭐ | Star | +3 | 25% | `#FFD93D` | static (5-point star) |
| 🍇 | Grapes | +2 | 15% | `#9B5DE5` | static (5-circle cluster + stem) |
| 🍒 | Cherry | +2 | 10% | `#FF4444` | static (two circles + quadratic stem) |
| 🦋 | Butterfly | +3 | 6% | `#00F5D4` | wing flutter `sin(Date.now()/100)` |
| 💎 | Diamond | +4 | 3% | `#00D9FF` | pulse `sin(Date.now()/200)` + sparkle cross |
| 🎁 | Present | +5 | 1% | `#FF9F1C` | sparkle particles `sin(Date.now()/150)` |

Each fruit's growth value is overlaid as bold 8px text during render.

---

## UI Layout

Two-column flex (`main-container`, `.left-pane` + `.right-pane`): a **left config pane** (`width:400px`, `min-width:350px`, `flex-shrink:0`) and a **right game pane** (`flex:1`, `overflow-y:auto`). The right pane scrolls as a whole — its children aren't independently scrolling outside the log canvas and latency graph canvases.

**Responsive:** stacks vertically (`flex-direction:column`) at **≤600px**; at **≤1200px** the left pane shrinks to `350px` (`min-width:300px`). Font scales down at ≤1400px and ≤1200px (`.player-model`, `.player-stats-text`, `.vs`).

```
┌─────────────────────────────────────────────────────────────┐
│                          🐍🐍 Snake Battle 🐍🐍              │
├──────────────────┬──────────────────────────────────────────┤
│  LEFT PANE       │  RIGHT PANE (game)                       │
│  .left-pane      │  .right-pane                             │
│  (config, 400px) │  (flex:1)                                │
│                  │                                          │
│  API URL         │  ⏱️ M:SS  timer  (#game-timer)           │
│  API Key         │  ┌────────┬───────────────────┬────────┐ │
│  ⚡ Load Models  │  │ Fruit  │   Game Canvas     │ Game   │ │
│  P1 model search │  │ Legend │   #game-canvas    │ Log    │ │
│  P2 model search │  │ (left) │   600×600, 30×30  │(right) │ │
│  ⚙️ Options ▶    │  │ ~200px │                   │ 250px  │ │
│   - Visibility   │  │        │                   │ 600px  │ │
│   - Coll. Avoid  │  └────────┴───────────────────┴────────┘ │
│   - Debug        │  ┌──────────────┐  VS  ┌──────────────┐ │
│  ⚡ Extra ▶      │  │🔴 P1 card    │      │🔵 P2 card    │ │
│   - Speed Test   │  │ model/stats  │      │ model/stats  │ │
│   - Sort btns    │  │ latency graph│      │ latency graph│ │
│  [Start][⏸][🔄]  │  │ min/med/p90/ │      │ min/med/p90/ │ │
│  ☑ Loop mode     │  │   max stats  │      │   max stats  │ │
│                  │  └──────────────┘      └──────────────┘ │
└──────────────────┴──────────────────────────────────────────┘
                                       (benchmark modal floats)
```

> Inside `.right-pane`, top-to-bottom: timer → `.game-layout` (3 cols) → `.stats-panel` (2 player cards + VS). The stats panel is **below** the game layout, not above.

### Left pane (config / controls)
- **API URL** (`#api-url`, pre-filled Nebius), **API Key** (password), **⚡ Load Models** button + spinner/error.
- **Searchable model dropdowns** (`.searchable-dropdown`): `.model-search-input` + `.dropdown-options` for P1 and P2 (type-to-filter, case-insensitive, selects first match; invalid free-text reverts on blur). Player labels `🔴 Player 1 (Red Snake)` / `🔵 Player 2 (Blue Snake)`.
- **Options section** (`#options-section`, collapsible, starts collapsed): Visibility Radius input (1–30, default 10), Collision Avoidance checkbox (on by default), Debug Mode checkbox, Model Reasoning checkbox (off by default — toggles `chat_template_kwargs.enable_thinking`).
- **Extra section** (`#extra-section`, collapsible, starts collapsed): ⚡ Speed Test, 📈 Show Results, Sort by Name / by Speed buttons.
- **Control bar**: Start Battle, Pause ⏸️, Restart 🔄, and Loop-mode checkbox (on by default) — all in the left pane, not on the game screen.
- Collapse toggles animate `max-height`/opacity via `.collapsed` class.

### Right pane (game)
Order, top → bottom: timer, three-column game layout, stats panel.

- **Timer** (`#game-timer`, `⏱️ M:SS`): sits at the top of the game pane above `.game-layout`. Freezes at game end via `finalElapsedTime`.
- **Two-column game-layout** (`.game-layout`, flex, `gap:20px`, `width:100%`), preceded by a **`.game-toolbar`** row holding the `🍎 Legend` trigger button:
  - **Legend trigger** (`#fruit-legend-btn`, `.fruit-legend-btn` in `.game-toolbar`): compact button; click opens a fixed `.fruit-legend-popover` (pinned below the button, `z-index:10000`, outside-click/Escape/scroll-resize aware) showing 7 fruit rows with emoji/name/value/rarity. No longer an always-visible left column.
  - **Center — Canvas** (`.game-center-panel` `flex:1` `max-width:600px` → `#game-canvas`, 600×600px, 30×30 grid at 20px/cell, bg `#0a0a15`, subtle grid, glowing teal border).
  - **Right — Game Log** (`.game-right-panel` `width:250px` `flex-shrink:0` → `.game-log-panel` `width:100%` **fixed `height:600px`**, scrollable `#log-content`, 11px font, custom teal scrollbar).
- **Stats panel** (`.stats-panel`, below the game layout): two `.player-card`s (`flex:1`) separated by a `.vs`. Each card: colored dot, model name (truncated >25 chars → 22+"…"), and metrics `length/moves/↑bytes ↓bytes`, plus a `.latency-timegraph` (60px high graph canvas) and a `.latency-stats` block (Min/Median/P90/Max/API calls).
- **Game-over overlay:** drawn on canvas — 🏆/🤝 winner, loser, stats box (`roundRect`), final time; shows loop countdown `🔁 Next round in Ns` when `loopMode` is on, else a "Click anywhere to view game board" hint (clicking dismisses the overlay via `overlayDismissed`).

### Log entry format
```
P1 - #43: 🔴⚠️ → 234ms
P2 - #38: 🔵 ↓ 567ms
P1 - #44: 💎 Ate +4
P2 - #39: ⏱️ Timeout - retrying in 2s... (1/5)
P1 - #45: 💥 HEAD-ON COLLISION!
```
- Player header `P1`/`P2` colored red/teal; `#N` increments per player.
- Snake emoji + `⚠️` when in danger; direction arrow `↑↓←→`; latency `Nms` color-coded; `⏱️` on timeout; food `Emoji +V`; crashes `💥`.
- **Smart auto-scroll:** scrolls to bottom via `requestAnimationFrame` only when near bottom (pauses when the user scrolls up).
- **Latency color coding:** teal `<500ms` (fast), yellow `500–1500ms` (medium), red `>1500ms` (slow); tooltip adds `VERY SLOW` ≥3000ms. Backed by `data-latency-fast|medium|slow` attributes.

---

## Latency Tracking

- `trackLatency(player, latency)` pushes to `playerNGlobalLatencies` (capped at `MAX_GLOBAL_LATENCY_HISTORY = 1000`, oldest shifted out) and refreshes the meter.
- `drawLatencyGraph(player, latencies)` renders the last `MAX_LATENCY_HISTORY = 50` samples as a line+dot graph in player color on a high-DPI canvas; dynamic Y-scale `max(visibleMax, 200) * 1.2`; "Waiting for data…" when <2 samples; geometry stored in `canvas.dataset.graphData`. Threshold lines at 500ms/1500ms.
- **Interactive tooltip** on hover: `handleLatencyGraphMouseMove` finds the nearest sample by X and shows a tooltip (Move #, latency ms, speed tier) + an **overlay canvas** (`redrawGraphWithOverlay`) drawing a dashed vertical line and ring at the hovered point (non-destructive). `handleLatencyGraphMouseLeave` clears both. Tooltip styles injected once by `addTooltipStyles`; crosshair cursor.
- `calculateLatencyStats` → `{min, max, median, p90}`; `calculatePercentile` uses linear interpolation. `updateLatencyStatsDisplay` writes API calls (+⚠️ error count), Latest, Min, Median, P90, Max.
- `resetLatencyTracking()` (called on init/restart) clears arrays, canvases, overlays, and stats.

> Note: there is no separate "latency bar" component — the per-player graph + stats block in each stat card *is* the latency meter.

---

## Configuration

### User-configurable (UI)
| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| API URL | `https://api.tokenfactory.nebius.com/v1/` | — | OpenAI-compatible endpoint (trailing slash normalized) |
| API Key | — | min 10 chars, `^[A-Za-z0-9\-_\.]+$` | Auth key (password input) |
| Player 1 / 2 Model | first / second available | — | Searchable dropdown |
| Debug Mode | off | on/off | Console logging, masked auth |
| Collision Avoidance | on | on/off | Hints + auto safe-move override |
| Model Reasoning | off | on/off | `chat_template_kwargs.enable_thinking` in API calls (e.g. GLM-5.x thinking mode). Dynamic — next move uses new setting. Also drives the Speed Test. |
| Visibility Radius | 10 | 1–30 | Snake vision radius in cells (30 = full grid) |
| Loop Mode | on | on/off | Auto-restart with 5s countdown |

### Hardcoded constants (`js/game.js`)
| Constant | Value | Description |
|----------|-------|-------------|
| `GRID_SIZE` | 30 | Board (30×30 = 900 cells) |
| `CELL_SIZE` | 20 | px per cell (600×600 canvas) |
| `CANVAS_WIDTH/HEIGHT` | 600 | Canvas px |
| `NUM_FRUITS` | 3 | Fruits on board |
| `LLM_TIMEOUT_MS` | 45000 | Per-request timeout (45s; reasoning models can run ~28s) |
| `API_RETRY_DELAY_MS` | 2000 | Retry delay (2s) |
| `MAX_API_RETRIES` | 10 | Non-429 error retries |
| `MAX_429_RETRIES` | 3 | 429 retries (exponential backoff) |
| `MAX_CONSECUTIVE_FAILURES` | 3 | Forfeit threshold |
| `GAME_MAX_TOKENS` | `null` | Omit `max_tokens` (model decides) |
| `MAX_LATENCY_HISTORY` | 50 | Graph samples |
| `MAX_GLOBAL_LATENCY_HISTORY` | 1000 | Stored samples (circular) |
| `VIEW_RADIUS` | 10 (let) | Vision radius, UI-adjustable, clamped [1,GRID_SIZE] |
| `LLM_FULL_GRID_VIEW` | false | Toggle full-grid vs radius view |
| `FRUIT_TYPES` | array | 7 fruit configs (see Fruit System) |

---

## Game State Object (`gameState`)

```javascript
{
  snake1, snake2,                  // [{x,y},...] head at index 0
  fruits,                          // [{x, y, type, spawned}]
  direction1, direction2,          // current {x,y}
  nextDirection1, nextDirection2,  // legacy — written but unused
  gameOver, paused,
  player1Dead, player2Dead,
  player1MoveNumber, player2MoveNumber,
  player1ApiCalls, player2ApiCalls,
  player1ApiFailures, player2ApiFailures,
  player1ConsecutiveFailures, player2ConsecutiveFailures,
  turnDelay,                       // ms delay before loop starts (init 0)
  apiUrl, apiKey,
  player1Model, player2Model,
  debugMode,
  overlayDismissed,                // hide overlay on canvas click
  gameStartTime, gamePausedTime,   // timer
  winnerLogged,                    // guards duplicate winner logs/events
  player1DataSent/Received, player2DataSent/Received, // bytes
  loopMode,
  loopCountdownRemaining,          // seconds (starts 5)
  loopCountdownInterval,           // interval id
  loopRoundNumber,
  finalElapsedTime                 // seconds — frozen at game end
}
```

---

## Key Functions

**Init / lifecycle**
- `initializeGame()` — reset snakes/fruits/counters/latency + DOM stats.
- `startGame(fromDemoMode=false)` — validate, populate legend, init, draw, start timer + animation, schedule `gameLoop()` after `turnDelay`.
- `restartGame()` — full cleanup, clear log, debug off, init, dispatch `gameRestarted`.
- `cleanupAllResources()` / `cleanupResources()` (alias) — stop animation/timer/countdown, clear timeouts, remove listeners, abort controller, clear latency. `cleanupGameResources()` — lighter reset used between loop rounds (keeps listeners + latency).
- `startAnimation()` / `stopAnimation()` — rAF loop; redraws only when `needsRedraw` or paused/gameOver (overlay animation).

**Models**
- `loadModels()` — GET, verbose-first, `filterTextModels` (text→text only via Nebius `architecture.modality` / OpenAI `capabilities.modalities` / pattern fallback; `isNonTextModel` excludes whisper/tts/audio/image/vision/dall-e/etc.), sort alphabetically, populate selects, dispatch `modelsLoaded`.
- `populateSearchableDropdown` / `setupSearchableDropdown` — searchable dropdown behavior.
- `normalizeApiUrl` / `isValidApiUrl` / `isValidApiKey` — validation.

**Game loop**
- `gameLoop()` — bail if over/paused; create `AbortController`; fire both `moveSnakeWithLLM` in parallel.
- `moveSnakeWithLLM(player, signal, timeoutAttempt=0)` — guard; `Promise.race` LLM call vs `LLM_TIMEOUT_MS` (timer captured, cleared on non-timeout settlement, registered in `activeTimeouts`); on success set direction, `trackLatency`, `moveSingleSnake`, recurse (resetting timeoutAttempt); on any `Timeout*` error increment failures, check forfeit, then either mark the player dead + `checkGameOver` (opponent wins by forfeit) after `MAX_TIMEOUT_RETRIES`, or schedule an exponential-backoff retry (`2^timeoutAttempt * API_RETRY_DELAY_MS`, counter escalated).
- `moveSingleSnake(player, latency)` — increment counters, `updateScores`, log (color-coded latency + danger), collision-avoidance override, move, head-to-head vs self/enemy collision, eat fruit (grow + respawn), pop tail (or keep head if dead), draw, re-check game over.
- `checkGameOver()` — `winnerLogged` guard; winner by dead flags + length (draw if equal); log winner; disable pause; capture `finalElapsedTime`; stop timer; dispatch `gameEnded`; start loop countdown if `loopMode`.

**Movement / collision** — `wrapPosition`, `moveSnake`, `checkCollision` (`'self'`/`'enemy'`/null), `checkHeadToHead`, `wouldCollideWithSnake`, `wouldCollideWithSnakeBody`, `calculateNewHead`, `findSafeDirection`.

**LLM** — `getLLMDirectionWithRetry` (cascade + 429 backoff + forfeit), `getLLMDirection` (builds request, tracks bytes/tokens estimate, `AbortController`+setTimeout timeout, strips thinking tags, detects null/length-limited, maps direction, resets consecutive failures).

**Fruit** — `placeFruit` (weighted, ≤100 tries), `removeFruit` (defined; eating mutates `fruits` inline).

**Rendering** — `draw()` (clear + grid + fruits via per-type drawing + both snakes + overlay), `drawSnake(snake, bodyColor, headColor)` (rounded segments, head glow + eyes, skips body overlapping head), `formatBytes`.

**UI / toggles** — `updateScores` (length/moves/bytes), `addLog`, `togglePause`, `toggleCollisionAvoidance`, `toggleLoopMode`, `startLoopCountdown` / `updateLoopCountdownDisplay` / `stopLoopCountdown`, `startNextLoopRound`, `toggleDebug`, `updateViewRadius` (clamp [1,30]), `showDebugTooltip` (tracked timeout), `updatePlayerNamesWithModels` (truncate >25 chars), `updateTimerDisplay`/`startTimer`/`stopTimer`/`pauseTimer`/`resetTimer`, `handleResize` (redraw latency graphs).

**Timer** — `m:ss` from `gameStartTime` (minus `gamePausedTime`); 1s interval; returns `gamePausedTime` while paused.

---

## Custom DOM Events

Dispatched on `document` (consumed by an external demo/tournament harness; `js/game.js` only dispatches — except `startGame` checks `window.demoMode?.shouldInterceptStartBattle()`):

| Event | Dispatched from | `detail` |
|-------|-----------------|----------|
| `modelsLoaded` | `loadModels()` | — |
| `playerForfeited` | `getLLMDirectionWithRetry`, `moveSnakeWithLLM` (timeout path) | `{ player: 'player1' \| 'player2' }` |
| `gameEnded` | `checkGameOver()` (winner non-null) | `{ winner: 'player1' \| 'player2' \| 'draw' }` |
| `gamePaused` / `gameResumed` | `togglePause()` | — |
| `gameRestarted` | `restartGame()` | — |

`beforeunload` / `pagehide` → `cleanupResources`.

---

## Loop Mode

On game end with `loopMode` on, `startLoopCountdown()` runs a 5s interval; the overlay shows `🔁 Next round in Ns`; at 0 it calls `startNextLoopRound()` (increments `loopRoundNumber`, `cleanupGameResources`, clears log, re-inits, restarts timer + animation, schedules `gameLoop()`). Disabling the checkbox mid-countdown cancels it. Default on.

---

## Security & Performance

- **XSS protection:** game log uses safe DOM manipulation; latency spans built as elements with `data-latency-*` attributes (not string injection). User input goes through DOM APIs.
- **Input validation:** `isValidApiUrl` (http/https), `isValidApiKey` (length + charset), bounds checks on `max_tokens` level and view radius.
- **API keys:** password input, only in memory, not persisted; Authorization header masked in debug logs.
- **Redraw optimization:** `needsRedraw` flag — rAF redraws only on state change or when paused/gameOver (for overlay/animation).
- **Memory:** latency arrays capped at 1000 (oldest shifted); all `setTimeout` ids tracked in `activeTimeouts` and cleared on teardown; `AbortController` aborts in-flight requests on pause/cleanup.
- **Cleanup:** `cleanupAllResources` / `cleanupGameResources` stop animation, timer, loop countdown, abort controller, clear timeouts, remove tracked listeners, clear latency data.

---

## Visual Design

**Color palette**

| Element | Color |
|---------|-------|
| Body bg | gradient `#1a1a2e → #16213e → #0f3460` |
| Canvas bg | `#0a0a15` |
| Grid lines | `rgba(255,255,255,0.05)` |
| Accent (UI) | `#4ecdc4` (teal) |
| P1 body / head | `#FF6B6B` / `#FF4444` (red) |
| P2 body / head | `#4ECDC4` / `#44B3AC` (teal), dot `#4488ff` |
| P1 log text | `#ff6b6b` |
| P2 log text | `#4ecdc4` |
| Food log | `#ffd93d` |
| Crash log | `#ff6b6b` |
| Latency fast/med/slow | `#4ecdc4` / `#ffdd59` / `#ff6b6b` |
| Debug | `#ffd700` (gold) |

**Effects:** glow (`shadowBlur` / box-shadow) on snake heads, fruits, canvas border, title text-shadow; `backdrop-filter: blur(20px)` on left pane (glass); gradients on buttons (135deg vars); `translateY(-2px)` / `scale()` hover transforms; `@keyframes spin` (spinner), `error-pulse`; custom teal scrollbars (left pane 8px, log 10px gradient thumb); `requestAnimationFrame` 60fps loop.

---

## API Config Examples

| Provider | API URL | Notes |
|----------|---------|-------|
| Nebius Token Factory (default) | `https://api.tokenfactory.nebius.com/v1/` | pre-filled |
| OpenAI | `https://api.openai.com/v1/` | gpt-4o, etc. |
| Compatible proxy (e.g. Claude) | `{proxy}/v1/` | OpenAI-compat |
| Ollama | `http://localhost:11434/v1/` | local, key often blank |
| LM Studio | `http://localhost:1234/v1/` | key `lm-studio` or blank |

All require an OpenAI-compatible `/models` and `/chat/completions`. CORS must be permitted by the provider.

---

## Running

No build step. Open `snake.html` in a modern browser, enter API URL + key, Load Models, pick models, Start Battle.

Optional dev server:

```bash
python3 -m http.server 8000   # http://localhost:8000
# or
npx serve .
```

**Requirements:** Canvas 2D, Fetch API, ES6+ (async/await, arrow fns, template literals, destructuring), Flexbox, `requestAnimationFrame`, `backdrop-filter` (degrades gracefully).

**Dependencies:** none. External service: an OpenAI-compatible LLM API.

---

## Performance Notes

- Each snake makes API calls at its own pace; two async loops run concurrently.
- Canvas render is lightweight (mostly static), redrawn on state change.
- Latency arrays capped at 1000 samples; game state ~2KB; log grows with turns (can clear manually).
- Faster models dominate — move counters make this visible by design.

---

## Extension Ideas

Multiplayer (human keyboard), obstacles, power-ups, tournament/round-robin, replay system, save/load, editable system prompts, board themes, sound effects, stats dashboard, more fruit types, real-time move-count graph.
