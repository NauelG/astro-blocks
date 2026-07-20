<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0031 — Los paneles flotantes del admin no se sacan del DOM

- **Status:** Accepted — 2026-07-20
- **Date:** 2026-07-20
- **Decisores:** Nauel Gómez
- **Source:** Issue [#138](https://github.com/NauelG/astro-blocks/issues/138), detectado en el QA de
  Astro 7 (#55), grilled 2026-07-20

## Contexto

El menú de opciones de `enhanceSelect` se abría recortado dentro de los modales, y además hacía
aparecer una barra de scroll y agrandaba el diálogo. La causa es el modelo de cajas: el panel es
`position: absolute`, y un elemento posicionado absolutamente lo recorta el ancestro más cercano con
`overflow` distinto de `visible` —aquí `.cms-detail-modal-panel` y `.cms-detail-modal-body`, ambos
`overflow-y: auto`— y contribuye a su desbordamiento desplazable.

La respuesta refleja a un popup recortado es **portalearlo a `document.body`**. El propio issue #138
la recomendaba, y es lo primero que propone cualquiera que haya peleado con `overflow` antes.

Aquí es **incorrecta**, y el motivo no es de coste sino de comportamiento: los modales del admin son
**`<dialog>` nativos abiertos con `showModal()`** (`DetailModal.astro`). Un diálogo modal se renderiza
en el **top layer** y deja **inerte** todo lo que queda fuera de él. Un panel colgado de
`document.body` quedaría detrás del backdrop y no respondería al click. Portalear solo funciona si el
panel entra también en el top layer —vía el atributo `popover`—, que es un cambio mayor y de paso
fijaría la política de soporte de navegadores que este repo nunca ha declarado.

El issue también daba por necesario un bucle de reposicionamiento en scroll. No lo es: `layout.astro`
ya cierra el menú abierto en `scroll` (fase de captura, así que capta el del propio body del modal) y
en `resize`.

## Decisión

**Un panel flotante del admin usa `position: fixed` y permanece donde está en el DOM.**

- `fixed` no lo recorta el `overflow` de ningún ancestro. No hay trampa de bloque contenedor: las
  únicas declaraciones de la familia `filter` son `backdrop-filter` sobre `::backdrop`, un
  pseudo-elemento que no establece bloque contenedor para los descendientes del diálogo.
- La geometría que `fixed` pierde —`left: 0; right: 0` contra el shell— se calcula en JS al abrir,
  desde el `getBoundingClientRect()` del disparador.
- **No se portalea.** Quedándose en su sitio conserva, sin escribir una línea, las tres cosas que
  moverlo rompería: el descarte por `shell.contains(target)`, el orden de tabulación, y la contención
  de foco del `<dialog>`.
- Si no cabe bajo el disparador **y arriba hay más sitio**, vuelca hacia arriba. Con `fixed` un panel
  bajo se saldría de la pantalla, y cambiar un recorte por un desbordamiento no es arreglarlo.
- Si **no cabe en ninguno de los dos lados**, se **encoge** al espacio disponible (con un mínimo por
  debajo del cual deja de ser usable) en lugar de recolocarse. Fijar la posición al borde de la
  pantalla haría que el panel tapara el propio campo que se está editando — que es peor que una lista
  más corta, y el motivo por el que se descartó "pegar al viewport".
- Sin rama condicional: **todos** los selects mejorados usan el mismo camino, incluidos los que hoy no
  están recortados. Dos modos de posicionamiento significan una rama que solo se ejercita en el caso
  raro, que es justo la que nadie prueba hasta que falla.

## Alternativas consideradas

1. **Portalear a `document.body`** — rechazada: inerte tras el backdrop de un `<dialog>` modal.
2. **Portalear a `document.body` con el atributo `popover`** — viable, y probablemente lo que uno
   elegiría en un diseño nuevo, porque `popover` entra en el top layer. Aplazada por alcance:
   rehace el descarte y el foco, y obliga a decidir soporte de navegadores de refilón. Si algún día
   el admin necesita paneles anidados o anclaje que sobreviva al scroll, este es el camino, y este
   ADR debe reemplazarse entonces.
3. **`overflow: visible` en el body del modal** — rechazada: sin JavaScript nuevo, pero mueve el
   scroll al panel exterior para *todos* los modales largos y deja que el menú desborde el propio
   diálogo en formularios cortos. Reubica el problema en vez de eliminarlo.

## Consecuencias

- El panel deja de sumar altura desplazable: desaparecen la barra de scroll espuria y el modal
  agrandado.
- **Aparece comportamiento nuevo**: el panel puede abrirse hacia arriba. Solo cuando no cabe abajo.
- Los selects que hoy no estaban recortados pasan por el mismo camino. Se renderizan donde ya se
  renderizaban, y como el scroll cierra el menú no hay deriva observable.
- El posicionamiento pasa de ser gratis (CSS) a ser código que hay que mantener. Es el precio de
  escapar del recorte sin salir del DOM.
- **Queda una dependencia implícita** que conviene recordar: esto funciona porque el scroll cierra el
  menú. Si alguien alguna vez decide que el menú debe sobrevivir al scroll, `fixed` sin anclaje
  derivará respecto a su disparador, y la solución pasará a ser la alternativa 2.
