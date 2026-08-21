<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — i18n-bridge-to-ct

Cómo se ejecuta la migración descrita en `proposal.md`, y las tres decisiones de diseño que no son
obvias: el orden de los commits, el mapeo propiedad→clave, y la forma del aviso de `ct`.

---

## 1. La forma del cambio, por fichero

Cada página pierde exactamente un bloque y conserva todo lo demás.

**`.astro` — se borra el objeto de frontmatter y su script:**

```diff
  const t = createT(uiLocale);
- // Strings injected into the is:inline script via a define:vars bridge script
- const usersI18n = {
-   dialogTitle: t('users.modalTitle'),
-   …
- };
  ---
  <AdminLayout site={site} title={t('users.title')}>   ← intacto
    …
-   {/* i18n bridge: define:vars publishes the strings; the module script consumes them. */}
-   <script define:vars={{ usersI18n }}>
-     window.__cmsUsersI18n = usersI18n;
-   </script>
    <script>
      import('./client/users-editor.js').then(…)      ← intacto
    </script>
```

`resolveUiLocale` y `createT` **se quedan** en el frontmatter. Son el SSR de la página: `title`,
`eyebrow`, `<h1>`, `lead`, cabeceras de tabla. Borrarlos vacía la página.

**`client/*.ts` — se borra el tipo, el accessor y todos los `i18n.X`:**

```diff
- type UsersI18n = { dialogTitle: string; … };
-
- function getI18n(): UsersI18n {
-   return (getCmsWindow() as unknown as { __cmsUsersI18n?: UsersI18n })
-     .__cmsUsersI18n as UsersI18n;
- }
+ import { ct } from '../i18n/client.js';
  …
- const i18n = getI18n();
- btn.textContent = i18n.deleteLabel;
+ btn.textContent = ct('users.deleteLabel');
```

Los comentarios de cabecera de `users-editor.ts:14-15` y `languages-editor.ts:14-15` describen el
puente; se reescriben. Los de `languages.astro:20` y `users.astro:19` dicen `is:inline` sobre un
consumidor que hoy es un módulo empaquetado: mienten desde antes de este cambio y se van con el
bloque que anotan.

---

## 2. El mapeo — por qué NO se puede automatizar

**El nombre de la propiedad del puente no es la clave del catálogo.** Esa capa de renombrado es
precisamente la complejidad accidental que se borra, y es también la razón de que un `sed` produzca
basura silenciosa: `ct('users.dialogTitle')` compila, no existe en el catálogo, y renderiza
`users.dialogTitle` en pantalla.

El port se hace leyendo la clave real del `.astro`, propiedad a propiedad. Las tablas siguientes son
esa lectura, ya hecha. ⚠️ marca las que **no** derivan del nombre.

### `languages.astro:22-40` → 19 propiedades

| Propiedad del puente | Clave de catálogo | |
|---|---|---|
| `statusActive` | `languages.statusActive` | |
| `statusDisabled` | `languages.statusDisabled` | |
| `isDefaultYes` | `languages.isDefaultYes` | |
| `editLabel` | `common.edit` | ⚠️ otro namespace |
| `deleteLabel` | `languages.deleteLabel` | |
| `newForm` | `languages.newForm` | |
| `editForm` | `languages.editForm` | |
| `createBtn` | `languages.createBtn` | |
| `saveBtn` | `common.save` | ⚠️ otro namespace |
| `loadError` | `languages.loadError` | |
| `deleteError` | `languages.deleteError` | |
| `saveError` | `languages.saveError` | |
| `validationTitle` | `languages.validationTitle` | |
| `codeObligatory` | `languages.codeObligatory` | |
| `deleted` | `languages.deleted` | |
| `created` | `languages.created` | |
| `updated` | `languages.updated` | |
| `dialogTitle` | `languages.modalTitle` | ⚠️ nombre distinto |
| `deleteConfirmTemplate` | `languages.deleteConfirm` | ⚠️ nombre distinto |

### `users.astro:21-42` → 22 propiedades

| Propiedad del puente | Clave de catálogo | |
|---|---|---|
| `dialogTitle` | `users.modalTitle` | ⚠️ nombre distinto |
| `roleOwner` | `users.roleOwner` | |
| `roleUser` | `users.roleUser` | |
| `editLabel` | `common.edit` | ⚠️ otro namespace |
| `deleteLabel` | `users.deleteLabel` | |
| `newForm` | `users.newForm` | |
| `editForm` | `users.editForm` | |
| `createBtn` | `users.createBtn` | |
| `saveBtn` | `common.save` | ⚠️ otro namespace |
| `deleteConfirm` | `users.deleteConfirm` | |
| `cannotDeleteLastOwner` | `users.cannotDeleteLastOwner` | |
| `emailRequired` | `users.emailRequired` | |
| `passwordRequiredNew` | `users.passwordRequiredNew` | |
| `loadError` | `users.loadError` | |
| `saveError` | `users.saveError` | |
| `deleteError` | `users.deleteError` | |
| `deleted` | `users.deleted` | |
| `updated` | `users.updated` | |
| `created` | `users.created` | |
| `noDate` | `common.noDate` | ⚠️ otro namespace |
| `countLabel` | `users.count` | ⚠️ nombre distinto |
| `loading` | `users.loadingUsers` | ⚠️ **código muerto — no se porta** |

`loading` se publica y se tipa, y no lo lee nadie: el texto de carga se conmuta con `cms-hidden`,
nunca se reescribe. Muere con el puente, sin ceremonia y sin commit propio.

### `import-export.astro:23-44` → 22 publicadas + 1 declarada

| Propiedad del puente | Clave de catálogo | |
|---|---|---|
| `statusIdle` | `importExport.status.idle` | ⚠️ clave anidada |
| `statusExporting` | `importExport.status.exporting` | ⚠️ |
| `statusUploading` | `importExport.status.uploading` | ⚠️ |
| `statusValidating` | `importExport.status.validating` | ⚠️ |
| `statusImporting` | `importExport.status.importing` | ⚠️ |
| `statusDone` | `importExport.status.done` | ⚠️ |
| `statusError` | `importExport.status.error` | ⚠️ |
| `noUnitsSelected` | `importExport.noUnitsSelected` | |
| `noFileSelected` | `importExport.noFileSelected` | |
| `importNetworkError` | `importExport.importNetworkError` | |
| `exportNetworkError` | `importExport.exportNetworkError` | |
| `confirmReplace` | `importExport.confirmReplace` | |
| `confirmReplaceWarning` | `importExport.confirmReplaceWarning` | |
| `usersSessionWarning` | `importExport.usersSessionWarning` | |
| `confirmTitle` | `importExport.confirmTitle` | |
| `confirmBtn` | `importExport.confirmBtn` | |
| `download` | `importExport.download` | |
| `upload` | `importExport.upload` | |
| `manifestTitle` | `importExport.manifestTitle` | |
| `manifestVersion` | `importExport.manifestVersion` | |
| `manifestExportedAt` | `importExport.manifestExportedAt` | |
| `manifestCount` | `importExport.manifestCount` | |
| — **nunca publicada** — | `importExport.confirmUnavailable` | ⚠️ **el bug** |

`confirmUnavailable` está en el tipo (`import-export-editor.ts:47`) y se lee en `:311`, dentro de
`i18n.confirmUnavailable || 'Confirm dialog is not available. Please reload the page.'`. El `||`
absorbe el `undefined`, así que el síntoma es inglés, no `"undefined"`. Pasa a
`ct('importExport.confirmUnavailable')` **sin `||`**: la clave existe en `en.ts:355` y `es.ts:353`, y
el fallback de `t.ts` ya cubre el caso imposible.

**Total: 63 cadenas publicadas, de las cuales 62 se portan (`loading` se descarta), más
`confirmUnavailable` que se recupera. 63 llamadas `ct` distintas.** El número de *call sites* puede
ser mayor si una propiedad se lee en dos sitios; se resuelve leyendo cada `i18n.X` del módulo.

Todas las claves existen ya en `en.ts` y `es.ts`. **Cero claves nuevas, cero cambios de paridad.**

---

## 3. El aviso de `ct`

`ct` resuelve el locale en cada llamada y delega en `createT`, cuyo fallback (`t.ts:29`) es
catálogo activo → `en` → **la clave como texto**. Ese sentinela se conserva: es el que hace visible el
fallo en la UI.

Lo que se añade es voz, y solo en desarrollo:

```ts
export function ct(key: string, params?: Record<string, string | number>): string {
  const tFn: TranslateFn = createT(getUiLocale());
  const value = tFn(key, params);
  if (typeof window !== 'undefined' && import.meta.env.DEV && value === key) {
    console.warn(`[astro-blocks] i18n key not found: "${key}"`);
  }
  return value;
}
```

**La detección es `value === key`**, no una consulta al catálogo. Es exactamente la condición que
`t.ts` produce al agotar la cadena de fallback, así que no duplica la lógica de resolución: observa su
resultado. Un caso patológico —una clave cuyo valor traducido sea idéntico a la clave— daría un falso
positivo en consola y ningún daño.

**El guard de `window` es load-bearing.** `tests/i18n-client-editors.test.js` importa el `dist/`
crudo con Node, donde `import.meta.env` es `undefined`; el primer operando corta esa lectura fuera de
Vite. El segundo queda como una expresión Vite directa, por lo que el build de producción la repliega
y elimina el aviso entero del **bundle del consumidor**. `dist/` es el espejo TypeScript publicado
por el paquete, no un bundle Vite: conserva `import.meta.env.DEV` para que el consumidor lo
transforme. El acceso seguro `import.meta.env?.DEV` parece equivalente, pero impide ese dead-code
elimination y deja el aviso en el bundle del consumidor.

**Se descartó el sentinela visible en dev** (renderizar `⟦users.deleteLabel⟧`). El arnés e2e levanta
un **build de producción** (`playwright.config.ts:41`: `dist/server/entry.mjs`), donde ese sentinela no
existiría — daría falsa confianza justo en el entorno donde la red tiene que morder. El warn en dev
más la assertion en español cubren los dos entornos sin inventar un tercer comportamiento.

**Se descartó el warn en producción.** Un fallo de traducción sería ruido en la consola de un usuario
final que no puede hacer nada, y contaminaría cualquier monitorización.

---

## 4. La red, y por qué va primero

`e2e/admin-i18n-es.spec.ts` carga las tres rutas con `Accept-Language: es` y **sin cookie**, y afirma
una cadena en español por página.

Funciona porque `resolveUiLocale` (`resolve.ts:117-127`) tiene precedencia cookie → `Accept-Language`
→ `en`: sin cookie y con `es`, el SSR resuelve `es`, `layout.astro:523` publica
`window.getCmsUiLocale`, y `ct` lo lee. Las tres páginas renderizan dentro de ese layout —
`languages.astro:44`, `users.astro:46`, `import-export.astro:56` — así que el publisher siempre corre.

**El test pasa antes de migrar.** Mismo catálogo, mismo locale: el puente ya entrega español en ese
escenario. Eso es lo que lo convierte en red y no en decoración — se escribe contra el comportamiento
actual, y si la migración lo rompe, rompió algo de verdad.

Cubre cuatro invariantes con una sola prueba: que el puente de locale existe, que corre antes que el
módulo, que SSR y cliente coinciden en idioma, y que la clave resuelve en lugar de renderizarse cruda.
La última solo la distingue una assertion **en español**: `users.deleteLabel` no lo es.

**Sin guardia estática de orden.** Se evaluó un test que verificara por grep que el puente precede al
módulo en `layout.astro`, y se descarta porque afirmaría lo contrario de la verdad: el puente está en
la línea 519 y el `<slot />` en la 238 — el puente va *después* en el fuente y aun así gana, porque lo
que manda es script clásico inline frente a módulo diferido. Un grep de orden textual sería un test
que pasa cuando el código está mal.

---

## 5. Los tests que anclan el puente

`tests/import-export-admin-ui.test.js` tiene dos assertions que pinnean el **mecanismo**, no el
comportamiento, y que este cambio rompe por diseño:

- `:227-236` — el puente existe y asigna `__cmsImportExportI18n`
- `:457-464` — *"client must read from `window.__cmsImportExportI18n` bridge"*

**Se invierten, no se borran.** Pasan a exigir que el editor use `ct(` y que no quede ninguna
ocurrencia de `__cms` en los tres módulos. Un test que fija un mecanismo obsoleto se da la vuelta:
borrarlo sin más deja la puerta abierta a reintroducir el puente mañana.

El resto del fichero **no se toca**: la lista de 39 claves `importExport.*` (`:47-92`), la paridad
en→es del prefijo (`:94-101`) y los valores no vacíos (`:103-112`) verifican el catálogo, que sigue
siendo exactamente el mismo.

---

## 6. Orden de commits

La red primero, luego los dos fáciles, luego el difícil, luego los documentos.

| # | Tipo | Contenido |
|---|---|---|
| 1 | `test(e2e)` | `admin-i18n-es.spec.ts`. Verde contra el puente |
| 2 | `feat(admin)` | `ct` avisa en desarrollo |
| 3 | `refactor(admin)` | `languages` → `ct` |
| 4 | `refactor(admin)` | `users` → `ct` (y `loading` desaparece) |
| 5 | `refactor(admin)` | `import-export` → `ct`, `confirmUnavailable` revive, assertions invertidas |
| 6 | `docs` | `CONTEXT.md` §3/§4, specs vivos, ADR-0039 |

`import-export` va **el último a propósito**: es el que tiene más claves, el desajuste conocido y los
tests que invertir. Que los dos primeros validen el patrón antes de entrar ahí.

**Se descartó agrupar por capa** (primero los tres `.astro`, luego los tres módulos): dejaría el árbol
roto entre commits — borrar un `define:vars` sin haber migrado el módulo que lo lee es exactamente el
`TypeError` que hoy actúa de canario. Cada commit deja el árbol verde.

Versión: **patch**, y solo al cierre.
