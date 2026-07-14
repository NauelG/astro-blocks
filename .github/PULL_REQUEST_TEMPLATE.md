<!--
  This is a library/integration PR — no business logic, no site-specific code.
  Changes should improve @astroblocks/astro-blocks for all consumers.
-->

## What & why

<!-- What does this change and WHY. Link any related issue. -->

Closes #

## Scope

- [ ] **Generic improvement** to the integration (admin UI, API, routes, utils, build, docs, i18n) — not consumer site logic.
- Scope(s) touched: <!-- admin-ui · api/handlers · plugin/setup · routes · media · i18n · content-data · build/packaging · docs -->

## Checklist

- [ ] **Conventional Commits** — `<type>(<scope>): <desc>`, body explains WHY. No AI attribution in commits or PR description.
- [ ] Branch is short-lived; diff is **under ~400 lines** (or split into chained PRs with a justification note here).
- [ ] Quality gates pass locally:
  - [ ] `npm test` (build + node:test suite)
  - [ ] `npm run typecheck`
  - [ ] `npm run secrets` (gitleaks — if installed)
- [ ] **CHANGELOG.md** updated (Keep a Changelog format, `### Title` sub-heading required) — if this is user-facing.
- [ ] **`AGENTS.consumer.md` synced** — if public API, integration options, admin routes, or env vars changed (see CONTRIBUTING.md for trigger table).
- [ ] **README version badge** bumped — if this is a release PR (line 17 of README.md).
- [ ] **Playground sample** added or updated under `playgrounds/` — if this introduces a new feature.
- [ ] No closed ADR reopened without explicit justification (see `docs/DECISIONS.md`).
- [ ] No real credentials, `.env` files, or `dist/` build artifacts committed.

## Notes for reviewers

<!-- Blast radius, anything that needs special attention, manual verification steps done. -->
