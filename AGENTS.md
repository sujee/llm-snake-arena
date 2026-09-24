# AGENTS.md — Snake Arena Contributor Rules

## Testing policy (mandatory)

- When you add or update code, also update the tests.
- If no tests exist for the area you touch, create one.
- Pure, DOM-free logic goes in `js/core.js` (exposed as `SnakeCore`, plus `module.exports` for Node) so it is testable without a browser.
- Tests live in `test/` and use zero-dependency `node:test` + `node:assert/strict` (see `test/core.test.js`).
- Run: `node --test test/` — all tests must pass. Also run `node --check js/<file>.js` for every JS file you touch.

## Related rules

- See `CLAUDE.md` for UI layout preservation, security, performance, and git-confirmation rules.
