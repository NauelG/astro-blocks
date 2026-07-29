<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — The admin server-renders no content data

_Grilled 2026-07-28. Generalises ADR-0036 from one page to the whole panel. Impact assessment lives
in a private security advisory, per `SECURITY.md`; this document is the architectural record._

## Problem

Admin pages server-render their content into the initial HTML. `/cms/pages` emits every page's id,
title, slug, status and indexable flag; `/cms` (the dashboard) emits the counts plus the five most
recently updated pages; `/cms/configs`, `/cms/redirects`, `/cms/languages` and `/cms/menus` each emit
their full list.

That HTML is not gated. There is no middleware, and `routes/admin/layout.astro`'s frontmatter calls
neither `getAuth` nor `Astro.redirect` — the login form is a `cms-hidden` div that client JS reveals.

## Why a server-side guard is not the fix

The obvious reading is "add an auth check to the layout". It cannot work, and the reason decides the
whole change.

`getAuth` (`src/api/handlers/auth-core.ts:131-141`) accepts a token from the `Authorization` or
`x-cms-token` **header**. The client keeps it in `sessionStorage`. Neither travels with a page
navigation — a browser sends cookies, and the only cookie in play is `cms-ui-locale`.

**So the server has no credential to check on a page request.** The panel's auth is client-side
because the session transport leaves it no alternative. A guard added today would be a check with
nothing to check.

Making it work would mean issuing a session **cookie**, and that is not a small addition:
`src/api/handlers/media.ts` documents that CSRF is a non-issue for the API *precisely because* the
token is never ambient — "a cross-origin page cannot forge an authenticated request". Introducing an
ambient credential means re-deriving that reasoning across every mutating endpoint.

## The fix: remove the data, not add a gate

Generalise ADR-0036. **No admin page renders content data server-side.** The API already answers 401
without a valid token, and becomes the only source. There is nothing to leak because there is nothing
in the HTML.

This needs no new credential, no cookie and no new attack surface — the CSRF reasoning above stays
intact, untouched.

**And most of it is deletion, because the server-rendered data is already dead.** Every one of these
editors re-fetches unconditionally on load and replaces what the server sent:

| Page | Unconditional client re-fetch |
|---|---|
| `pages` | `client/page-editor.ts:1071` |
| `configs` | `client/configs-editor.ts:189` |
| `redirects` | `client/redirects-editor.ts` (`list.refresh()` at init) |
| `languages` | `client/languages-editor.ts:354` |

`page-editor.ts:1069-1070` even carries a comment leaning on it — *"The table is SSR-rendered by
pages.astro, so a failure here does not blank the screen"*. That fallback is the thing being removed,
and the change replaces it with an explicit loading state and the existing error report.

## Scope

Six pages, three tiers of work:

1. **Delete the SSR data** — `pages`, `configs`, `redirects`, `languages`. The client already owns
   first paint.
2. **Add the missing init re-fetch** — `menus`. `refreshMenus()` exists but runs only conditionally
   (`client/menus-editor.ts:366`) and after mutations; the page still relies on SSR for first paint.
3. **Write the client module** — `index` (the dashboard) has **no** client script at all. It composes
   four existing endpoints (`/cms/api/pages`, `/menus`, `/languages`, `/media`) and derives its
   counts. **No new API surface**: no route-table entry, no handler, no auth surface.

The other six admin routes (`media` — done in #104 — plus `settings`, `cache`, `users`,
`global-blocks`, `import-export`) load only `loadSite()`.

**`loadSite()` stays, deliberately.** `site.json` holds public branding only — site name, base URL,
favicon, logo, colours, default SEO title/description, i18n routing strategy — all of it already
rendered on the public site. Keeping it server-side preserves the panel's branded shell with no
unstyled flash, and `admin-html-rendering.md`'s S3 already treats the unauthenticated login screen
rendering `site` as expected behaviour.

## What this change does not close

The shell is still served with **200** to anyone: a stranger learns a CMS lives at `/cms` and sees the
login screen. That is not leaked data, and it is unchanged from today. Making `/cms` not exist for an
unauthenticated visitor requires the session cookie above, with its own cycle and its own ADR.

Stated here so nobody reads this change as more than it is.

## Loading state

Tables keep their `<thead>` and put a single `<td colspan>` row in the `tbody` carrying the loading
text. Column widths stay fixed, so no layout jump when the real rows arrive. The `role="status"` +
`aria-live="polite"` pattern and the muted styling come from #104's media shell, generalised rather
than duplicated.

## Riders

- **The dashboard's file count is wrong today.** `index.astro:30-37` counts files with `readdir` on
  the **root** of the uploads directory, but uploads live under `uploads/YYYY/MM/`, so it always
  reports **0**. Moving to `GET /cms/api/media`'s `total` fixes it as a side effect. Called out so the
  number changing is not read as a regression.

## Non-goals

- A session cookie and a server-side navigation guard (above).
- Any change to `getAuth`, the token contract, or the API's auth (ADR-0027 stands untouched).
- `layout.astro`'s script decomposition (#106) and the Biome `.astro` exclusion (#107).

## Acceptance criteria

- [ ] No admin `.astro` calls a `load*` other than `loadSite()`.
- [ ] An unauthenticated `GET` of each of the 12 admin routes returns HTML containing no content data.
- [ ] `pages`, `configs`, `redirects`, `languages`, `menus` and the dashboard render from the client;
      each shows a localized `role="status"` loading state until its data lands.
- [ ] `menus` re-fetches unconditionally at init.
- [ ] The dashboard composes existing endpoints; no new route, handler or auth surface.
- [ ] The dashboard's file count reports the real number of assets.
- [ ] A source guard fails CI if any admin `.astro` reintroduces a data `load*`.
- [ ] An e2e walks all 12 admin routes unauthenticated and asserts no data markers.
- [ ] `typecheck` + `test` + `biome ci` + `features:validate` + e2e green.
