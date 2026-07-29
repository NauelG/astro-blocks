<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — The admin server-renders no content data

The rule, stated once: **an admin `.astro` may call `loadSite()` and nothing else.** Everything below
follows from it.

## 1. What "no data" actually means

Rows are the obvious part and not the whole of it. Three things in a table page derive from the data,
and all three must go:

| Derived from data | Example | Becomes |
|---|---|---|
| The rows | `{configs.map(...)}` in `tbody` | a loading row |
| The count | `configs.astro:62` — `t('configs.count', { count: configs.length })` | empty; the client fills it |
| The empty state's visibility | `configs.astro:99` — `configs.length > 0 && 'cms-hidden'` | always `cms-hidden`; the client decides |

Miss the second and the page still tells an unauthenticated caller how many configs exist. The count
is a smaller leak than the rows, not a different kind.

## 2. The loading row

```astro
<tbody id="cms-configs-tbody">
  <tr class="cms-table-loading-row">
    <td colspan="5" role="status" aria-live="polite">{t('common.loading')}</td>
  </tr>
</tbody>
```

`colspan` matches each page's real column count — **pages 6, configs 5, redirects 6, languages 6,
menus 4** (counted from each `<thead>`, action columns included). It is not uniform, so it is set per
page and asserted rather than assumed.

The `<thead>` stays, which is the point: column widths are established before the rows arrive, so
there is no reflow when they do. The media shell (#104) could drop straight to a `<p>` because a grid
has no header to preserve; a table does.

**CSS.** `.cms-media-loading` from #104 is generalised rather than copied:

```css
/* The panel's one loading affordance: a muted, centred line where content will appear.
   No skeleton and no animation — the admin has no such pattern, and a fix is the wrong
   place to introduce one (ADR-0036). */
.cms-loading-state {
  padding: 3rem 1.5rem;
  text-align: center;
}
.cms-table-loading-row td {
  padding: 3rem 1.5rem;
  text-align: center;
  color: var(--cms-text-muted);
}
```

`media.astro` switches from `.cms-media-loading` to `.cms-loading-state`; the old class is deleted, so
there is one loading style, not two.

**i18n.** One shared key rather than six per-page ones — the string is identical and the panel already
has `common.*`:

| key | `en.ts` | `es.ts` |
|---|---|---|
| `common.loading` | `Loading…` | `Cargando…` |

`media.loading` (added in #104) stays as-is: it names what is loading ("Loading assets…"), which reads
better on a page that is nothing but a library.

## 3. Per page

**Tier 1 — delete only.** `pages`, `configs`, `redirects`, `languages`. Remove the `load*` call, the
row map, the count value and the empty-state condition. Each client editor already re-fetches
unconditionally at init, so nothing else changes. In `page-editor.ts` the comment at `:1069-1070`
("the table is SSR-rendered … so a failure here does not blank the screen") is deleted with its
premise; `reportFailure` already surfaces the error, which is now the only path.

**Tier 2 — `menus`.** `refreshMenus()` (`client/menus-editor.ts:417`) exists but is called only at
`:366` behind `if (menusState.length === 0)` and after mutations. Add an unconditional
`void refreshMenus().catch(reportFailure)` at the end of init, matching `page-editor.ts:1071`, and
remove the SSR rows.

**Tier 3 — the dashboard.** `index.astro` has no client script. It becomes a shell plus a new
`client/dashboard.ts`:

```ts
const [pages, menus, languages, media] = await Promise.all([
  fetchJson<PagesData>('/cms/api/pages'),
  fetchJson<MenusData>('/cms/api/menus'),
  fetchJson<LanguagesData>('/cms/api/languages'),
  fetchMedia({ limit: 1 }), // only `total` is needed
]);
```

Four existing endpoints, all already 401-gated. **No new route, handler or auth surface.** The counts
(published, drafts, indexable, menus, enabled languages) and the five most recently updated pages are
derived client-side from those responses — the same derivations `index.astro:23-46` does today, moved
across unchanged so the numbers cannot drift.

`fetchMedia({ limit: 1 })` asks for one entry and reads the envelope's `total` — the count without the
payload. That is the ADR-0036 contract being used as intended.

The dashboard's 33 `dashboard.*` i18n keys already exist and are reached with `ct()`, so the new module
needs no catalog work.

### The file count changes, and that is the fix

`index.astro:30-37` counts files with `readdir` on the **root** of the uploads directory and filters
`isFile()`. Uploads live under `uploads/YYYY/MM/`, so the root holds only directories and the count is
always **0**. `media.total` is the real number of registered assets. The dashboard will start showing
a non-zero figure; that is a bug being fixed, not a behaviour change.

## 4. The guard

`tests/admin-ssr-no-data-guard.test.js`, modelled on `tests/html-escape-guard.test.js` — it discovers
its own scope by walking `src/routes/admin/*.astro` rather than hardcoding a list, so a **new** page
is covered the day it is added:

```js
// Every data loader the admin must not call from a page. loadSite is the sole exception:
// site.json is public branding, already rendered on the public site.
const FORBIDDEN = /\bawait\s+load(?!Site\b)[A-Z]\w*\s*\(/;
```

For each file, strip comments, then fail if the pattern matches. The failure message names the file,
the loader, and why: the data belongs behind the API, which authenticates; the page does not.

**What the guard cannot do**, stated in its header so nobody over-trusts it: it is lexical. It proves
no page *calls a loader*; it does not prove the emitted HTML is clean. A page that obtained data some
other way would pass. That is what the e2e is for — the same division of labour ADR-0022 already uses
between its static guard (R1–R4) and its behavioural coverage (R5).

## 5. The e2e

One test walking all 12 injected admin routes with an **unauthenticated** `request.get`, asserting the
HTML carries no content data. Seeded first with data whose markers are distinctive, so an assertion
cannot pass against an empty instance:

```
/cms  /cms/media  /cms/global-blocks  /cms/pages  /cms/redirects  /cms/configs
/cms/settings  /cms/cache  /cms/menus  /cms/languages  /cms/users  /cms/import-export
```

Assert the absence of the seeded values (a page title, a config key, a redirect path, a language
label), not of markup classes — markup can be renamed, the leak is the *value*. Then assert each page
still renders its data once authenticated in a browser, so "no data" is not achieved by breaking the
page.

The test asserts **only** the absence of data. It deliberately does not encode the fact that these
routes answer 200 unauthenticated: that is the open question this change explicitly does not settle,
and baking it into a test would make the future cookie work delete an assertion that looks like a
requirement.

## 6. Test plan

| Layer | Covers |
|---|---|
| `tests/admin-ssr-no-data-guard.test.js` | No admin `.astro` calls a non-`loadSite` loader — including pages added later |
| e2e, unauthenticated | The 12 routes emit no seeded value |
| e2e, authenticated | Each migrated page still renders its rows, count and empty state |
| e2e, dashboard | Counts and recent activity render, and the file count is non-zero with assets present |

The last row is the one that would catch the dashboard silently rendering zeroes because a fetch
failed — the failure mode that `fetchMedia`'s safe-default return already produced once, in the
screenshot scripts.
