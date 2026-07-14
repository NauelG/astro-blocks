<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Enforce the canonical HTML escaper across the whole admin

Companion to `proposal.md`. Three parts: the **guard** (the deliverable), the **migration**
(what makes the guard satisfiable), and the **exploit test** (what proves any of it works).

---

## 1. The guard — `tests/html-escape-guard.test.js`

Replaces `tests/html-escape-attr-guard.test.js`, whose coverage it absorbs. Discovery is by
**directory walk** over `src/routes/admin/**` for `*.ts` and `*.astro`. No hardcoded file list:
the hardcoded list in the old guard is the mechanism by which this hole stayed open.

### Scanning strategy — why a lexer, not a regex

A pure regex over this code is unsound, and we proved it before committing to the design.
The admin client mixes quoting styles inside a single expression:

```ts
'</div>' + `<div class="cms-menu-card-body${isOpen ? '' : ' cms-hidden'}">`
```

The single quotes **inside** the template literal make any quote-counting regex hallucinate string
boundaries that do not exist. The scanner therefore does a minimal lex first:

1. **Strip comments** (`//…`, `/*…*/`).
2. For `.astro`, **extract only the `<script>` blocks**. The Astro template is HTML, not JS — running
   a JS string lexer over prose (`don't`) would corrupt it. The frontmatter is server-side and writes
   no DOM sinks.
3. **Mask string contents**: walk the source tracking `'`, `"`, `` ` `` and `${…}` nesting, replacing
   every literal's *contents* with a placeholder while preserving the delimiters and the surrounding
   code structure. The masked text is what the structural rules read; the raw text is what R1 reads.

A **sink write** is `.innerHTML =`, `.innerHTML +=`, `.outerHTML =` or `.insertAdjacentHTML(`.
A sink write is **static** iff, in the masked text, its right-hand side (up to the statement-ending
`;` — reliable now that `;` cannot hide inside a string) is a single string placeholder and nothing
else. Anything else — an interpolation, a concatenation, a call, an identifier — is **dynamic**.

### R1 — the right escaper in attribute position *(carried over, unchanged)*

Fails on `="${escapeHtml(` or `='${escapeHtml(` in the **raw** text. `escapeHtml` over-escapes quotes
so it is in fact safe here today, but the two names exist to carry intent (see ADR-0011) and the
guard is what keeps the names honest.

Applied to: every admin `.ts` and `.astro`. *(Previously: six hardcoded `client/*.ts`.)*

### R2 — no admin `.astro` writes a **dynamic** HTML sink

An `.astro` file may assign a static literal to `innerHTML`; it may not build one. Rationale: the
`.astro` files are the one place in the repo Biome cannot see (ADR-0013), and `define:vars` forces
`is:inline`, severing the file from the module system and therefore from the canonical escaper. HTML
rendering belongs in `client/*.ts`, where the linter, the type-checker and the tests can reach it.

**Allowlist — exactly one entry, with an expiry date:**

```js
// layout.astro still hosts ~600 lines of rendering logic in bundled <script> blocks.
// Its sinks ARE escaped (they can import the canonical pair — they are modules, not is:inline),
// but the code has not moved to client/ yet. DELETE THIS ENTRY when #106 lands.
const R2_ALLOWLIST = ['src/routes/admin/layout.astro'];
```

The allowlist exempts `layout.astro` from **R2 only**. R3 still binds it — so its sinks must still
use the canonical escaper. The exception is about *where the code lives*, never about *whether it is
safe*.

### R3 — a file with a dynamic HTML sink **must** use the canonical escaper

Any admin file (`.ts` or `.astro`) containing a dynamic sink write must import from
`utils/html-escape` and reference `escapeHtml` / `escapeAttr`. This is the rule that catches the bug
of #99: *no escaper at all*.

**Validated against the current tree:** all 25 dynamic sinks across six `client/*.ts` files sit in
files that already import the canonical pair. The **only** violations repo-wide are the three files
this change fixes. Zero false positives.

### The rule we discarded, and why it matters that we say so

A candidate R4 — *"HTML must never be built by string concatenation"* — was designed, implemented and
**thrown away**, because the tree falsifies it: `block-form.ts:1143` writes
`'</div>' + errorHtml + '</li>'`. That concatenates a non-literal into HTML and is completely safe —
`errorHtml` is already-escaped HTML. Statically, `errorHtml` and `language.code` are indistinguishable.
The rule would have fired on 15 safe sites. A guard that cries wolf is worse than no guard: it teaches
the team to skip past it.

### The blind spot, stated out loud

**No static rule here catches partial escaping.** Escape three fields of four and R1, R2 and R3 all
pass green. Nothing cheap and static catches that. That is precisely why §3 exists, and why it is not
optional.

---

## 2. The migration

### `languages.astro` → `client/languages-editor.ts`, `users.astro` → `client/users-editor.ts`

The two-script i18n bridge, already documented at `import-export.astro:175-185`:

```astro
<script define:vars={{ languagesI18n }}>
  window.__cmsLanguagesI18n = languagesI18n;
</script>
<script>
  import { initLanguagesEditor } from './client/languages-editor.js';
  initLanguagesEditor();
</script>
```

`define:vars` stays where it belongs — a bridge that publishes scalars and nothing more. All logic
(state, fetch, modal, render, delete) moves to the module, in TypeScript, typed, linted, and within
reach of `escapeHtml` / `escapeAttr`. Naming follows the `*-editor.ts` convention of the other CRUD
pages. `tests/admin-define-vars-bridge.test.js` (the empty-bridge guard) keeps passing: the
`define:vars` script still has a body.

Behavior is preserved verbatim; the `<script>` blocks become a bootstrap and nothing else.

### The five sinks

| Sink | Fix |
|---|---|
| `languages-editor.ts` rows | `escapeHtml(code/label)` in cells; `escapeAttr(code)` in `data-code`; `escapeAttr` on `aria-label` |
| `users-editor.ts` rows | `escapeHtml(email)` in cells; `escapeAttr(id)` in `data-id`; `escapeAttr` on `aria-label` / `title` |
| `layout.astro:624` | `escapeAttr(entry.code)` in `value="…"`, `escapeHtml(entry.label ?? entry.code)` in the option's text |
| `layout.astro:376` | `escapeHtml(siteName)` — and the concatenation becomes a template literal |
| `layout.astro:941` | `escapeHtml(options.title ?? toastNotice)` |

`layout.astro`'s three `<script>` blocks are **bundled modules**, not `is:inline` — they can
`import { escapeHtml, escapeAttr } from '../../utils/html-escape.js'` today. No refactor needed here;
that is #106.

---

## 3. The exploit test — `e2e/admin-xss.spec.ts`

A guard proves the rule was followed. Only this proves the rule saves you.

**Red first, against `main`.** If this spec does not fail before the fix lands, it is testing nothing
and must be repaired before proceeding. A security fix without a reproduced exploit is faith, not
engineering.

Setup, reusing the suite's existing shape (`e2e/fixtures/coverage`, the `login()` helper, the clean
`.e2e-data` store from `global-setup.ts`):

1. Log in as owner through the UI; read the bearer token out of `sessionStorage`.
2. Plant both payloads **through the real API** — no fixture shortcut, because the point is that the
   normal write path accepts them (`languages.ts:56` trims `label`; `users.ts:35` only lowercases
   `email`):
   - `POST /cms/api/languages` → `{ code: 'xx', label: '"><img src=x onerror="window.__xss=1">' }`
   - `POST /cms/api/users` → `{ email: '"><img src=x onerror="window.__xss=1">', … }`
3. Visit `/cms/languages`, `/cms/users`, and one unrelated page (`/cms/pages`) — the third covers
   sink 3, since the layout paints the content-locale selector everywhere.
4. Assert, on each page:
   - `window.__xss` is `undefined` — nothing executed;
   - the cell's `textContent` equals the payload **verbatim** — it rendered as text, which is the
     positive half of the assertion. Asserting only "no execution" would also pass if the row simply
     vanished.
5. A `page.on('dialog')` trap fails the test on any dialog, in case a variant payload gets added later.

Note the lowercase payload: `email` is lowercased on write, so an uppercase `onError` would be a test
that passes for the wrong reason.

---

## 4. Docs

- **ADR-0022** — the enforcement decision. Complements ADR-0011 (*which* escaper) with *how it is
  guaranteed to be used*, and records the two tool constraints (`biome.json`'s `!**/*.astro`;
  `define:vars` ⇒ `is:inline`) that make a hand-rolled guard test necessary rather than redundant.
  Without that record, the next maintainer deletes the test as duplicated linter work.
- **`docs/CONTEXT.md`** — the convention (admin HTML rendering lives in `client/*.ts`; every
  API-sourced value passes the canonical pair) and the glossary terms **HTML sink**, **canonical
  escaper**, **i18n bridge**.
- `src/utils/html-escape.ts:9` currently claims to be canonical "for the whole codebase." After this
  change, that claim is finally **earned** — and enforced. ADR-0011's compliance note gets a closing
  line pointing at this change.
