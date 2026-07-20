<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — The select menu escapes its clipping ancestor

_Resolves [#138](https://github.com/NauelG/astro-blocks/issues/138) (bug, P2). Found during the
Astro 7 QA pass (#55). Grilled 2026-07-20._

## Problem

Opening a custom select inside a modal shows a scrollbar, makes the modal body taller than its
content warrants, and renders the options panel clipped inside that body instead of floating over
the UI. Reported on the **user edit** and **redirects** modals; they are one bug, the panel causing
the height.

`enhanceSelect` appends the panel to a shell it inserts where the native `<select>` was
(`layout.astro:778-821`), and the panel is positioned out of flow:

```css
.cms-select-menu { position: absolute; top: calc(100% + 0.28rem); left: 0; right: 0; max-height: 14rem; }
```

An absolutely-positioned element is clipped by the nearest ancestor with `overflow: auto | hidden`,
and it contributes to that ancestor's scrollable overflow. Two ancestors qualify here —
`.cms-detail-modal-panel` and `.cms-detail-modal-body`, both `overflow-y: auto`. So the panel is cut
off *and* adds scrollable height.

This predates the Astro 7 migration; it was simply noticed while looking carefully at the admin.

## Why the issue's own recommendation is wrong

The issue proposes portaling the panel to `document.body`, and calls the alternatives cheaper but
inferior. That is the reflex answer for a clipped popup, and here it is **incorrect**, not merely
expensive.

`DetailModal` is a native `<dialog>` opened with `showModal()` (`DetailModal.astro:23`,
`ConfirmDialog.astro:59`). A modal dialog renders in the **top layer** and makes everything outside
it **inert**. A panel appended to `document.body` would sit behind the backdrop and refuse clicks.
Portaling only works if the panel also enters the top layer — via the `popover` attribute — which is
a different, larger change and one that would settle this repo's (currently unstated) browser-support
policy as a side effect.

The issue also lists "positioning on scroll/resize … needs a reposition loop or CSS anchor
positioning" as required work. It is not: `layout.astro:897-903` already closes the open menu on
`scroll` (capture phase, so it catches the modal body's own scrolling) and on `resize`. The panel
never survives a scroll, so there is nothing to keep in sync.

## Proposed change

**`position: fixed`, without moving the panel in the DOM.**

A fixed element is not clipped by an ancestor's `overflow`, and there is no containing-block trap in
the way: the only `filter`-family declarations are `backdrop-filter` on `::backdrop`
(`cms-admin.css:1032,1120`), a pseudo-element that does not establish a containing block for the
dialog's descendants.

Because the panel stays where it is in the DOM, three things keep working for free — all of which
portaling would have broken:

- `closeOpenIfOutside`'s `shell.contains(target)` dismissal check (`layout.astro:876-880`);
- tab order, since the option buttons stay in document order next to their trigger;
- the `<dialog>`'s native focus containment, since the panel remains inside it.

What `fixed` gives up is the free geometry it got from `left: 0; right: 0` against the shell. `top`,
`left` and `width` must be computed in `openMenu` from the trigger's `getBoundingClientRect()`.

Scope: **all nine enhanced selects**, with no conditional. The topbar selects are not clipped today,
but a branch that only runs in the rare case is the branch nobody exercises until it breaks.

Overflow: the panel **flips above the trigger** when there is not enough room below and more room
above. This is new behaviour, and it is required rather than optional — `fixed` positioning near the
viewport bottom would otherwise run off-screen, which trades a clipping bug for an overflow bug.

## Alternatives considered

- **Portal to `document.body`** — rejected: inert behind the backdrop of a modal `<dialog>`, as
  above.
- **Portal to `document.body` with the `popover` attribute** — viable and arguably the design one
  would choose from scratch, since `popover` enters the top layer. Rejected for scope: it rewires
  dismissal and focus, and forces a browser-support decision this repo has never stated (no
  `browserslist`, no policy in the README).
- **`overflow: visible` on the modal body** — rejected. CSS-only and no new JavaScript, but it moves
  scrolling to the outer panel for *every* long modal and lets the menu overflow the dialog itself on
  short forms. It relocates the problem rather than removing it.

## Verification

Reasoning about the CSS box model is exactly what this session has twice proved unreliable on its
own. The change is confirmed by **looking**: open the redirects and user modals in the playground
with the panel open, near the bottom of the viewport as well as the top, and check the panel is
neither clipped nor off-screen and that the modal gains no scrollbar. Screenshots, not deduction.
