<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — The admin server-renders no content data

Vertical slices, four commits. The shared loading affordance lands first (T1–T2, commit **A**); the
five table pages migrate (T3–T8, commit **B**); the dashboard (T9–T11, commit **C**); the guard and
the e2e (T12–T14, commit **D**). Glossary and verification close it (T15–T16).

`npm test` runs `npm run build` first (`package.json:70`) and tests import from `../dist/…`, so every
verify step is plain `npm test` unless noted.

> **Eight plan-time findings folded in.**
>
> 1. **Tier 2 does not exist.** The proposal put `menus` in its own tier because `refreshMenus()`
>    looked conditional. It is not: `client/menus-editor.ts:538` ends init with an unconditional
>    `void refreshMenus();`. **All five table pages are pure deletion**; only the dashboard is new
>    code.
> 2. **But two editors swallow a failed initial load.** `menus-editor.ts:538` and
>    `languages-editor.ts:354` call `void refreshX()` with **no `.catch`**. Today an SSR-rendered table
>    masks it. Once the rows are gone, a failed load leaves the page on "Loading…" forever with nothing
>    reported. `page-editor.ts:1071` (`.catch(reportFailure)`), `configs-editor.ts:189` and
>    `redirects-editor.ts:215` already handle it. **Fixing these two is a prerequisite of the
>    deletion, not a nicety** — T5.
> 3. **Column counts, measured.** `pages` 6, `configs` 5, `redirects` 6, `languages` 6, `menus` 4
>    (from each `<thead>`, action columns included). `design.md` said redirects 5; corrected there.
>    A wrong `colspan` is visible, so each is taken from the file, not assumed.
> 4. **`index.astro` has zero `id=` attributes.** Being fully server-rendered, it has no hooks at all —
>    the dashboard shell must be instrumented from scratch, which is the bulk of commit C.
> 5. **The SSR counts are not uniform.** `pages.astro:61` interpolates **two** values (`count` and
>    `published`), `redirects.astro:57` and `menus.astro:55` one each, and `languages.astro` renders no
>    count. Per-page work, not a sweep.
> 6. **`global-blocks` and `import-export` already comply.** Their `.map(` calls run over
>    `globalBlocksRegistry` (from `astro-blocks-runtime`, the baked registry — schema, already in the
>    client bundle) and a static `exportUnits` list. Neither calls a loader; neither changes.
> 7. **`common.loading` does not exist**; the `common.*` namespace does (`en.ts:70+`). One new key,
>    both catalogs — parity is a compile error via `CatalogKey` (ADR-0034), so a miss fails `tsc`.
> 8. **`fetchJson<T>` (`client/common.ts:88`) throws on a non-ok response**, unlike `fetchMedia` which
>    returns a safe default. The dashboard wants the throwing one: a silent zero is exactly the
>    failure that hid the broken screenshot tokens for months.

---

## Commit A — one loading affordance

### T1 — Shared CSS + i18n key

- [ ] **File:** `src/styles/cms-admin.css` — rename `.cms-media-loading` to `.cms-loading-state` and
  add `.cms-table-loading-row td` (same padding/centring, muted colour) per `design.md` §2. One
  loading style in the panel, not two.
- [ ] **Files:** `src/routes/admin/i18n/en.ts`, `es.ts` — add `common.loading`: `Loading…` /
  `Cargando…`. (`media.loading` stays: it names *what* loads, which reads better on a page that is
  only a library.)
- [ ] **File:** `src/routes/admin/media.astro` — switch the shell's class to `.cms-loading-state`.
- **Verify:** `npm test && npm run typecheck` — TS1360 fires if either catalog is missed;
  `media-copy-guard` still green.

### T2 — Commit A

- [ ] `refactor(admin): generalise the loading affordance to one class and one string`

---

## Commit B — the five table pages

### T3 — Error surfacing in `menus` (prerequisite)

- [ ] **File:** `src/routes/admin/client/menus-editor.ts` — `:538` becomes
  `void refreshMenus().catch(reportFailure)`, adding a `reportFailure` in the shape
  `page-editor.ts` uses (localized message into the page's existing error surface, not a bare
  `console`). Without this, T6 converts a silent failure into a permanently stuck table.
- **Verify:** `npm test && npm run typecheck`.

### T4 — Error surfacing in `languages` (prerequisite)

- [ ] **File:** `src/routes/admin/client/languages-editor.ts` — same for `:354`.
- **Verify:** as above.

### T5 — Migrate `configs` and `redirects`

- [ ] **Files:** `src/routes/admin/configs.astro`, `redirects.astro` — delete the `loadConfigs` /
  `loadRedirects` import and call; replace the `tbody` map with the loading row (`colspan` **5** and
  **6**); empty the count span's server value (`configs.astro:62`, `redirects.astro:57`); make the
  empty-state `cms-hidden` unconditionally (`configs.astro:99` and its redirects twin).
- **Verify:** `npm test && npm run typecheck && npx biome ci .`

### T6 — Migrate `menus` and `languages`

- [ ] **Files:** `src/routes/admin/menus.astro`, `languages.astro` — same shape. `menus` `colspan`
  **4** and its count at `:55`; `languages` `colspan` **6** and **no count to clear** (finding 5).
  `menus.astro` also drops `loadLanguages` — check whether the content-locale selector needs it, and
  if so route it through the same client path rather than reinstating the loader.
- **Verify:** as above.

### T7 — Migrate `pages`

- [ ] **File:** `src/routes/admin/pages.astro` — delete `loadPages` + `loadLanguages`; loading row
  with `colspan` **6**; the count at `:61` interpolates **two** values, so both are cleared and the
  client fills both.
- [ ] **File:** `src/routes/admin/client/page-editor.ts` — delete the `:1069-1070` comment; its
  premise ("the table is SSR-rendered … so a failure here does not blank the screen") is exactly what
  this task removes. `reportFailure` is now the only path and stays.
- **Verify:** `npm test && npm run typecheck && npx biome ci .`

### T8 — Commit B

- [ ] `fix(admin): stop server-rendering the admin tables`

---

## Commit C — the dashboard

### T9 — Instrument the shell

- [ ] **File:** `src/routes/admin/index.astro` — delete `loadPages`, `loadMenus`, `loadLanguages`, the
  `uploadCount` IIFE (`:30-37`) and every derivation (`:23-46`). Keep the full markup and give each
  dynamic slot an id (`cms-dash-published`, `-drafts`, `-menus`, `-languages`, `-files`,
  `-recent-tbody`, `-last-updated`, …). Stat values render the loading affordance until filled.
- **Verify:** `npm run typecheck && npx biome ci .` — the page compiles with no data.

### T10 — `client/dashboard.ts`

- [ ] **File:** `src/routes/admin/client/dashboard.ts` — new, BSL header. `Promise.all` over
  `fetchJson` for `/cms/api/pages`, `/cms/api/menus`, `/cms/api/languages` plus
  `fetchMedia({ limit: 1 })` for the asset `total`. Port the derivations from the old frontmatter
  **unchanged** so the numbers cannot drift. Render through `ct()` (the 33 `dashboard.*` keys already
  exist) and the canonical escaper — this file holds an `innerHTML` sink, so ADR-0022 R3 applies.
  Failure surfaces an error, never a silent zero (finding 8).
- [ ] **File:** `src/routes/admin/index.astro` — add the module script importing it.
- **Verify:** `npm test && npm run typecheck && npx biome ci .` — `html-escape-guard` must stay green
  on the new client file.

### T11 — Commit C

- [ ] `fix(admin): render the dashboard from the API instead of the server`
  - Body notes the file count changing from a constant 0 to the real total — a fixed bug, not a
    regression.

---

## Commit D — the guard and the e2e

> **Order note.** The guard is written and run **first** (T12), where it must fail naming all six
> pages — that is the red step, and it is verified before any migration is trusted. It is committed
> here, once A–C have made it green, because a red test cannot land on `main`.

### T12 — The source guard

- [ ] **File:** `tests/admin-ssr-no-data-guard.test.js` — new, BSL header. Walks
  `src/routes/admin/*.astro` (discovered, never hardcoded), strips comments, fails on
  `/\bawait\s+load(?!Site\b)[A-Z]\w*\s*\(/`. One `test()` per file so the failure names the page. The
  header states the limit: it is lexical, and proves no page *calls* a loader — not that the HTML is
  clean. That is T13's job.
- **Verify:** `npm test` — green across all admin pages after A–C. Confirm it **bites** by
  reinstating one loader temporarily and seeing the named failure.

### T13 — The e2e sweep

- [ ] **File:** `e2e/admin-ssr-no-data.spec.ts` — new. Seed distinctive values (a page title, a config
  key, a redirect path, a language label), then `request.get` each of the twelve admin routes
  **unauthenticated** and assert none of those values appears. Assert on **values, not markup
  classes** — a class can be renamed; the value is the leak.
- [ ] Then, authenticated in a browser: each migrated page renders its rows, its count and its empty
  state, and the dashboard renders its counts, its recent activity and a **non-zero** file count.
  Without this half, "ships no data" is satisfiable by a broken page.
- [ ] Do **not** assert the routes answer 200 unauthenticated. That is the question this change
  deliberately leaves open (ADR-0037); encoding it would make the future cookie work delete an
  assertion that reads like a requirement.
- **Verify:** `npm run build:playground && npm run e2e` — green. **Port 4321 free**, and no stale
  `astro dev` daemon (#165).

### T14 — Commit D

- [ ] `test(admin): guard and prove that admin pages ship no content data`

---

## Close

### T15 — Docs

- [ ] **File:** `docs/CONTEXT.md` §3 — glossary row for the rule: an admin `.astro` may load
  `loadSite()` and nothing else; the data reaches the browser through the authenticated API. Link
  ADR-0037.
- [ ] **File:** `docs/CONTEXT.md` §7 (gotchas) — the reason a page-level auth guard is not expressible:
  the token lives in a header and `sessionStorage`, neither of which travels with a navigation. This
  is the trap that makes "just add a guard" look right.

### T16 — Full verification

- [ ] `npm run typecheck && npm test && npx biome ci .` — the four-check gate.
- [ ] `npm run features:validate`.
- [ ] `npm run build:playground && npm run e2e`.
- [ ] `grep -rn "await load" src/routes/admin/*.astro` → only `loadSite`.
- [ ] Confirm no incidental changes under `playgrounds/` or `data/`.

### Not in this change

- **Version bump / `CHANGELOG`** — only when you ask to close. This is a security fix with a
  user-visible rendering change on six pages; `patch` vs `minor` is a real call, not a formality.
- **The private advisory** — this change is what it will point at as the fix. Draft it before the
  release goes public, not after.
- **The session cookie and a navigation guard** — explicitly out (ADR-0037), with its own cycle.
- **#165** (the Astro dev daemon) will bite the e2e runs and the release screenshots until fixed.
