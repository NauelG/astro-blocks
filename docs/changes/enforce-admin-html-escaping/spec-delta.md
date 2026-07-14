<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Enforce the canonical HTML escaper across the whole admin

Applied at Archive onto `docs/specs/`. Creates one new living spec:
**`docs/specs/admin-html-rendering.md`**.

---

## ADDED: Admin HTML rendering & escaping

The admin panel renders API-sourced data into the DOM. This capability specifies **where** that
rendering may live and **how** untrusted values must be encoded.

### Requirements

- **R1 — One escaper.** `src/utils/html-escape.ts` exports the only HTML-escaping pair in the
  codebase: `escapeHtml(text)` for element text content, `escapeAttr(value)` for attribute values
  (ADR-0011). No other escaper may be defined anywhere.

- **R2 — Every API-sourced value is escaped at the sink.** Any value originating from the CMS API
  (`language.code`, `language.label`, `user.email`, `user.id`, `site.name`, …) that reaches an HTML
  sink — `innerHTML`, `outerHTML`, `insertAdjacentHTML` — passes through the canonical pair, chosen
  by its actual HTML context: text content → `escapeHtml`, attribute value → `escapeAttr`.

- **R3 — Rendering lives in `client/*.ts`.** No admin `.astro` file writes a **dynamic** HTML sink;
  it may assign only a static literal. Dynamic rendering belongs in `src/routes/admin/client/*.ts`,
  which Biome lints and the test suite can reach. The `.astro` file is a bootstrap: a `define:vars`
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

### Scenarios

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
  API data fails CI on R4.2 and R4.3 before it can ship. This is the regression the change exists to
  prevent.

### Out of scope (tracked separately)

- Input validation of `users.email` / `languages.label` at the API boundary → **#108**. Output
  encoding at the sink is the fix for XSS; input validation is defense in depth and a distinct
  concern.
- Extraction of `layout.astro`'s rendering into `client/layout.ts` → **#106**.
- Biome coverage of `.astro` → **#107**.
