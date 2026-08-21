<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# tasks — i18n-bridge-to-ct

Issue [#119](https://github.com/NauelG/astro-blocks/issues/119) · ADR-0039 · `proposal.md` · `design.md` · `spec-delta.md`

Seis slices verticales, uno por commit. **Cada slice deja el árbol verde**: `npm run typecheck`,
`npm test` y `npm run check` pasan antes de commitear. Los slices 1 y 2 van **antes** de tocar ningún
editor: son la red que sustituye al canario que la migración destruye.

Disciplina TDD dentro de cada slice: test que falla → mínimo código para pasarlo → refactor → commit.

---

## Slice 1 — La red: e2e en español

`test(e2e): assert the admin panel renders Spanish end to end (#119)`

Este test debe pasar **hoy, contra el puente**. Si no pasa antes de migrar, no es una red: es un test
del cambio. Mismo catálogo y mismo locale por ambos caminos, así que su verde inicial es lo esperado.

- [x] **T1.1 — Elegir la cadena a afirmar por página.** Para cada ruta, tomar una clave que renderice
      el **módulo cliente** (no el `t()` del template) y copiar su valor literal de
      `src/routes/admin/i18n/es.ts`. Candidatas:
      - `/cms/languages` → `languages.statusActive` o `languages.deleteLabel`
      - `/cms/users` → `users.roleOwner` o `users.deleteLabel`
      - `/cms/import-export` → `importExport.status.idle`

      Criterio: la cadena debe (a) venir del puente hoy y de `ct` mañana — no del frontmatter — y
      (b) **diferir del inglés**. Si `es` y `en` coinciden en esa clave, el test no distingue idioma y
      hay que elegir otra. No inventar la traducción: copiarla de `es.ts`.

- [x] **T1.2 — Crear `e2e/admin-i18n-es.spec.ts`.** Contexto con `test.use({ locale: 'es-ES' })` y
      **sin** cookie `cms-ui-locale` — esa combinación es la que ejercita la rama `Accept-Language` de
      `resolveUiLocale` (`src/routes/admin/i18n/resolve.ts:123`), la única que el cliente no sabe
      resolver solo.

      ⚠️ **Corrección sobre el plan original, comprobada en ejecución.** Este task pedía
      `extraHTTPHeaders: { 'accept-language': 'es' }`. **No funciona**: Chromium es dueño de esa
      cabecera y sobrescribe la extra, así que la navegación sale con `Accept-Language: en-US` y el
      SSR responde `<html lang="en">`. Verificado que el servidor sí honra la cabecera —
      `curl -H 'Accept-Language: es'` devuelve `lang="es"`— o sea el fallo estaba en el emisor, no en
      la resolución. La opción correcta es `locale`, que Playwright traduce a `Accept-Language` **y**
      a `navigator.language` a la vez.
      Autenticar reutilizando el patrón de `e2e/admin-xss.spec.ts`. Para cada una de las tres rutas:
      esperar a que el módulo pinte y afirmar la cadena de T1.1.

      **Verificación:** `npx playwright test e2e/admin-i18n-es.spec.ts` verde **contra `main` sin
      migrar**. Si falla aquí, el problema es el test.

- [x] **T1.3 — Verificación negativa del propio test.** Resuelta con una comprobación más fuerte que
      la planeada: en vez de romper una assertion, se inspeccionó el **HTML servido** y se extrajo el
      contenido de cada selector afirmado. Los tres llegan vacíos o con la fila de carga —
      `#cms-languages-tbody` solo trae `Cargando…`, `#cms-users-tbody` y `#ie-status` están vacíos—
      así que la cadena española que el test afirma **solo puede haberla escrito el módulo cliente**.
      Un grep del HTML entero habría dicho lo contrario: las tres cadenas aparecen en el documento,
      dentro del propio objeto del puente y de `<option>`s SSR ajenos al selector.

**Commit** cuando T1.1–T1.3 estén hechos y `npm run check` pase (fichero nuevo → Biome exige formato).

---

## Slice 2 — `ct` deja de callar

`feat(admin): warn in dev when a catalog key does not resolve (#119)`

- [x] **T2.1 — Test primero** en `tests/i18n-client-editors.test.js`: una clave inexistente sigue
      devolviendo la clave cruda (el sentinela de `t.ts:29` **no cambia**) y emite aviso. Cubrir
      también el silencio en producción — es la mitad de la decisión, no un detalle.

- [x] **T2.2 — Implementar** en `src/routes/admin/i18n/client.ts:124-127`, según `design.md` §3:

      ```ts
      const value = tFn(key, params);
      if (typeof window !== 'undefined' && import.meta.env.DEV && value === key) {
        console.warn(`[astro-blocks] i18n key not found: "${key}"`);
      }
      return value;
      ```

      La detección es `value === key`: observa el resultado del fallback de `t.ts`, no duplica su
      lógica. **Corrección del snippet inicial:** `import.meta.env.DEV` directo lanza en los node:test,
      porque ahí `import.meta.env` es `undefined`; `typeof window !== 'undefined'` corta esa lectura
      fuera de Vite y conserva el `DEV` directo que Vite puede eliminar en producción. Verificado en
      Vite dev con Chromium: una clave inexistente devuelve la clave y emite exactamente el aviso.
      Tras `npm run build:playground`, la cadena del aviso no aparece en
      `playgrounds/basic/dist/`: ese es el bundle Vite de producción. El `dist/` raíz es el espejo
      TypeScript publicado por el paquete, **no** un bundle Vite, y conserva `import.meta.env.DEV`
      deliberadamente para que el consumidor lo transforme.

      **Verificación:** `npm test` · `npm run typecheck`. Y tras `npm run build:playground`, comprobar
      que el `console.warn` no queda vivo en `playgrounds/basic/dist/`.

---

## Slice 3 — `languages`

`refactor(admin): resolve languages editor strings through ct (#119)`

El primero a propósito: 19 propiedades, ninguna trampa conocida. Valida el patrón.

- [x] **T3.1 — Migrar `src/routes/admin/client/languages-editor.ts`.** Importar `ct` de
      `../i18n/client.js` y sustituir cada lectura `i18n.X` por `ct('clave.real')` usando la tabla de
      `design.md` §2. Las cuatro que **no** derivan del nombre:
      `editLabel` → `common.edit` · `saveBtn` → `common.save` · `dialogTitle` → `languages.modalTitle`
      · `deleteConfirmTemplate` → `languages.deleteConfirm`.
      Las otras 15 son `languages.<mismoNombre>`, pero verificar cada una contra el `.astro`.

- [x] **T3.2 — Borrar el andamiaje**: el tipo `LanguagesI18n`, `getI18n()` (`:57-59`) y los casts
      `as unknown as` (`:58`, `:63`). Cero ocurrencias de `__cms` en el fichero.

- [x] **T3.3 — Limpiar `src/routes/admin/languages.astro`**: el objeto `languagesI18n` (`:21-41`), el
      comentario `:20` que miente sobre `is:inline`, el comentario `:122` y el
      `<script define:vars={{ languagesI18n }}>` (`:123-125`).
      **Se quedan**: el `<script>` que importa `./client/languages-editor.js` (`:126-129`) y
      `resolveUiLocale`/`createT`/`t()` del frontmatter — son el SSR del título, eyebrow, lead y
      cabeceras.

- [x] **T3.4 — Corregir la cabecera del módulo** (`languages-editor.ts:9`, `:14-15`), que documenta el
      puente como la vía de entrada de las cadenas.

      **Verificación:** `npm run typecheck` · `npm test` · `npm run check` ·
      `npx playwright test e2e/admin-i18n-es.spec.ts e2e/admin-xss.spec.ts e2e/admin-ssr-no-data.spec.ts`.
      Manual en español: abrir el modal y borrar un idioma — la confirmación
      (`languages.deleteConfirm`, una de las renombradas, con interpolación) debe salir traducida y
      con su variable intacta.

---

## Slice 4 — `users`

`refactor(admin): resolve users editor strings through ct (#119)`

- [x] **T4.1 — Migrar `src/routes/admin/client/users-editor.ts`** contra la tabla de `design.md` §2
      (22 propiedades). Las cinco que no derivan del nombre:
      `dialogTitle` → `users.modalTitle` · `countLabel` → `users.count` · `editLabel` → `common.edit`
      · `saveBtn` → `common.save` · `noDate` → `common.noDate`.

- [x] **T4.2 — `loading` no se migra: se borra.** Es código muerto — el estado de carga se conmuta con
      `cms-hidden`, el texto no se reescribe nunca. Confirmarlo antes de borrar:
      `rg 'loading' src/routes/admin/client/users-editor.ts` solo debe devolver la declaración del tipo
      y manejo de elementos DOM, ninguna lectura de texto.
      La clave `users.loadingUsers` **permanece en los catálogos**: la usa el marcado SSR.

- [x] **T4.3 — Borrar el andamiaje**: tipo `UsersI18n`, `getI18n()` (`:55`), casts (`:55`, `:59`). En
      `users.astro`: objeto `usersI18n` (`:20-43`), comentario `:19`, puente (`:129-132`).
      Conservar el `<script>` del módulo (`:133-136`) y el `t()` del frontmatter.

- [x] **T4.4 — Corregir la cabecera** de `users-editor.ts` (`:9`, `:14-15`).

      **Verificación:** igual que T3.4. Manual en español: crear, editar y borrar usuario, con atención
      al recuento (`users.count`, interpolado) y al aviso de último owner.

---

## Slice 5 — `import-export` y la inversión de los tests

`refactor(admin): resolve import-export editor strings through ct (#119)`

El último a propósito: el objeto más grande, el desajuste conocido y los tests que pinnean el puente.

- [x] **T5.1 — Migrar `src/routes/admin/client/import-export-editor.ts`** contra la tabla de
      `design.md` §2 (22 propiedades). Aquí **las siete de estado** llevan clave anidada:
      `statusIdle` → `importExport.status.idle`, `statusExporting` → `importExport.status.exporting`,
      y así hasta `statusError`.

- [x] **T5.2 — Recuperar `confirmUnavailable`.** En `:311`, `ct('importExport.confirmUnavailable')`
      **sin `||`**. Ese literal inglés era la única razón de que el desajuste tipo↔puente no se viera;
      dejarlo lo volvería a esconder. La clave existe en `en.ts:355` y `es.ts:353`.

- [x] **T5.3 — Retirar los demás `|| 'literal inglés'`.** `getI18n()` devolvía
      `({} as ImportExportI18n)` (`:72`), así que cada campo tenía su fallback; con `ct` todos son
      código muerto. Si alguno protege algo que **no** es una cadena de catálogo, dejarlo y anotarlo.

- [x] **T5.4 — Borrar el andamiaje**: tipo `ImportExportI18n` (`:30-54`), `getI18n()` (`:72`). En
      `import-export.astro`: objeto `ieI18n` (`:22-45`), comentarios `:20-21` y `:175`, puente
      (`:179-181`). Conservar el `<script>` del módulo (`:182-185`) y todo el `t()` del frontmatter,
      **incluido `exportUnits` (`:47-53`)**, que es SSR.

- [x] **T5.5 — Invertir las dos assertions** de `tests/import-export-admin-ui.test.js` que exigen el
      puente: `:227-236` (el `define:vars` existe y asigna `__cmsImportExportI18n`) y `:457-464`
      (*"client must read from the bridge"*). Pasan a exigir lo contrario: los tres módulos usan `ct(`,
      y **ninguno** contiene `__cms` ni `as unknown as` en contexto i18n. Cubrir los tres, no solo
      import-export — el test invertido es lo que impide que el puente vuelva mañana.
      **No tocar** la lista de 39 claves `importExport.*` (`:47-92`), la paridad en→es (`:94-101`) ni
      los valores no vacíos (`:103-112`): verifican el catálogo, no el mecanismo.

- [x] **T5.6 — Barrido de frontera.** `rg '__cms\w+I18n' src/routes/admin/client/` no devuelve nada.
      `rg '__cms' src/routes/admin/layout.astro` **sigue** devolviendo `__cmsAuthI18n` y
      `__cmsLayoutI18n` intactos: son de #106, y que sigan ahí es el criterio de que no nos hemos
      pasado de alcance.

      **Verificación:** `npm run typecheck` · `npm test` · `npm run check` · `npx playwright test`
      (suite completa). Manual en español: exportar e importar, forzando la rama de error de red para
      ver un `importExport.status.error` real.

---

## Slice 6 — Documentación

`docs(context): client strings come from ct, not the i18n bridge (#119)`

- [x] **T6.1 — `docs/CONTEXT.md` §3, línea 127.** Reescribir la entrada **i18n bridge**: describe un
      canal de **datos** (`window.getCmsUiLocale` como ejemplo vivo), no de cadenas traducidas. Quitar
      la referencia a `import-export.astro`, que deja de ser ejemplo del patrón.

- [x] **T6.2 — `docs/CONTEXT.md` §3: entrada nueva para `ct`.** El helper de cliente: resolución por
      clave en el navegador, locale desde el puente de locale, sentinela + warn en dev. Es el término
      que faltaba y la causa raíz de #119. Referenciar ADR-0039.

- [x] **T6.3 — `docs/CONTEXT.md` §4, convención de escapado.** Cambiar *"Put the logic in a client
      module (wired via the i18n bridge)"* — esa frase dirige al mecanismo equivocado. El requisito
      real (renderizado en `client/*.ts`, escapado en el sink) no cambia.

- [x] **T6.4 — `docs/CONTEXT.md` §7, *Admin UI runtime*.** Las tres viñetas de `define:vars` siguen
      siendo ciertas como trampas del mecanismo, pero la última remata con *"feed it via the i18n
      bridge"*: reapuntarla a `ct`.

- [x] **T6.5 — Abrir la issue de seguimiento** [#173](https://github.com/NauelG/astro-blocks/issues/173)
      para estrechar `ct(key: string)` a `CatalogKey` en los
      call sites. Cuerpo con los hechos ya establecidos: `messageKey: string` en
      `src/utils/block-validation.ts:227` y `src/utils/blocks.ts:97`, consumido por
      `page-editor.ts:549`/`:940` y por `localizedJsonError` en `global-blocks.ts:153` y
      `schema-loading.ts:110`; y la pregunta de capas — tiparlo obliga a que `src/utils/` importe de
      `src/routes/admin/i18n/`. Enlazar ADR-0039. Etiquetas `P3` + `refactor` + `needs-triage`.

      **Verificación:** `npm run check` y lectura del diff de `CONTEXT.md`: ninguna mención
      superviviente que presente el puente como la vía de las cadenas.

---

## Fuera de estos slices

- **`docs/specs/`** — el `spec-delta.md` se aplica en la fase **Archive**, no aquí (`AGENTS.md`).
- **`layout.astro`** (`__cmsAuthI18n`, `__cmsLayoutI18n`) — #106.
- **`cache.astro`** — no tiene módulo cliente al que migrar.
- **`AlertDialog.astro` / `ConfirmDialog.astro`** — props de Astro, no un puente `window`.
- **Claves de catálogo nuevas** — ninguna. Las 63 cadenas ya existen en `en.ts` y `es.ts`.

## Cierre (solo cuando el humano lo pida)

Bump `patch` en `package.json` · entrada en `CHANGELOG.md` · `src/meta/features.json` ·
`npm run features:validate` · badge de versión del `README.md` · commit y tag anotado `vX.Y.Z`.
