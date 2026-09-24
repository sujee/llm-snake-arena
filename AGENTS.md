# AGENTS.md — Snake Arena Contributor Rules

Snake battle game with LLM-driven opponents: dual-player AI battles, real-time
latency tracking, model benchmarking, game log + stats UI.

## Testing policy (mandatory)

- When you add or update code, also update the tests.
- If no tests exist for the area you touch, create one.
- Pure, DOM-free logic goes in `js/core.js` (exposed as `SnakeCore`, plus `module.exports` for Node) so it is testable without a browser.
- Tests live in `test/` and use zero-dependency `node:test` + `node:assert/strict` (see `test/core.test.js`).
- Run: `node --test test/` — all tests must pass. Also run `node --check js/<file>.js` for every JS file you touch.

## Versioning policy (mandatory)

- Single source of truth: `js/version.js` (`SnakeVersion.APP_VERSION`, exposed as a browser global plus `module.exports` for Node).
- When 'publishing' (merging to `main` / deploying), always bump the version number:
  1. `APP_VERSION` in `js/version.js`
  2. The `#app-version` fallback text and every `?v=` cache-buster in `snake.html`
  3. The assertions in `test/version.test.js`
- Run `node --test test/` and `node --check js/<file>.js` after the bump — all must pass.

## UI layout preservation (mandatory) ⚠️ CRITICAL

**When optimizing code, NEVER break the UI layout structure:**

1. **HTML Structure Rules:**
   - Never add or remove `</div>` tags without proper context
   - Maintain the exact nesting structure: `header.topbar` + `.arena-layout` → `.rail` (setup) / `.centercol` (scoreboard + board + latency) / `.logcard` (game log)
   - All three columns must remain present. The fruit legend is a `🍎` button in `.topbar` that opens a fixed popover; the theme toggle sits beside it.
   - Preserve every element `id` in `snake.html` — `js/game.js` and `js/benchmark.js` wire by id (provider inputs, model dropdowns, board/latency canvases, log, modal).

2. **CSS Layout Rules:**
   - Preserve the arena grid (`300px minmax(0,1fr) 320px`) and the viewport-fit shell (`100dvh`, internal column scroll on desktop)
   - Do not change widths that affect layout structure
   - Maintain the responsive breakpoint (currently 1100px, single column below)
   - Board canvas keeps `aspect-ratio: 1` and the `min(100%, 100dvh - 400px)` cap so scoreboard + latency stay on screen

3. **Before Making Changes:**
   - Verify the visual layout is correct before starting any optimization
   - Test UI changes in browser immediately after modifications
   - Use HTML structure validation tools if unsure
   - Ensure div tags are perfectly balanced (equal opening/closing counts)

4. **After Making Changes:**
   - Check that the `🍎 Legend` button is visible in the topbar, and its popover opens/closes correctly
   - Verify the scoreboard strip sits above the board with the timer centered
   - Confirm latency graphs render under the board and the log rail scrolls internally
   - Test responsive layout at different screen sizes

## Security rules

- Always use DOM manipulation instead of `innerHTML` for user input
- Validate and sanitize all API inputs (URLs, keys, model names)
- Never trust and directly inject user-controlled content into the DOM

## Performance rules

- Canvas rendering: Use dirty rectangle approach when updating game state
- Memory management: Track and clean up all timeouts, event listeners, and async operations
- State changes: Only redraw when actual game state changes, use `needsRedraw` flag

## Code quality standards

- Maintain proper error handling with meaningful messages
- Keep functions focused and single-purpose
- Use descriptive variable names and add comments for complex logic
- Follow consistent code formatting and patterns

## Browser/manual testing requirements

- Test XSS protection by attempting malicious input in model names/logs
- Verify memory usage doesn't grow unbounded during extended gameplay
- Monitor frame rate and ensure smooth animations
- Test cleanup by starting/stopping games multiple times

## Development workflow

1. Read and understand existing code structure before making changes
2. Test UI layout after any HTML/CSS modifications
3. Run security checks before committing XSS-related changes
4. Perform performance testing after optimizations
5. Ensure all critical bugs are fixed before adding new features

## Git operations ⚠️

**ALWAYS ask for confirmation before any `git commit` (or other git mutation: push, amend, reset, etc.), even if the user has approved similar operations in the past.** Present the proposed message/files first, then wait for an explicit yes.

## Critical files

- `snake.html`: Main UI structure (maintain careful balance of div tags)
- `assets/style.css`: Layout and styling (preserve flex layouts and panel dimensions)
- `js/game.js`: Game logic and performance optimizations
- `js/core.js`: DOM-free pure logic (collision, grid math, validation, stats) — tested by `test/core.test.js`
- `js/benchmark.js`: Model performance testing

## Known issues and fixes (historical)

- Fixed: HTML structure breaking due to extra `</div>` tags
- Fixed: XSS vulnerabilities in game log rendering
- Fixed: Memory leaks from untracked setTimeout calls
- Fixed: Canvas performance issues from excessive redraws
- Fixed: JavaScript syntax errors from duplicate code blocks
