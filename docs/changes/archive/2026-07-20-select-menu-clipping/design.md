<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — The select menu escapes its clipping ancestor

## 1. CSS (`src/styles/cms-admin.css:847`)

```diff
 .cms-select-menu {
-  position: absolute;
-  top: calc(100% + 0.28rem);
-  left: 0;
-  right: 0;
+  /* fixed, not absolute: an absolutely-positioned panel is clipped by the nearest ancestor with
+     overflow (the modal body and panel are both overflow-y: auto) and adds to its scrollable
+     height. A fixed panel is not — and there is no containing-block trap, since the only
+     filter-family declarations are backdrop-filter on ::backdrop. Geometry is set by openMenu:
+     left/right against the shell no longer apply. (#138) */
+  position: fixed;
   max-height: 14rem;
   …
 }
```

`.cms-select` keeps `position: relative` — harmless now, and still the anchor if the panel ever
returns to `absolute`.

## 2. Positioning (`src/routes/admin/layout.astro`, `openMenu`)

`openMenu` currently only toggles a class; all geometry came from CSS. It now measures:

```ts
const MENU_GAP = 4;          // px — matches the 0.28rem the absolute rule used
const MENU_MIN_HEIGHT = 96;  // px — below this a shrunken panel stops being usable

function positionMenu(entry: ManagedSelect): void {
  const rect = entry.trigger.getBoundingClientRect();
  const menu = entry.menu;

  menu.style.left = `${rect.left}px`;
  menu.style.width = `${rect.width}px`;
  menu.style.maxHeight = '';   // clear a cap from a previous open, or it shrinks every time

  const natural = menu.offsetHeight;
  const below = window.innerHeight - rect.bottom - MENU_GAP;
  const above = rect.top - MENU_GAP;

  // Flip only when it does not fit below AND there is genuinely more room above.
  const flip = natural > below && above > below;
  const space = flip ? above : below;

  // If it does not fit on the chosen side either, SHRINK rather than overlap the trigger.
  // Clamping the position instead would cover the field being edited.
  if (natural > space) menu.style.maxHeight = `${Math.max(MENU_MIN_HEIGHT, space)}px`;

  const height = menu.offsetHeight;
  menu.style.top = flip
    ? `${Math.max(MENU_GAP, rect.top - MENU_GAP - height)}px`
    : `${rect.bottom + MENU_GAP}px`;
}
```

> **Added during execution.** The first implementation had no `maxHeight` handling and clamped the
> flipped `top` to the viewport instead. Exercising the flip branch showed the panel then **covering
> its own trigger** when the space above was also insufficient — which is the "clamp to viewport"
> behaviour rejected at grilling, arrived at by accident. Shrinking is the correct response.

Called from `openMenu` after the shell gets `cms-select--open` — the panel must be laid out before
`offsetHeight` means anything.

`renderOptions` runs before opening, so the panel's content height is final at measure time.

## 3. What is deliberately not touched

- **`closeOpenIfOutside`** (`:876`) — the panel stays inside `shell`, so `shell.contains(target)`
  still matches. This is the main reason the DOM is not moved.
- **Scroll and resize handlers** (`:897-903`) — they already close the open menu, which is why no
  reposition loop is needed. A fixed panel would otherwise drift away from its trigger.
- **Focus and tab order** — unchanged, because the option buttons stay in document order and inside
  the `<dialog>`.
- **`renderOptions`, keyboard handling, `aria-*`** — untouched.
- **`.cms-select` shell, the trigger, the hidden native `<select>`** — untouched.

## 4. Consequences

- The panel no longer contributes to the modal body's scrollable overflow, so the spurious scrollbar
  and the inflated height go with it.
- All nine enhanced selects take the same path. The topbar ones render in the same place as before —
  `fixed` at the trigger's viewport rect is where `absolute` already put them — and scroll closes the
  menu, so no drift is observable.
- New behaviour: the panel can open upwards. Only when it does not fit below and there is more room
  above.

## 5. Verification

CSS box-model reasoning is not evidence. The gates that count are visual:

1. **Redirects modal** — open the status-code select. Panel fully visible, over the modal, not
   clipped; the modal gains no scrollbar and does not grow.
2. **User edit modal** — same, and confirm the reported height/scrollbar symptom is gone.
3. **Near the viewport bottom** — scroll the page so a select sits low, open it, confirm it flips
   above the trigger rather than running off-screen.
4. **Topbar selects** — the ones that were never clipped must look and behave exactly as before.
5. **Dismissal and keyboard** — click outside closes; `Escape` closes; scrolling the modal body
   closes; option selection still updates the native `<select>`.
6. `npm run e2e` — the existing admin suite drives these pages; it must stay green.

Screenshots for 1–4, since the whole defect is one nothing but looking would have caught.
