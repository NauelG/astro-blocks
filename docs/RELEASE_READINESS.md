<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Release Readiness Checklist

Use this checklist before deciding whether the next version should stay on `-alpha.N` or move to stable (`X.Y.Z`).

## Channel Support (Current State)

Current release automation supports only:

- `vX.Y.Z-alpha.N`
- `vX.Y.Z`

`beta` tags are not supported yet. If you want a beta phase, update `.github/workflows/release-tag.yml` and npm dist-tag rules first.

## 1. Hard Blockers (All Required)

All items must be `YES` before removing `alpha`:

- [ ] No open P0/P1 issues in core flows (`/cms`, `/cms/pages`, `/cms/menus`, auth, public page rendering, `/robots.txt`, `/sitemap-index.xml`, cache invalidation).
- [ ] No planned breaking change in the next release cycle for:
  - block contract (`defineBlockSchema`, schema shape)
  - API routes under `/cms/api`
  - data file structures in `data/*.json`
- [ ] All baseline quality checks pass on `main`:
  - `npm run features:validate`
  - `npm run build`
  - `npm run typecheck`
  - `npm test`
  - `npm run build:playground`
- [ ] Tarball validation passed in a clean Astro consumer project (`npm run pack:local`, install `.tgz`, verify `npm run dev` and `npm run build`).
- [ ] Consumer docs are accurate (`README.md`) and maintainer docs are accurate (`DEVELOPING.md`, `LOCAL_PACKAGE_TESTING.md`).

If any blocker is `NO`, stay on `alpha`.

## 2. Readiness Score (Target: >= 85/100)

Score each category:

| Category | Max |
| --- | ---: |
| Product and UX stability | 20 |
| API and contract stability | 25 |
| Automated quality confidence | 25 |
| Real consumer validation | 20 |
| Documentation and release operations | 10 |
| **Total** | **100** |

### Scoring Guide

#### Product and UX stability (0-20)

- 0-10: Frequent UX changes in admin shell/builders or unresolved workflow friction.
- 11-16: Mostly stable UX, minor improvements pending.
- 17-20: Stable and predictable UX; no high-impact usability debt.

#### API and contract stability (0-25)

- 0-12: Breaking changes likely soon.
- 13-20: Mostly stable; only additive changes expected.
- 21-25: Stable contract and API; breaking changes are not planned.

#### Automated quality confidence (0-25)

- 0-12: Inconsistent CI or gaps in critical tests.
- 13-20: Reliable CI with known non-critical gaps.
- 21-25: Consistently green CI and strong coverage in critical paths.

#### Real consumer validation (0-20)

- 0-8: Validated only in local playground.
- 9-15: Validated in at least one external/real project.
- 16-20: Validated in multiple real projects/environments with no critical regressions.

#### Documentation and release operations (0-10)

- 0-4: Docs/release steps incomplete or outdated.
- 5-8: Mostly complete; minor gaps.
- 9-10: Fully aligned docs and deterministic release process.

## 3. Decision Rule

- Keep `alpha` if:
  - any hard blocker is `NO`, or
  - readiness score is `< 85`.
- Move to stable (`X.Y.Z`) if:
  - all hard blockers are `YES`, and
  - readiness score is `>= 85`.

## 4. Candidate Release Record (Fill Per Version)

| Field | Value |
| --- | --- |
| Candidate version |  |
| Date |  |
| Hard blockers passed | YES / NO |
| Readiness score |  |
| Decision | Keep alpha / Promote stable |
| Owner |  |
| Notes |  |

## 5. Versioning and Changelog Timing

Per repo policy:

- Do not bump `package.json` version during normal development.
- Do not add `CHANGELOG.md` entries during normal development.
- When the user asks to create the commit for a release:
  1. bump `package.json` version
  2. add the `CHANGELOG.md` entry
  3. then commit
