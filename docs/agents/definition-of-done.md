<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Definition of Done

The single bar for "done" in this repo. `AGENTS.md` and `.github/PULL_REQUEST_TEMPLATE.md` point
here instead of carrying their own lists, so there is one place to change when the bar moves.

There are **two gates, at two different moments**. Conflating them is what let the previous two
copies drift apart:

- **Every change** — the bar for phase 5 (Review) of the cycle, and for every PR.
- **Closing a release** — an extra bar, only when the human asks to close. Never during development.

A gate marked _(CI)_ is enforced by `.github/workflows/ci-main.yml` or `release-tag.yml`. The rest
depend on the author, which is exactly why they are written down.

---

## Every change

### Scope

- **Generic improvement to the integration** — admin UI, API, routes, utils, build, docs, i18n.
  Never consumer-site logic. This is a library; a change that only makes sense for one site is
  out of scope by definition.
- Diff under **~400 lines**, or split into chained PRs with the reason stated in the PR body.
- No closed ADR reopened without explicit justification (`docs/adr/`, indexed by
  `docs/DECISIONS.md`). A new non-obvious decision means a **new** ADR, never an edit to an existing
  one — ADRs are immutable. After adding one, `npm run adr:index` _(CI)_.

### Code

- Conventions and gotchas of `docs/CONTEXT.md` respected; domain concepts named with its glossary's
  vocabulary, not synonyms it avoids.
- Admin panel work follows `docs/DESIGN.md`. It is binding, not advisory.
- Every new file carries the BSL copyright block, per the format table in `AGENTS.md` (never in JSON).
- Breaking changes ship **without fallback or migration** — the code handles only the new contract,
  and the change is documented.

### Gates

- `npm run check` (Biome lint + format) _(CI)_
- `npm run typecheck` _(CI)_
- `npm test` (build + `node:test` suite + root data-leak check) _(CI)_
- `npm run features:validate` _(CI)_ — the features catalog is validated on every PR, not only at
  release. `src/meta/features.json` itself is a release-close task; see below.
- `npm run e2e` (Playwright, against the built playground) _(CI)_
- `npm run secrets` (gitleaks) — the `scripts/hooks/pre-commit` hook scans staged changes, but it
  **degrades to a warning when gitleaks is not installed**, so it is not a gate on its own.
- No credentials, `.env` files or `dist/` artifacts committed.

### Documentation

- **`AGENTS.consumer.md` synced** if the public API, integration options, admin routes or env vars
  changed. See the trigger table in `CONTRIBUTING.md`.
- `README.md` stays **100% consumer-facing**. Build, playground, `npm pack` and maintenance notes go
  to `docs/DEVELOPING.md` / `docs/LOCAL_PACKAGE_TESTING.md`.
- New capability ships a **playground sample** under `playgrounds/`.
- Artifacts routed per `AGENTS.md` § *Enrutado*: decision-with-its-why → `docs/adr/`; domain
  definition or gotcha → `docs/CONTEXT.md`; panel visual rule → `docs/DESIGN.md`; live behaviour →
  `docs/specs/`; ephemeral code context → discard.
- **Do not touch `CHANGELOG.md` and do not bump the version** during development. Both belong to the
  release close.

### Commits

- Conventional Commits, message entirely in English, body explaining **why**.
- No attribution footers of any kind (`Reviewed-by`, `Co-authored-by`, `Generated-by`, `Agent:`).

---

## Closing a release

Only when the human asks to close. In this order:

1. Scope finished; no incidental changes left in `playgrounds/` or data files.
2. `src/meta/features.json` updated, then `npm run features:validate`.
3. `npm run typecheck` and `npm test` green.
4. If the visual surface changed: `npm run screenshots:readme`, and `npm run screenshots:media` when
   media surfaces moved.
5. `CHANGELOG.md` entry at the top: `## [X.Y.Z] - YYYY-MM-DD`, one `### Title` (short phrase, it
   titles the GitHub Release), then `### Added/Changed/Fixed/Removed`. No `[Unreleased]` section.
   CI/infra-only changes get no entry.
6. Version bumped in `package.json`.
7. README version badge matches `package.json` _(CI, at tag)_ — `npm version` runs
   `scripts/sync-readme-version.mjs` for you; a hand-edited bump does not, which is what the gate
   exists to catch.
8. Release commit, then an **annotated** tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`. Never lightweight —
   `git push --follow-tags` only pushes annotated tags.

---

## Pull requests: "How to test visually"

**Every PR body includes this section.** Automated coverage proves the code works; it never proves a
reviewer can *see* it work. This is in addition to the gates above, not instead of them — it does not
lower the bar on tests, it adds a bar for reviewability.

Write it for a reviewer with **no prior context on the change**, human or agent:

- **Where**: the admin route or surface to open (e.g. `/admin/media`), and any state it depends on —
  a specific playground, a seeded block, a config option that must be set.
- **How to get there**: the exact sequence of clicks and inputs, not a summary. Not "test the media
  picker", but "open a block with an image field → Select media → search `hero` → pick a result".
- **What to look at**, stated as an observable fact rather than an assertion: the focus ring on Tab,
  the label still readable at 360 px, the toast after saving, the panel that stays in the DOM when
  dismissed. Never "verify it looks right".
- **For a bugfix**: the before/after contrast — what the reviewer would have seen before, and what
  they see now.
- **For non-visual changes** (build, packaging, server-only refactors, CI): say so explicitly.
  "No visual surface; verified via `npm test`" is a valid answer. Silence is not.

Reproducing the panel locally is `npm run dev:playground` (see `docs/DEVELOPING.md`).
