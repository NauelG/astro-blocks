<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Los tres editores rezagados pasan a `ct`

_Resuelve [#119](https://github.com/NauelG/astro-blocks/issues/119). Grilled 2026-08-20. ADR-0039._

## El problema

Hay dos formas de que un módulo cliente del panel obtenga una cadena traducida, y las dos terminan en
el mismo `createT` sobre el mismo `catalogs.ts`.

- **`ct(key)`** — el módulo importa el helper y resuelve la clave en el navegador. Lo usan 13 módulos.
- **El puente i18n** — la página `.astro` construye `{ prop: t('clave') }` en frontmatter, un
  `<script define:vars>` lo cuelga de `window.__cmsXI18n`, y el módulo lo baja con un cast.

`languages`, `users` e `import-export` usan el segundo. Y aquí está el detalle que decide el caso:
**esos tres módulos ya importan `common.ts`, que importa `ct`**. Los catálogos completos ya están en
su bundle. Pagan el peso del mecanismo bueno y usan el malo.

El puente no compra corrección —mismo catálogo, mismo locale— y sí cuesta una lista de claves
mantenida a mano que el compilador no puede verificar, porque la correspondencia entre el objeto del
`.astro` y el tipo del editor cruza una frontera donde `tsc` no llega.

### El coste, ya materializado

En las dos direcciones posibles:

- **`ImportExportI18n.confirmUnavailable`** está declarado en el tipo (`import-export-editor.ts:47`)
  y **se lee** en una rama viva (`:311`), pero `import-export.astro:22-45` **nunca lo publica**. El
  `|| 'Confirm dialog is not available…'` de esa línea absorbe el `undefined`, así que no se ve
  `"undefined"` — se ve inglés. La traducción española existe en `es.ts:353` y no la alcanza nadie.
- **`usersI18n.loading`** se publica (`users.astro:42`) y se tipa (`users-editor.ts:43`), y no lo lee
  nadie. El texto de carga se conmuta con `cms-hidden`, nunca se reescribe.

Ninguno de los dos lo ve TypeScript. Ninguno de los dos lo ve un test.

Y el cast que cierra el círculo se contradice a sí mismo (`users-editor.ts:55`):

```ts
return (getCmsWindow() as unknown as { __cmsUsersI18n?: UsersI18n }).__cmsUsersI18n as UsersI18n;
```

El `?` interior admite que el valor puede faltar; el `as UsersI18n` exterior lo niega.

### Por qué ocurrió

No fue descuido. `docs/CONTEXT.md` documenta el puente en §3 y **no menciona `ct` ni una vez** en sus
331 líneas; la convención de §4 remata con *"put the logic in a client module (wired via the i18n
bridge)"*; y `docs/specs/admin-html-rendering.md` R3 describe el bootstrap canónico de una página
admin como *"a `define:vars` script publishing `window.__cmsXI18n`, plus a module script"*. El
mecanismo equivocado era el único señalizado, en tres documentos. Por eso el cambio incluye
documentación: sin ella, el cuarto editor nace igual que los tres primeros.

## El cambio

**Los tres editores resuelven sus cadenas con `ct`. Los tres bloques `<script define:vars>` de i18n
desaparecen, junto con sus tipos `XI18n`, sus `getI18n()` y sus casts.**

No hay módulo que construir: `ct` ya existe y ya está en el bundle de los tres. Es migración por
borrado.

**Cero claves nuevas.** Verificado propiedad a propiedad: las 63 publicadas son todas `t('...')`
contra el catálogo, sin un solo literal hardcodeado. Más `confirmUnavailable`, cuya clave también
existe en ambos catálogos. La paridad `en`/`es` no se toca.

**`t()` de frontmatter se queda.** Es el SSR: títulos, cabeceras, `<h1>`. Solo se borra el objeto del
puente y su script.

**`ct` gana voz.** Emite `console.warn` en desarrollo cuando una clave no resuelve. En producción
calla: un fallo de traducción no debe ensuciar la consola de un usuario que no puede arreglarlo.

## El riesgo real de este cambio, y cómo se cubre

La migración, tal como está escrita en #119, **reduce la cobertura efectiva**. Conviene decirlo antes
de hacerla.

Hoy `languages-editor.ts:58` y `users-editor.ts:55` no tienen fallback en runtime: sin puente,
`getI18n()` es `undefined`, la primera lectura lanza `TypeError`, las filas no pintan y
`e2e/admin-xss.spec.ts:108` / `:113` fallan. Es un canario, accidental pero real.

`ct` no lanza. Devuelve la clave como texto. Un fallo de i18n post-migración se vería como filas con
`users.deleteLabel` escrito literalmente, y **todos los tests en verde**.

Por eso el primer commit del cambio es la red, no el refactor: un test Playwright que carga las tres
rutas con `Accept-Language: es` y sin cookie y afirma texto **en español**. Verde ya contra el puente
—mismo catálogo, mismo locale—, lo que lo convierte en red de verdad: si la migración lo rompe, rompió
algo. Una assertion en inglés no serviría, porque no distingue "resolvió" de "escribió la clave";
`users.deleteLabel` no es español.

Ese único test cubre cuatro invariantes a la vez: que el puente de locale existe, que corre antes que
el módulo, que SSR y cliente coinciden en idioma, y que la clave resuelve de verdad.

## Alcance

**Dentro:**

- `languages-editor.ts`, `users-editor.ts`, `import-export-editor.ts` → `ct`
- Los tres `<script define:vars>` de i18n, sus objetos de frontmatter y los tipos `XI18n`
- `confirmUnavailable` revive; `loading` muere como código muerto
- `ct` avisa en desarrollo
- Las dos assertions de `tests/import-export-admin-ui.test.js` que **exigen** el puente se invierten
- Test e2e en español para las tres páginas
- Los comentarios que mienten: `languages.astro:20` y `users.astro:19` dicen `is:inline` sobre
  consumidores que hoy son módulos empaquetados
- `docs/CONTEXT.md` §3 y §4, `docs/specs/` (ver `spec-delta.md`), ADR-0039

**Fuera:**

- **`layout.astro`** (`__cmsAuthI18n`, `__cmsLayoutI18n`) — excepción time-boxed con dueño: #106 la
  extrae a `client/layout.ts`. Meterse ahora duplica trabajo y colisiona.
- **`cache.astro`** — su `define:vars` se consume en el mismo script inline y no tiene módulo cliente
  al que migrar. Es "página sin módulo", otro refactor.
- **`ConfirmDialog.astro` / `AlertDialog.astro`** — pasan cadenas por **props**, no por `window`. Es
  composición legítima de Astro, no un puente.
- **`getCmsUiLocale`** — es el cimiento sobre el que `ct` funciona.
- **Estrechar `ct(key: string)` a `CatalogKey`** — se evaluó y se sacó. `messageKey` viaja sin tipar
  desde `utils/block-validation.ts:227` hasta `localizedJsonError` en dos handlers de API, así que
  hacerlo bien obliga a que `src/utils/` importe del panel: una flecha de núcleo a presentación que es
  una pregunta de capas, no un detalle de esta migración. **Issue de seguimiento.**

## Criterios de aceptación

- [ ] Los tres editores usan `ct`; no queda `window.__cmsLanguagesI18n` / `__cmsUsersI18n` /
      `__cmsImportExportI18n` en el repo
- [ ] Los tres `<script define:vars>` de i18n y sus tipos `XI18n` están borrados
- [ ] No queda ninguna lectura `as unknown as` de i18n en esos tres módulos
- [ ] `import-export` muestra el mensaje de confirmación no disponible **en el idioma del panel**
- [ ] El puente de `layout.astro` y el de locale siguen intactos
- [ ] Un `ct` con clave inexistente avisa en consola en desarrollo, y calla en producción
- [ ] `e2e/admin-i18n-es.spec.ts` pasa **antes** de migrar y sigue pasando después
- [ ] `docs/CONTEXT.md` §3/§4 y los specs vivos ya no señalan el puente como la vía de las cadenas
- [ ] `typecheck` + `test` + `biome ci` + Playwright verdes
