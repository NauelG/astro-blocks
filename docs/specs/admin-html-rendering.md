<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Admin HTML rendering & escaping

> Living specification. Describes how the admin panel renders API-sourced data into the DOM and how
> that rendering is kept safe. Changed via the cycle's `spec-delta.md` mechanism (see `AGENTS.md`).
> History: inaugurated by change `enforce-admin-html-escaping` (#99); R3 widened to client
> subdirectories by change `decompose-block-form` (#38); R7 (pages ship no content data) added by
> change `admin-ssr-ships-no-data`.

## Capability

The admin panel renders API-sourced data (language codes/labels, user emails/ids, site name, …) into
the DOM. This spec governs **what data may reach a page at all**, **where** that rendering may live,
and **how** untrusted values must be encoded so the panel cannot be turned into a stored-XSS vector.

## Requirements

- **R1 — One escaper.** `src/utils/html-escape.ts` exports the only HTML-escaping pair in the
  codebase: `escapeHtml(text)` for element text content, `escapeAttr(value)` for attribute values
  (ADR-0011). No other escaper may be defined anywhere.

- **R2 — Every API-sourced value is escaped at the sink.** Any value originating from the CMS API
  that reaches an HTML sink — `innerHTML`, `outerHTML`, `insertAdjacentHTML` — passes through the
  canonical pair, chosen by its actual HTML context: text content → `escapeHtml`, attribute value →
  `escapeAttr`.

- **R3 — Rendering lives in `client/**/*.ts`.** No admin `.astro` file writes a **dynamic** HTML sink;
  it may assign only a static literal. Dynamic rendering belongs in `src/routes/admin/client/`
  modules — including subdirectories such as `client/block-form/` — which Biome lints and the escape
  guard walks recursively. The `.astro` file is a bootstrap: a `define:vars`
  script publishing `window.__cmsXI18n`, plus a module script importing `./client/x.js`. R7 names
  what else belongs there: the **data** as well as the rendering. R7 narrows what a page holds; it
  changes nothing about how a held value must be encoded.
  - **Time-boxed exception:** `src/routes/admin/layout.astro` still hosts rendering logic in bundled
    `<script>` modules. It is exempt from R3 and **not** from R2 — its sinks are escaped. The
    exception is registered in the guard's allowlist and is removed when **#106** lands.

- **R4 — The rules are enforced statically, repo-wide.** `tests/html-escape-guard.test.js` walks
  `src/routes/admin/**` (`*.ts` and `*.astro` — discovered, never hardcoded) and fails CI on:
  1. `escapeHtml` used in an attribute-value position (`="${escapeHtml(`);
  2. a dynamic HTML sink in an `.astro` file outside the allowlist;
  3. a file with a dynamic HTML sink that does not use the canonical escaper.

  The guard is a hand-rolled source scanner **on purpose**: `biome.json` excludes `**/*.astro`, so no
  linter sees this code (ADR-0013, ADR-0022).

- **R5 — Static enforcement does not cover partial escaping.** R4 cannot detect a renderer that
  escapes three fields of four. That case is covered behaviorally by `e2e/admin-xss.spec.ts`, which
  plants an XSS payload through the real API into `languages.label` and `users.email` and asserts, in
  a real browser, that (a) no script executes and (b) the payload renders as literal text — on
  `/cms/languages`, `/cms/users`, and one unrelated admin page (the layout's content-locale selector
  renders language data on **every** page).

  Where a renderer adopts the R6 cell model, that partial-escaping gap is closed at compile time and
  the behavioural coverage becomes a backstop rather than the only guard. Hand-written renderers that
  do not use the cell model remain covered only behaviourally — R5 still holds for them.

- **R6 — A typed cell model makes the escaped path the only path.** The shared list renderer
  (`renderRows` in `client/list-editor.ts`, driven by `createListEditor`) accepts columns whose cells
  are typed descriptors — `{ text }` → `escapeHtml`, `{ attr }` → `escapeAttr`, `{ html: RawHtml }` →
  verbatim — and `RawHtml` is a branded type produced **only** by `raw(trusted: string)`. Passing a
  bare `string` where markup is expected is a compile error. For any editor built on this renderer,
  partial escaping (R5's gap) is therefore impossible by construction: the only unescaped path is
  `raw()`, a named, greppable, small and audited surface (the two row-action icons, and badges whose
  dynamic text is escaped *inside* the `raw(...)`).

  `renderRows` is a **pure function** (no `document`, no `fetch`) with a `node:test`, so an XSS
  payload in a cell's text renders escaped under `node --test` — not only in a browser. It lives in
  the **same file as the `.innerHTML` sink it feeds**: R4's guard verifies escaping by lexically
  scanning the file that holds the sink, so the renderer and the sink must be co-located, and the sink
  stays a visible `.innerHTML =` (never a `set:html` the guard cannot see — media-tile.ts, ADR-0035).
  `RawHtml` is defense **on top of** the guard, not a replacement — the guard cannot tell escaped HTML
  from raw (it rejected a no-concat rule for that reason), so the type layer is what makes the escaped
  path the only path. Applies today to the two editors on the renderer (`configs`, `redirects`); it is
  the landing pad the rest adopt as they migrate.

- **R7 — An admin page ships no content data.** An admin `.astro` may load `loadSite()` and nothing
  else. No page server-renders content data: not rows, not the counts derived from them, not an empty
  state whose visibility encodes whether the collection is populated. The panel's data reaches the
  browser through `/cms/api/*`, which authenticates every request, and through no other path.

  `loadSite()` is the sole exception and a deliberate one: `site.json` holds public branding — site
  name, base URL, favicon, logo, colours, default SEO title/description, i18n routing strategy — all
  already rendered on the public site. Keeping it server-side is what lets the shell paint branded,
  and S3 already assumes the unauthenticated login screen renders it.

  **Why this is a rule about data and not a guard.** `getAuth` reads its token from the
  `Authorization` / `x-cms-token` **header**, and the client holds it in `sessionStorage`. Neither
  travels with a page navigation, so the server has no credential to check when a browser asks for an
  admin page. A page-level auth guard is not merely absent — it is not expressible without first
  issuing a session cookie, which would forfeit the header-only property the API's CSRF posture rests
  on. The rule therefore removes the data rather than gating it. (ADR-0037)

  Consequence, stated so the rule is not read as more than it is: an admin route still answers **200**
  with its shell to an unauthenticated caller. That is a login screen, not content.

- **R7.1 — The rule is enforced statically.** `tests/admin-ssr-no-data-guard.test.js` walks
  `src/routes/admin/*.astro` — discovering its scope, never hardcoding a list — and fails CI on any
  `await load…(` that is not `loadSite`. A page added later is covered the day it is added, without
  anyone remembering to extend a test.

  The guard is **lexical**, and its limit is part of the requirement: it proves no page *calls* a
  loader, not that the emitted HTML is clean. Behavioural coverage is R7.2 — the same division of
  labour R4 and R5 already draw for escaping.

- **R7.2 — The absence is asserted behaviourally.** `e2e/admin-ssr-no-data.spec.ts` requests all
  twelve admin routes unauthenticated and asserts the HTML contains none of the seeded content
  values. It asserts on **values, not markup classes**: a class can be renamed, whereas the value is
  the leak. It also asserts each page still renders its data once authenticated, so "ships no data"
  cannot be satisfied by a broken page.

---

## Scenarios

- **S1 — Malicious language label.** An owner creates a language with
  `label = '"><img src=x onerror=…>'`. Opening `/cms/languages` renders the label as literal text; no
  script executes. Opening any *other* admin page renders it as literal text inside the content-locale
  `<option>`; no script executes, and the `value` attribute does not break out.

- **S2 — Malicious user email.** An owner creates a user with `email = '"><img src=x onerror=…>'`.
  Opening `/cms/users` renders it as literal text in the cell and as an escaped `data-id` /
  `aria-label` / `title`; no script executes.

- **S3 — Malicious site name (pre-auth).** A `site.name` carrying a payload renders as literal text on
  the unauthenticated login screen; no script executes.

- **S4 — A new admin page.** A page added with a `<script define:vars>` that builds `innerHTML` from
  API data fails CI on R4.2 and R4.3 before it can ship.

- **S5 — An unauthenticated reader.** A visitor with no session requests `/cms/pages`. The response is
  **200** and carries the panel shell, the site branding and a loading row — and no page title, slug,
  status or count. The same holds for the other eleven admin routes.

- **S6 — A new admin page, data edition.** A page added with `const rows = await loadRedirects()` in
  its frontmatter fails CI on R7.1 before it can ship, naming the loader and the reason.

## Related

- ADR-0011 (which escaper exists) · ADR-0022 (how its use is enforced) · ADR-0013 (Biome CI gate and
  its `.astro` blind spot) · ADR-0037 (why a page ships no data, and why a guard is not expressible)
  · ADR-0036 (the same principle, first applied to the media listing).
- Out of scope, tracked separately: input validation of `users.email` / `languages.label` (#108);
  extraction of `layout.astro` rendering into `client/layout.ts` (#106); Biome over `.astro` (#107).
