<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — The select menu escapes its clipping ancestor

One vertical slice. There is no failing assertion to write: the defect is visual, so the "red" is a
**screenshot of the bug** taken before touching anything, and the "green" is the same shot afterwards.

> **Nothing here is caught by a gate.** `cms-admin.css` is not linted (#95) and `.astro` files are
> excluded from Biome (#107, #66), so neither file in this change is covered. `npm test` never
> renders the admin. The e2e suite drives these pages but asserts behaviour, not geometry — it passed
> throughout the Astro 7 whitespace regression. Treat a green run as "nothing else broke", never as
> "the fix works". Only the screenshots say that.

## T1 — Capture the defect (red)

- [x] Write a throwaway Playwright spec in the scratchpad (not `e2e/`, it is not shipped): log in,
  open `/cms/redirects`, open a redirect for editing, click the status-code select, screenshot the
  dialog. Repeat for the user edit modal on `/cms/users`.
- [x] Confirm the shots show what #138 reports: panel clipped inside the modal body, scrollbar
  present, dialog taller than its content.
- **Verify:** the "before" images exist and are unambiguous. If the defect does not reproduce, stop —
  the diagnosis is wrong and the rest of this plan is built on it.

## T2 — CSS (`src/styles/cms-admin.css:847`)

- [x] `.cms-select-menu`: `position: absolute` → `position: fixed`; drop `top: calc(100% + 0.28rem)`,
  `left: 0`, `right: 0` — all three are now set by JS.
- [x] Keep `max-height: 14rem` and every visual property (background, border, radius, shadow,
  z-index) exactly as they are. This task changes geometry, not appearance.
- [x] Add the comment from `design.md` §1: why `fixed` and not `absolute`, and that the geometry now
  comes from `openMenu`. Without it the bare `position: fixed` reads like a mistake.
- [x] `.cms-select` keeps `position: relative`.
- **Verify:** the panel is no longer clipped, and is now mispositioned (top-left of the viewport) —
  expected, T3 supplies the coordinates. This intermediate state is the proof that the clipping and
  the positioning are two separate concerns.

## T3 — Positioning (`src/routes/admin/layout.astro`)

- [x] Add `positionMenu(entry)` from `design.md` §2 and call it from `openMenu` **after** the shell
  gets `cms-select--open` — `offsetHeight` is meaningless on a panel that is not laid out yet.
- [x] `left` and `width` come from the trigger's rect, replacing what `left: 0; right: 0` used to do.
- [x] Flip up **only** when the panel does not fit below **and** there is more room above. A panel
  near the middle of the viewport must not flip.
- [x] Clamp the flipped `top` to at least the gap, so a panel taller than the space above does not
  start off-screen.
- [x] Do **not** touch `closeOpenIfOutside`, the scroll/resize handlers, `renderOptions`, the
  keyboard handling or any `aria-*`. The whole point of staying in the DOM is that none of them need
  to change; editing them would mean the approach is not working.
- **Verify:** panel appears directly under its trigger at the trigger's width, in the modals and in
  the topbar.

## T4 — The rule (`docs/DESIGN.md`)

- [x] Add the *Paneles flotantes* rule from `spec-delta.md`: `fixed` + JS geometry, never `absolute`;
  do not portal, with the `<dialog>` / `showModal()` / inert reasoning; flip up when it does not fit.
- [x] Reference ADR-0031 for the full argument. The rule states what to do; the ADR states why the
  obvious alternative is wrong.
- **Verify:** a reader who has never seen #138 can tell from `DESIGN.md` alone why portaling is not
  the answer here.

## T5 — Visual verification

- [x] Re-run the T1 script. Compare against the "before" shots:
  - **Redirects modal** — panel fully visible over the modal, not clipped; **no scrollbar**, dialog
    not taller.
  - **User edit modal** — same; the reported symptom is gone.
  - **Near the viewport bottom** — a low select flips above its trigger instead of running
    off-screen.
  - **Topbar selects** — visually identical to before. These were never clipped; a change here means
    the fix has side effects.
- [x] Manual interaction pass: click outside closes · `Escape` closes · scrolling the modal body
  closes · selecting an option still updates the native `<select>` and the trigger label.
- [x] `npm run build && npm test && npm run typecheck` — regression floor.
- [x] `npm run build:playground && npm run e2e` — 11/11. Rebuild first; `npm run e2e` does **not**
  rebuild the playground and will otherwise test a stale `dist`.
- [x] Delete the throwaway spec; revert any `playgrounds/basic/data/` churn the runs caused.

## T6 — Commit

- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `fix(admin): position the select menu with fixed so it escapes modal clipping`
- Body: the box-model cause (absolute is clipped by the overflow ancestor and adds scrollable
  height), and why the issue's own recommendation — portal to `document.body` — is wrong rather than
  merely expensive, given `showModal()` renders in the top layer and makes everything outside inert.
  Note that staying in the DOM preserves dismissal, tab order and focus containment for free, and
  that scroll/resize already close the menu so no reposition loop is needed. Reference #138,
  ADR-0031.
- No version bump, no `CHANGELOG` entry — those happen only when the human asks to close
  (`AGENTS.md` *Versionado*). At close this is a `patch` with a `### Fixed` entry.
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.

## Execution notes (2026-07-20)

**T1 reproduced the defect** — the "before" shot shows the panel cut off exactly at the modal body's
edge, with `302 (Temporary)` sliced horizontally.

**Two measurement mistakes were mine, not the product's.** The first probe read
`document.querySelector('.cms-select-menu')`, which matches the **first** menu in the DOM — a topbar
select, not the one in the modal. It reported a panel at y=90 and nearly sent me chasing a phantom.
Scoping it to `.cms-select--open .cms-select-menu` (and asserting `openCount === 1`) fixed the
instrument. Screenshots alone would not have caught this: the two shots looked almost identical
because this select has only two options.

**Exercising the flip branch found a real defect in T3's first implementation.** With a tall panel in
a short viewport the menu flipped upward but **covered its own trigger by 6px**: the position clamp
`Math.max(MENU_GAP, …)` pinned it to the top of the viewport when the space above was also
insufficient. That is precisely the "clamp to viewport" behaviour rejected during grilling, arrived
at by accident. The fix shrinks the panel (`max-height` capped to the available space, floored at
96px) instead of overlapping. Verified: `menuBottom` now equals `trigTop` exactly.

Forcing the branch took three attempts. Shrinking the viewport broke the modal's own layout before
the trigger ever got low enough, so the panel was made **tall** instead (20 injected options) — the
positioning logic is what was under test, not the option data.

**Measured, not eyeballed:** with the menu open, `scrollHeight === clientHeight` on the modal body
(no inflation) and `menuEscapesBody === true` (the panel extends past the body's bottom edge, which
was impossible under `absolute`).
