<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — The select menu escapes its clipping ancestor

**No change to `docs/specs/`.** Grepped all seven living specs for `select`, `dropdown`,
`enhanceSelect` and `modal`: the only hit is incidental
(`admin-html-rendering.md:52` names the locale selector as an escaping site, not a positioning one).
No spec describes how the enhanced select is positioned or how a floating panel behaves, and this
change does not create that capability — it corrects the geometry of one that already exists.

Adding a spec for the admin's floating-panel behaviour would be defensible, and is deliberately not
done here: it would be a new living document written on the back of a ~20-line CSS/JS fix, and the
routing in `AGENTS.md` sends a **visual rule of the panel** to `docs/DESIGN.md` rather than to
`docs/specs/`. That is where the rule lands.

## Routed to `docs/DESIGN.md`

> **Paneles flotantes (menús de select, popovers).** Un panel que se abre sobre la interfaz usa
> **`position: fixed`** y calcula `top` / `left` / `width` en JS desde el rect de su disparador.
> **Nunca `position: absolute`**: lo recorta el primer ancestro con `overflow` distinto de `visible`
> —el body y el panel de los modales lo son— y además suma altura desplazable, lo que hace aparecer
> una barra de scroll y agranda el modal.
>
> **No lo saques del DOM.** Portalearlo a `document.body` es el reflejo habitual y aquí es
> **incorrecto**: los modales son `<dialog>` nativos abiertos con `showModal()`, que renderiza en el
> *top layer* y deja **inerte** todo lo que queda fuera del diálogo — el panel acabaría detrás del
> backdrop y sin responder al click. Quedándose donde está conserva gratis el descarte por
> `shell.contains()`, el orden de tabulación y la contención de foco del `<dialog>` (ADR-0031, #138).
>
> Si no cabe bajo el disparador y arriba hay más sitio, **vuelca hacia arriba**. Con `fixed`, un
> panel cerca del borde inferior se sale de la pantalla: cambiar un recorte por un desbordamiento no
> es arreglarlo.

## Routed to `docs/adr/0031-floating-panels-stay-in-the-dom.md`

The *why* behind refusing the portal — the `<dialog>` top-layer/inertness reasoning, and the
`popover` alternative that was weighed and deferred. Recorded because the wrong answer is the
tempting one: this project's own issue #138 recommended it.
