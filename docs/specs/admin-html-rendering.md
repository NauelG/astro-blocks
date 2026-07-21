<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Admin HTML rendering & escaping

> Living specification. Describes how the admin panel renders API-sourced data into the DOM and how
> that rendering is kept safe. Changed via the cycle's `spec-delta.md` mechanism (see `AGENTS.md`).
> History: inaugurated by change `enforce-admin-html-escaping` (#99); R3 widened to client
> subdirectories by change `decompose-block-form` (#38).

## Capability

The admin panel renders API-sourced data (language codes/labels, user emails/ids, site name, …) into
the DOM. This spec governs **where** that rendering may live and **how** untrusted values must be
encoded so the panel cannot be turned into a stored-XSS vector.

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
  script publishing `window.__cmsXI18n`, plus a module script importing `./client/x.js`.
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

## Related

- ADR-0011 (which escaper exists) · ADR-0022 (how its use is enforced) · ADR-0013 (Biome CI gate and
  its `.astro` blind spot).
- Out of scope, tracked separately: input validation of `users.email` / `languages.label` (#108);
  extraction of `layout.astro` rendering into `client/layout.ts` (#106); Biome over `.astro` (#107).
