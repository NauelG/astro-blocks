<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0005 — `AGENTS.consumer.md` ships in the npm tarball; mandatory sync

- **Status:** Accepted
- **Date:** 2026-06-29
- **Decisores:** Nauel Gómez
- **Procedencia:** recorded in `docs/DECISIONS.md` when that log was created (v3.1.1) and
  relocated here verbatim.

## Contexto

AI assistants (Cursor, Claude, Copilot, etc.) increasingly act as first-line documentation for npm
packages. Consumers using AI tooling need accurate, structured context about the integration's
public API.

## Decisión

`AGENTS.consumer.md` is a consumer-facing AI context file listed in `package.json#files` so it
ships inside the npm tarball at `node_modules/@astroblocks/astro-blocks/AGENTS.consumer.md`.
Consumers can initialize it in their project AI context via `npx astro-blocks init-ai`. Updating
`AGENTS.consumer.md` in the same PR as any public API change is a mandatory checklist item.
Compliance is enforced by `tests/consumer-agents-md.test.js`, which fails if any
`package.json#exports` key is undocumented.

## Consecuencias

Shipping the context file in the tarball means it is always version-pinned to the installed release
— no risk of consumer AI context drifting out of sync with the actual API. The structural test
provides a compile-time guard against forgetting to update it.

Evidence in the repo: `AGENTS.consumer.md`, `CONTRIBUTING.md`, `tests/consumer-agents-md.test.js`,
`docs/agents/definition-of-done.md`.
