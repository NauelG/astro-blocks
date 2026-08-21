<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# spec-delta — i18n-bridge-to-ct

Cambio respecto a `docs/specs/`. Issue [#119](https://github.com/NauelG/astro-blocks/issues/119),
ADR-0039.

Toca dos specs vivos: `i18n-catalogs.md` (dónde se resuelven las claves) y `admin-html-rendering.md`
(qué forma tiene el bootstrap de una página admin).

---

## ADDED: `i18n-catalogs.md` — Consumo de catálogo desde el cliente

La spec cubre hoy la **paridad** de catálogos y el **origen único** de los mensajes de validación.
No dice nada sobre **cómo un módulo cliente obtiene una cadena**, que es justo el hueco por el que
tres editores acabaron sobre el mecanismo equivocado.

- **R8 — Un módulo cliente obtiene sus cadenas de `ct`.** El texto de i18n del panel se resuelve
  **en el navegador**, por clave, contra el catálogo. Ninguna página `.astro` publica cadenas ya
  traducidas a un módulo cliente. La clave es el único identificador de una cadena, y existe en un
  solo sitio: el catálogo. (ADR-0039)

- **R9 — El puente i18n transporta datos, nunca cadenas traducidas.** El patrón de dos scripts que
  ADR-0022 exige sigue vigente y sigue siendo el modo correcto de pasar **datos** de la página al
  módulo — `window.getCmsUiLocale`, que es el cimiento sobre el que R8 funciona, es exactamente eso.
  Lo que R9 prohíbe es que por ese canal viaje texto ya resuelto.

  El motivo es de verificabilidad, no de estilo: la correspondencia entre el objeto publicado por el
  `.astro` y el tipo declarado por el módulo cruza la frontera `.astro` → módulo, donde `tsc` no
  llega. Esa lista mantenida a mano ya divergió en ambas direcciones (una traducción declarada y
  nunca publicada; una publicada y nunca leída), y ningún test lo detectó.

- **R10 — Una clave sin resolver es ruidosa en desarrollo.** El fallback a clave cruda de `t.ts` se
  conserva (ver MODIFIED abajo), y además `ct` emite `console.warn` cuando una clave no resuelve,
  **solo en desarrollo**. En producción no emite nada: un fallo de traducción no debe generar ruido
  en la consola de un usuario que no puede hacer nada al respecto.

- **R11 — La resolución de cliente y la de SSR coinciden en idioma.** `resolveUiLocale` decide el
  locale en el servidor con precedencia cookie → `Accept-Language` → `en`, `layout.astro` publica ese
  valor resuelto, y `ct` lo lee de ahí. Un visitante sin cookie y con `Accept-Language: es` ve el
  panel entero en español: lo renderizado en SSR y lo renderizado por `ct` no pueden discrepar,
  porque ambos parten del mismo locale resuelto una sola vez.

### Escenarios

- **S-3 — Un editor sin puente.** `/cms/users` se carga sin cookie de locale y con
  `Accept-Language: es`. Las etiquetas producidas por el módulo cliente aparecen en español. Ni una
  clave cruda (`users.deleteLabel`) llega al DOM.

- **S-4 — Una clave inexistente en desarrollo.** Un módulo llama a `ct` con una clave que no está en
  el catálogo. La UI muestra la clave cruda (el sentinela de R10 en `t.ts`) **y** la consola de
  desarrollo registra un aviso nombrando la clave. En un build de producción la UI se comporta igual
  y la consola calla.

### Cobertura

- `e2e/admin-i18n-es.spec.ts` (nuevo) — R8, R11, S-3: carga `/cms/languages`, `/cms/users` y
  `/cms/import-export` con `Accept-Language: es` y sin cookie, y afirma texto en español producido
  por `ct` en cada una.

  Esta prueba **repone deliberadamente una red que el cambio destruye**. Antes, un puente ausente
  lanzaba `TypeError` en `languages` y `users`, las filas no pintaban y `admin-xss.spec.ts` fallaba —
  un canario accidental. `ct` no lanza: devuelve la clave como texto, y todo seguiría en verde. La
  assertion en español es la que distingue "resolvió" de "escribió la clave", porque
  `users.deleteLabel` no es español. Una assertion en inglés no distinguiría ambos casos.

- `tests/import-export-admin-ui.test.js` — R9: las dos assertions que **exigían** el puente
  (`__cmsImportExportI18n` presente, y el cliente leyéndolo) se invierten: pasan a exigir uso de `ct`
  y ausencia de `__cms` en los tres módulos. Las assertions de presencia y paridad de claves del
  mismo fichero no se tocan: verifican el catálogo, no el mecanismo.

---

## MODIFIED: `i18n-catalogs.md` R7 y "Boundaries & residual" — el sentinela deja de ser solo visible

R7 describe el fallback a clave cruda de `t.ts` como *"a **visible sentinel** when a key is missing"*,
y la sección de residual lo conserva como *"the last-resort sentinel"*.

**Sigue conservándose, y por la misma razón.** Lo que cambia es que deja de ser *solo* visible: en
desarrollo también es audible (R10). La motivación es nueva y viene de este cambio — con el puente,
una cadena que faltaba rompía la página de forma escandalosa; con `ct`, el fallo es casi invisible a
simple vista. Un sentinela silencioso era suficiente cuando el otro camino gritaba. Ya no lo es.

El residual de la sección "Boundaries & residual" —que el guard prueba que toda clave del origen
compartido está localizada, pero no que el validador no emita una clave *fuera* de ese origen— queda
**parcialmente reducido**: ese caso ya no es solo un sentinela visual en la UI, sino un aviso en
consola durante el desarrollo del emit site nuevo.

---

## MODIFIED: `admin-html-rendering.md` R3 — la forma del bootstrap

R3 describe hoy la forma canónica de una página admin así:

> The `.astro` file is a bootstrap: a `define:vars` script publishing `window.__cmsXI18n`, plus a
> module script importing `./client/x.js`.

Esa frase **prescribe el puente de cadenas como la forma normal**, y es la fuente documental del
problema que #119 corrige. Pasa a:

> The `.astro` file is a bootstrap: a module script importing `./client/x.js`. It publishes no
> translated strings — the module resolves its own text through `ct` (`i18n-catalogs.md` R8). A
> `define:vars` script remains the correct way to hand the module **data**, and R9 bounds what may
> travel that way.

R3 no cambia en nada más. Su requisito real —que el renderizado dinámico viva en `client/**/*.ts`,
donde Biome lintea y el guard de escapado camina— es independiente del mecanismo de i18n y sigue
intacto, igual que su excepción time-boxed para `layout.astro` (#106).

## MODIFIED: `admin-html-rendering.md` "Related" — alcance no cubierto

Se añade a la lista de "Out of scope, tracked separately" el estrechamiento de `ct(key: string)` a
`CatalogKey` en los call sites, con su issue de seguimiento. ADR-0039 explica por qué no entra aquí:
`messageKey` viaja sin tipar desde `utils/block-validation.ts` hasta `localizedJsonError`, y tiparlo
obligaría a que `src/utils/` importe del panel.

---

## REMOVED

Nada. Ningún requisito existente se elimina: R3 se reescribe, no se retira, y el fallback a clave
cruda se conserva explícitamente.
