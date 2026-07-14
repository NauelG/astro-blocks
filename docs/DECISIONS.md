<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Architecture Decision Records

This file is the **public discoverable decision log** for `@astroblocks/astro-blocks`.
It records significant architectural and product decisions so contributors understand
the "why" behind project conventions.

`AGENTS.md` and `AGENTS.consumer.md` remain the working agent context files.
This document is the human-readable canonical record.

---

## Summary table

| #       | Topic                                  | Decision                                              | Status   |
| ------- | -------------------------------------- | ----------------------------------------------------- | -------- |
| ADR-001 | License                                | BUSL-1.1 with 2029-01-01 change date to MIT           | Accepted |
| ADR-002 | Test runner                            | Node built-in `node:test` — no external runner        | Accepted |
| ADR-003 | Release automation                     | Tag-driven CI with npm provenance + dist-tag policy   | Accepted |
| ADR-004 | Admin UI language                      | English default, i18n with en/es catalogs (SSR-first) | Accepted |
| ADR-005 | Consumer AI context file               | `AGENTS.consumer.md` ships in tarball; mandatory sync | Accepted |
| ADR-006 | Playground sample per feature          | Every new feature ships a demo under `playgrounds/`   | Accepted |

---

## ADR-001 — BUSL-1.1 license with 2029 change date to MIT

**Context:** The project needs a license that protects the author during active
development while committing to open-source availability in the future. Pure
open-source (MIT) would allow commercial forks from day one; a proprietary
license would prevent community contribution.

**Decision:** Business Source License 1.1 (BUSL-1.1), with a Change Date of
`2029-01-01`. On that date the license automatically converts to MIT.

**Rationale:** BUSL-1.1 allows free use, modification, and distribution for
non-production and internal purposes. It restricts competing production SaaS
use until the change date. The automatic MIT conversion gives the community a
clear, time-bound commitment. The LICENSE.md and NOTICE.md files, the
`package.json#license` field, and the copyright header on every source file all
carry this declaration.

**Status:** Accepted — see `LICENSE.md`, `NOTICE.md`.

---

## ADR-002 — Node built-in test runner (`node:test`)

**Context:** The project needs a test runner for unit and integration tests. The
JavaScript ecosystem has many options (Jest, Vitest, Mocha, etc.), each adding
a dev dependency and an opinion on module resolution.

**Decision:** Use Node.js's built-in `node:test` module with `node:assert/strict`.
No external test runner is added to `devDependencies`.

**Rationale:** Node 18+ ships `node:test` and `node:assert` in the standard
library. Using them eliminates a dependency, ensures tests always pass through
the same Node version as the integration, and simplifies the CI matrix. The
`npm test` command is `npm run build && node --test tests/*.test.js` — no
configuration file needed. Coverage is collected separately via `c8`.

**Status:** Accepted — see `CONTRIBUTING.md`, `package.json#scripts.test`.

---

## ADR-003 — Tag-driven release automation with npm provenance and dist-tag policy

**Context:** npm packages require a reliable, auditable release process. Manual
`npm publish` is error-prone; the changelog extraction, tag validation, and
provenance attestation need to be automated.

**Decision:** Releases are triggered by pushing a Git tag matching
`vX.Y.Z` (stable) or `vX.Y.Z-alpha.N` (pre-release). The `release-tag.yml`
GitHub Actions workflow validates the tag format, checks it matches
`package.json#version`, extracts the changelog entry via
`scripts/extract-changelog-entry.mjs`, runs `npm test`, and publishes with
`--provenance`. Stable releases go to the `latest` dist-tag only; pre-releases
go to both `latest` and `alpha`.

**Rationale:** Tag-driven automation prevents version mismatches and ensures
every published artifact has a corresponding GitHub Release with the changelog
body. Provenance attestation links the npm package to the exact source commit.
The `### Title` sub-heading requirement in CHANGELOG entries is enforced by the
extractor script — missing it aborts the release.

**Status:** Accepted — see `.github/workflows/release-tag.yml`,
`scripts/extract-changelog-entry.mjs`, `.claude/skills/npm-release/SKILL.md`.

---

## ADR-004 — Admin UI default language English; i18n with en/es catalogs (SSR-first)

**Context:** The admin panel was initially built in Spanish (the maintainer's
language). Issue #1 raised by the community requested English as the default for
international contributors and consumers.

**Decision:** The admin UI defaults to English. A full i18n system was
introduced in v3.1.0 with two catalogs (`src/routes/admin/i18n/en.ts` and
`src/routes/admin/i18n/es.ts`). Language resolution is SSR-first: the server
resolves the UI locale on every request using the resolution order
`cms-ui-locale` cookie → `Accept-Language` header → English fallback. A
language switcher in the profile dropdown writes the `cms-ui-locale` cookie and
reloads the page — no client-side detection or flash.

**Rationale:** English is the lingua franca for OSS tooling. SSR resolution
ensures the first paint is always in the correct language (WCAG 3.1.1 — `<html
lang>` attribute). The cookie/header approach requires no URL changes and is
transparent to the consumer's site routing. Both catalogs are TypeScript files
with strict parity enforced at compile time (missing or extra keys are type
errors). A hardcoded-string guard test (`tests/i18n-no-spanish-leak.test.js`)
prevents Spanish literals from leaking into shared files.

**Status:** Accepted — see `src/routes/admin/i18n/`, `CHANGELOG.md` v3.1.0.

---

## ADR-005 — `AGENTS.consumer.md` ships in the npm tarball; mandatory sync

**Context:** AI assistants (Cursor, Claude, Copilot, etc.) increasingly act as
first-line documentation for npm packages. Consumers using AI tooling need
accurate, structured context about the integration's public API.

**Decision:** `AGENTS.consumer.md` is a consumer-facing AI context file listed
in `package.json#files` so it ships inside the npm tarball at
`node_modules/@astroblocks/astro-blocks/AGENTS.consumer.md`. Consumers can
initialize it in their project AI context via `npx astro-blocks init-ai`.
Updating `AGENTS.consumer.md` in the same PR as any public API change is a
mandatory checklist item. Compliance is enforced by
`tests/consumer-agents-md.test.js`, which fails if any `package.json#exports`
key is undocumented.

**Rationale:** Shipping the context file in the tarball means it is always
version-pinned to the installed release — no risk of consumer AI context drifting
out of sync with the actual API. The structural test provides a compile-time
guard against forgetting to update it.

**Status:** Accepted — see `AGENTS.consumer.md`, `CONTRIBUTING.md`,
`tests/consumer-agents-md.test.js`.

---

## ADR-006 — Playground sample required per feature

**Context:** The integration is complex to set up and test in isolation. New
features need a minimal but real working demonstration to validate integration
correctness and to give contributors a runnable reference.

**Decision:** Every new feature must ship a minimal working demo under
`playgrounds/` in the same change. The `playgrounds/basic/` Astro project
serves as the reference consumer. The playground is excluded from the npm tarball
(`package.json#files` lists only `dist` and `AGENTS.consumer.md`).

**Rationale:** A playground demo forces the author to validate the feature
end-to-end in a real consumer project before merging. It also serves as a
regression baseline: subsequent changes that break the playground are caught
before they reach consumers. The `npm run prepare:playground` and
`npm run dev:playground` scripts make this workflow low-friction.

**Status:** Accepted — see `playgrounds/basic/`, `package.json#scripts`.
