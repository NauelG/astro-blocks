<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0002 — Node built-in test runner (`node:test`)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Decisores:** Nauel Gómez
- **Procedencia:** recorded in `docs/DECISIONS.md` when that log was created (v3.1.1) and
  relocated here verbatim.

## Contexto

The project needs a test runner for unit and integration tests. The JavaScript ecosystem has
many options (Jest, Vitest, Mocha, etc.), each adding a dev dependency and an opinion on module
resolution.

## Decisión

Use Node.js's built-in `node:test` module with `node:assert/strict`. No external test runner is
added to `devDependencies`.

## Consecuencias

Node 18+ ships `node:test` and `node:assert` in the standard library. Using them eliminates a
dependency, ensures tests always pass through the same Node version as the integration, and
simplifies the CI matrix. The `npm test` command is `npm run build && node --test tests/*.test.js`
— no configuration file needed. Coverage is collected separately via `c8` (see ADR-0014).

Evidence in the repo: `CONTRIBUTING.md`, `package.json#scripts.test`.
