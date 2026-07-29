<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — The admin server-renders no content data

Target: `docs/specs/admin-html-rendering.md`. Adds R7 and its enforcement, extends R3's framing, and
adds two scenarios. Nothing is removed: R1–R6 stand exactly as written — this delta is about **what
data reaches the page**, not about how a value is encoded once it is there.

---

## ADDED: R7 — An admin page ships no content data

> **R7 — An admin `.astro` may load `loadSite()` and nothing else.** No page server-renders content
> data: not rows, not the counts derived from them, not an empty state whose visibility encodes
> whether the collection is populated. The panel's data reaches the browser through
> `/cms/api/*`, which authenticates every request, and through no other path.
>
> `loadSite()` is the sole exception and a deliberate one: `site.json` holds public branding — site
> name, base URL, favicon, logo, colours, default SEO title/description, i18n routing strategy — all
> of it already rendered on the public site. Keeping it server-side is what lets the panel's shell
> paint branded, and S3 already assumes the unauthenticated login screen renders it.
>
> **Why this rule is about the data and not a guard.** `getAuth` reads its token from the
> `Authorization` / `x-cms-token` **header**, and the client holds it in `sessionStorage`. Neither
> travels with a page navigation, so the server has no credential to check when a browser asks for an
> admin page. A page-level auth guard is not merely absent — it is not expressible without first
> issuing a session cookie, which would forfeit the header-only property the API's CSRF posture rests
> on. The rule therefore removes the data rather than gating it. (ADR-0037)
>
> Consequence, stated so the rule is not read as more than it is: an admin route still answers **200**
> with its shell to an unauthenticated caller. That is a login screen, not content.

## ADDED: R7.1 — The rule is enforced statically

> **R7.1 — `tests/admin-ssr-no-data-guard.test.js` walks `src/routes/admin/*.astro`** — discovering
> its scope, never hardcoding a list — and fails CI on any `await load…(` that is not `loadSite`. A
> page added later is covered the day it is added, without anyone remembering to extend a test.
>
> The guard is **lexical**, and its limit is part of the requirement: it proves no page *calls* a
> loader, not that the emitted HTML is clean. Behavioural coverage is R7.2. This is the same division
> of labour R4 and R5 already draw for escaping.

## ADDED: R7.2 — The absence is asserted behaviourally

> **R7.2 — An end-to-end test requests all twelve admin routes unauthenticated and asserts the HTML
> contains none of the seeded content values.** It asserts on *values*, not markup classes: a class
> can be renamed, whereas the value is the leak. It also asserts each page still renders its data once
> authenticated, so "ships no data" cannot be satisfied by a broken page.

---

## MODIFIED: R3 — say what else belongs in `client/`

R3 places dynamic *rendering* in `client/**/*.ts`. It now also names the data: the `.astro` file is a
bootstrap that ships markup and `loadSite()` branding, and the content it renders arrives from the API
inside those client modules (R7). The escaping rules are untouched — R7 narrows what a page holds; it
changes nothing about how a held value must be encoded.

---

## Scenarios

- **S5 — An unauthenticated reader.** A visitor with no session requests `/cms/pages`. The response is
  **200** and carries the panel shell, the site branding and a loading row — and no page title, slug,
  status or count. The same holds for the other eleven admin routes.
- **S6 — A new admin page.** A page added with `const rows = await loadRedirects()` in its frontmatter
  fails CI on R7.1 before it can ship, naming the loader and the reason.
