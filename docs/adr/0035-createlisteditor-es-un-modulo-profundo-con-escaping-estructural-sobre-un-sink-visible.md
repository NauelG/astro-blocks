<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0035 — createListEditor es un módulo profundo con escaping estructural sobre un sink visible

- **Status:** Accepted — 2026-07-21
- **Date:** 2026-07-21
- **Decisores:** Nauel Gómez
- **Source:** Issue [#117](https://github.com/NauelG/astro-blocks/issues/117) (P2, refactor), grilled 2026-07-21
- **Relación:** extiende ADR-0022 (el guard de escaping del admin) sin reemplazarlo; comparte la
  filosofía "una garantía estructural, no la disciplina del autor de turno" con ADR-0033/ADR-0034.

## Contexto

`configs-editor.ts` y `redirects-editor.ts` son copias casi verbatim de la misma máquina de lista
(state → refresh → renderTable → bindRows → delete-confirm). El resto de "list editors" que el issue
agrupa NO comparten ese esqueleto: `languages`/`users` son otra familia (fetch crudo, `win.cms*`,
gating owner, sin search), `menus` usa delegación y es mayormente un builder, y `global-blocks` no es
una lista. Verificado leyendo los seis.

Extraer un `createListEditor` desde dos callers está por debajo del umbral de "diséñalo dos veces". La
decisión no obvia no es *si* deduplicar, sino *cómo hacerlo de forma que el escaping deje de depender
de que el autor recuerde escapar* — el mismo problema que ADR-0022 resolvió con un guard, llevado un
paso más allá.

Al diseñar aparecieron dos tentaciones que hay que rechazar explícitamente, porque ambas parecen
mejoras y ambas romperían una garantía existente.

## Decisión

**1. El renderer de filas es una función pura sobre un modelo de celda tipado.** `renderRows(rows,
columns, rowId)` no toca `document` ni `fetch`; cada columna produce un `Cell` que es
`{ text }` (→`escapeHtml`), `{ attr }` (→`escapeAttr`) o `{ html: RawHtml }`. `RawHtml` es un tipo
*branded* que solo produce `raw(trusted: string)`. Pasar un `string` pelado donde se espera markup es
un error de compilación. **Para cualquier editor sobre este renderer, el escaping parcial es imposible
por construcción**: el único camino sin escapar es `raw()`, que es una superficie nombrada, grepeable
y pequeña (los dos SVG y los badges, cuyo texto dinámico se escapa *dentro* del `raw(...)`).

**2. El sink sigue siendo un `.innerHTML =` VISIBLE en `client/*.ts`.** Aquí está la tentación número
uno: lo "elegante" sería un tagged-template `html\`\`` o un `set:html`. Se rechaza. `media-tile.ts:26`
ya lo rechazó para tres iconos, y por la misma razón: el guard de ADR-0022 lexa bloques `<script>`
buscando sinks `innerHTML`/`outerHTML`, así que un sink que el guard no ve cambia una garantía
estructural por un comentario. `list-editor.ts` mantiene un `innerHTML` visible en `client/`, importa
y usa el escaper canónico, y por tanto `html-escape-guard.test.js` sigue verde sobre él. **El tipo
`RawHtml` es defensa ENCIMA del guard, no en su lugar** — el guard no distingue estáticamente HTML ya
escapado de HTML crudo (ADR-0022 rechazó una regla anti-concatenación por eso mismo), así que la capa
de tipos es lo que hace que el camino escapado sea el único para un string pelado.

**3. El alcance es configs + redirects; el resto se difiere, no se fuerza.** Tentación número dos:
meter `languages`/`users` con flags (`useRawFetch?`, `dialogApi?`, `ownerGated?`, `renderMode?`). Eso
convierte el módulo profundo en una interfaz-con-flags — lo contrario de lo que se busca. La Familia B
entra cuando #119 la haya migrado a `ct()`/`common.js`; hasta entonces el controller aterriza solo a
los dos gemelos reales, y las variaciones auténticas de esos dos (el sort de configs, el mensaje de
confirm, el listener de locale) se expresan como opciones nombradas, no como flags de familia.

## Consecuencias

**A favor.** El render/bind/delete, hoy atrapado en closures `initXEditor()` y solo alcanzable por
Playwright, se vuelve una función pura unit-testeable bajo `node:test`. El escaping deja de ser
per-editor y se vuelve estructural: el próximo editor de lista no puede olvidar escapar, porque el
tipo no se lo permite. Y el módulo es la pista de aterrizaje de `languages`/`users` post-#119.

**El coste, y es deliberado.** Dos callers es poco para justificar un módulo por dedup a secas, y este
ADR lo dice en voz alta en lugar de vender "elimina N copias": el valor está en la testabilidad y en
la garantía de escaping, no en el recuento de líneas. Además, `raw()` sigue siendo una superficie sin
escapar — pequeña y auditada, pero real; alguien puede meter texto de usuario dentro de un `raw()` sin
escaparlo, y ni el tipo ni el guard lo impiden. La mitigación es que `raw(` es grepeable y sus usos
son contados; la garantía estructural cubre el 99% (las celdas de texto), no el 100%.

**Frontera con #122.** `createListEditor` construye los botones edit/delete, así que es dueño de sus
dos iconos vía `raw()`. #122 (iconos de formularios de editor) es territorio aparte; la frontera queda
anotada en ambos issues.

**Si algún día cambia.** Si un editor necesita un modelo de binding distinto (delegación, como
`menus`) o un render por `createElement` (como `users`), la vía no es añadir un flag a
`createListEditor`, sino evaluar si ese editor pertenece a este módulo. La regla que este ADR fija es
*un controller para la familia de listas `innerHTML`+rebind*, no *un controller configurable para
cualquier tabla*.
