<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0006 — Playground sample required per feature

- **Status:** Accepted
- **Date:** 2026-06-29
- **Decisores:** Nauel Gómez
- **Procedencia:** recorded in `docs/DECISIONS.md` when that log was created (v3.1.1) and
  relocated here verbatim.

## Contexto

The integration is complex to set up and test in isolation. New features need a minimal but real
working demonstration to validate integration correctness and to give contributors a runnable
reference.

## Decisión

Every new feature must ship a minimal working demo under `playgrounds/` in the same change. The
`playgrounds/basic/` Astro project serves as the reference consumer. The playground is excluded
from the npm tarball (`package.json#files` lists only `dist` and `AGENTS.consumer.md`).

## Consecuencias

A playground demo forces the author to validate the feature end-to-end in a real consumer project
before merging. It also serves as a regression baseline: subsequent changes that break the
playground are caught before they reach consumers. The `npm run prepare:playground` and
`npm run dev:playground` scripts make this workflow low-friction.

Evidence in the repo: `playgrounds/basic/`, `package.json#scripts`.
