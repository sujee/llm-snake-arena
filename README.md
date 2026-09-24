# 🐍 LLM Snake Arena

A visual snake battle game where two LLMs compete against each other — each snake powered by a model (from the same provider or different providers!)

<div align="center">

## [🐍 ▶️ TRY IT LIVE! ⚔️](https://sujee.github.io/llm-snake-arena/snake.html)

**Watch two AI snakes battle in your browser — no install needed!**

</div>

## History

LLM Snake Arena originated as a demo created by Sujee Maniyam for the [Nebius Token Factory Cookbook](https://github.com/nebius/token-factory-cookbook). This is an independent version.

The original version can be accessed
- at the [token factory cookbook](https://github.com/nebius/token-factory-cookbook/tree/main/fun/snake-game)
- or via tag [v1.0.0-token-factory-cookbook](https://github.com/sujee/llm-snake-arena/tree/v1.0.0-token-factory-cookbook) in this repo


## Features

### Providers and Models

- **Two model providers**: Choose from supported providers — OpenAI-compatible API providers are supported.
- **Two AI Players**: Pit any two LLM models against each other

### Gameplay

- **Independent Movement**: Each snake moves as soon as its LLM responds; faster models move more frequently
- **Loop Mode**: Auto-restart with a 5-second countdown after each game ends (on by default)
- **Robust API Layer**: 45s per-request timeout with retries (2s backoff; exponential backoff on HTTP 429); exponential backoff on move timeouts (2s→4s→8s→16s→32s) with forfeit after 5 consecutive timeouts; no `max_tokens` cap (reasoning models answer in full) plus `reasoning_effort:'low'` / `enable_thinking:false` when Model Reasoning is off; reasoning-tag stripping + tolerant direction parsing; forfeit after 3 consecutive non-timeout failures

### Visualizations

- **Real-time Visualization**: Watch the snakes move, grow, and compete on a 30×30 canvas
- **Game Log**: Per-move event tracking with color-coded API latency (teal/yellow/red) and smart auto-scroll
- **Latency Graphs**: Interactive per-player time-series graph (hover for exact move + latency) with Min/Median/P90/Max stats
- **Dark + Light Themes**: Topbar toggle (persisted, follows the OS preference by default); board, fruits, log, and panels are all theme-aware
- **Unique Fruit Visuals**: 🍎 Apple (1 pt) • 🍇 Grapes (2 pts) • 🍒 Cherry (2 pts) • ⭐ Star (3 pts) • 🦋 Butterfly (3 pts) • 💎 Diamond (4 pts) • 🎁 Gift (5 pts)

### Game Configuration

- **Collision Avoidance Toggle**: Enable/disable LLM safe-move hints and automatic override (on by default)
- **Provide Hints**: Include per-fruit distance + compass directions in the LLM prompt (on by default; off = coordinates + value only). Without the hints the models have to work 'harder' to determine the next best move.
- **Model Reasoning**: Optionally let models 'think'/reason before answering via `enable_thinking` (off by default)
- **Visibility Radius**: Adjustable snake vision (1–30 cells, default 10; 30 = full grid)
- **Debug Mode**: Console logging with masked auth headers and timestamped request/response correlation

### Other features
- **Model Benchmarking**: Run Benchmarks (Bench 1 – Response Time, Bench 2 – Thinking) with tabbed results, sortable headers, a sort-by-benchmark menu, a results viewer, and Sort by Name


## How to Play

1. Open `snake.html` in your web browser
2. Pick a **provider preset** (Nebius, OpenAI, Anthropic, Together AI, Ollama Cloud/Local, Custom) and enter your **API URL** (pre-filled for presets) and **API Key** (Ollama Local needs no key — leave it blank)
3. Leave **Use same provider for both players** checked, or uncheck it to configure **Provider 2** separately
4. Click **Load Models** to fetch available models
5. Select different models for Player 1 (Red) and Player 2 (Blue) via the searchable dropdowns
6. (Optional) Adjust **Options** — Visibility Radius, Collision Avoidance, Provide Hints, Debug Mode, Model Reasoning
7. Click **Start** to begin the battle

Controls in the Matchup card: **Start**, **Pause** ⏸️, **Restart** 🔄, and a **Loop** toggle. The **Extra** section has **⚡ Run Benchmarks**, **📈 Show Results**, and model sorting (Sort by Name / Sort by Benchmark).


## Tech Stack

- Pure HTML/CSS/JavaScript (no build tools required)
- Canvas API for game rendering
- OpenAI-compatible APIs + native Anthropic API for LLM calls

## Game Rules

- Each snake starts with 3 segments on opposite sides of the grid
- Snakes move **independently** — each moves the moment its LLM responds (no shared turns)
- LLMs choose direction (up/down/left/right); a snake cannot reverse direction
- **30-second timeout**: if a model doesn't respond within 30s, the move times out and is retried with exponential backoff (2s→4s→8s→16s→32s); after 5 consecutive timeouts the model forfeits the round
- **Wall Wrapping**: Going through any wall teleports you to the opposite side! (Left ↔ Right, Top ↔ Bottom). Wall wrapping creates interesting strategies - you might wrap around the board quickly to reach a far-away fruit or trap your opponent!
- Walls are SAFE - only snake collisions cause death
- **Multiple Fruits** appear on the board (3 at a time by default) - eating them makes the snake grow
- **Different Fruit Types** with varying growth values and unique visuals:
  - 🍎 Apple (+1) - 40% spawn rate - Simple red circle with green leaf
  - ⭐ Star (+3) - 25% spawn rate - Golden 5-pointed star with glow
  - 🍇 Grapes (+2) - 15% spawn rate - Purple grape cluster with stem
  - 🍒 Cherry (+2) - 10% spawn rate - Two red cherries with connecting stem
  - 🦋 Butterfly (+3) - 6% spawn rate
  - 💎 Diamond (+4) - 3% spawn rate - RARE! 
  - 🎁 Gift (+5) - 1% spawn rate - RARE! 
- **Collision kills**:
  - Hitting your own body
  - Hitting the enemy snake
  - Walls are SAFE (you wrap through!)
- **Head-on collision**: Both snakes crash simultaneously
- **Winner**: The snake that survives longer. If both crash in the same turn, the longer snake wins (draw if equal length).

## Customization

### From the UI (no code changes)

These settings have controls in the **Options** panel and apply to subsequent moves — no restart needed:

- **Visibility Radius** (`VIEW_RADIUS`) — number input, 1–30, default 10
- **Collision Avoidance** (`collisionAvoidanceEnabled`) — checkbox, on by default
- **Provide Hints** (`provideHintsEnabled`) — checkbox, on by default
- **Model Reasoning** (`thinkingModeEnabled`) — checkbox, off by default

### Code-only (edit `js/game.js`)

These have no UI control — change them in the source:

```javascript
const GRID_SIZE = 30;                 // Board dimensions (30×30). Try 20 for faster games, 40 for more space
const NUM_FRUITS = 3;                 // Fruits on the board at once
const LLM_TIMEOUT_MS = 45000;         // Per-request LLM timeout (45s)
const API_RETRY_DELAY_MS = 2000;      // Base retry delay (also seeds timeout backoff)
const GAME_MAX_TOKENS = null;         // null = omit max_tokens (let the model finish; reasoning models need >1k)
const fruitGuidanceEnabled = true;    // Include FRUITS list in prompt (keep on — off isn't viable gameplay)
const MAX_LOG_ENTRIES = 100;          // Cap on game-log <p> entries (oldest trimmed)
```

Snake starting positions are controlled in `initializeGame`; prompt construction lives in `getBoardState`.

> **Note:** There is no fixed "turn delay" — snakes move at the natural speed of their model's responses. If you want to add artificial pacing, you would add a delay inside `moveSnakeWithLLM` before it recurses.

## API Compatibility

Works with any OpenAI-compatible API that supports:
- `GET /models` endpoint (verbose metadata is tried first for modality filtering, with plain fallback)
- `POST /chat/completions` endpoint
- Standard message format

Plus native Anthropic (`Anthropic` preset → `https://api.anthropic.com/`): `GET /v1/models` + `POST /v1/messages` with `x-api-key` auth, called directly from the browser.

Tested with Nebius Token Factory but should work with others (OpenAI, compatible proxies, Ollama, LM Studio). Models are filtered by **output modality**: any model that produces text output is included (so vision-capable text LLMs like `moonshotai/Kimi-K2.6` are selectable), while pure image/audio generation models are excluded.

## Troubleshooting

**Local Run**

If opening a file in a browser gives you access errors, run a tiny web server like this:

```bash
python -m http.server 8000
```

Go to: http://localhost:8000/snake.html


**Debugging with an Agent**

Have an `.env` file with API keys needed for providers you are testing.

```
NEBIUS_API_KEY=xxxx
OPENAI_API_KEY=yyyy
ANTHROPIC_API_KEY=zzz
...
```

And a sample prompt for an agent

```
Trace a model loading call for provider OpenAI. Use the API key from the .env file
```

```
Debug why provider/model is running out of tokens
```



**"Failed to load models" error:**
- Verify your API key is correct
- Check browser console (F12) for detailed errors
- Some APIs require CORS to be configured to work from the browser

**Snakes don't seem smart:**
- Try different models - some are better at this task than others
- Models get the full 30s timeout to respond; slower models simply move less often
- Keep Collision Avoidance on for safer gameplay, or turn it off to see raw LLM decisions
- The prompt is intentionally simple - complex strategic behavior may need prompting adjustments

**Game too slow/fast:**
- Game speed is determined by model response times — faster models move more often
- Try a faster model for comparison (the move counters and latency graph make speed differences visible)
- Smaller grid sizes (edit `GRID_SIZE` in js/game.js) result in quicker games

**One snake barely moves:**
- That model is slow to respond — it will move less frequently (intended behavior)
- Check the latency graph/stats for that player
- After 3 consecutive API failures (or 5 consecutive timeouts) a model forfeits the round

Enjoy watching AI snake battles! 🐍⚔️🐍
