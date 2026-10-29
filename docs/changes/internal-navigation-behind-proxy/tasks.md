<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# tasks — internal-navigation-behind-proxy

`proposal.md` · `design.md` · `spec-delta.md` · Seguimiento fuera de alcance: [#192](https://github.com/NauelG/astro-blocks/issues/192)

Cuatro commits. **Cada uno deja el árbol verde**: `npm run typecheck`, `npm test` y `npm run check`
pasan antes de commitear. Disciplina TDD en el slice 2: test que falla → mínimo código para pasarlo →
refactor → commit.

---

## Slice 1 — Artefactos del cambio y glosario

- [x] **T1.1 — Commit de la propuesta.** `docs/changes/internal-navigation-behind-proxy/`
      (`proposal.md`, `design.md`, `spec-delta.md`, `tasks.md`).

      `docs(changes): propose recognising internal navigation behind a TLS proxy`

- [x] **T1.2 — Commit del glosario.** `docs/CONTEXT.md` §3: *Root locale redirect*, *Locale
      preference*, *Internal navigation* (ya redactados durante el grilling).

      `docs(context): define root locale redirect, locale preference and internal navigation`

      **Verificación:** `npm run check` (Biome no formatea Markdown, pero el gate debe pasar igual) y
      `git show --stat HEAD~1 HEAD` — solo esos ficheros.

---

## Slice 2 — La regla: `isInternalNavigation`

`fix(routing): recognise internal navigation behind a TLS-terminating proxy`

- [x] **T2.1 — Test primero (rojo).** En `tests/localization.test.js`:
      - Cambiar el import `hasSameOriginReferrer` → `isInternalNavigation`.
      - Sustituir el test `hasSameOriginReferrer validates same-origin navigation` (`:91-97`) por
        uno de `isInternalNavigation` con `requestUrl = new URL('http://example.com/')` y la tabla de
        `design.md` § *Tests*: protocolo distinto, `http` igual, puerto distinto, `www.` en el
        Referer, `www.` en la petición (simetría) → `true`; `dev.`, `www2.`, otro host, `not-a-url`,
        `''`, `null` → `false`.
      - Añadir el escenario detrás de proxy sobre `resolveRootLocaleRedirect`: `requestUrl:
        http://example.com/`, `referer: https://example.com/es`, `cookieLocale: 'es'`,
        `availableLocales: ['ca', 'es']`, `defaultLocale: 'ca'`, `hasPublishedHome: () => true` →
        `null`.

      **Verificación:** `npm test` **falla** — el import no existe en `dist/utils/localization.js`.
      Comprobar que el escenario de proxy también fallaría por la razón correcta: con el código
      actual, `resolveRootLocaleRedirect` devuelve `{ locale: 'es', source: 'cookie' }` (ejecutarlo
      a mano contra el `dist/` actual antes de tocar `src/`).

- [x] **T2.2 — Implementar (verde).** En `src/utils/localization.ts`, según `design.md` § *La
      función*:
      - Helper privado `siteHostname(hostname)` que elimina un único `www.` inicial.
      - `hasSameOriginReferrer` → `isInternalNavigation`; compara
        `siteHostname(refererUrl.hostname) === siteHostname(requestUrl.hostname)`.
      - `resolveRootLocaleRedirect` (`:285`) llama a `isInternalNavigation`.

      **Verificación:** `npm test` verde, incluidos los tres tests existentes de
      `resolveRootLocaleRedirect` (`:99-139` y siguientes) sin modificarlos.

- [x] **T2.3 — Barrido del nombre viejo.** `rg hasSameOriginReferrer src tests` no devuelve nada.
      (Menciones en `docs/changes/` del propio cambio son esperadas.)

      **Verificación:** `npm run typecheck` · `npm test` · `npm run check`.

---

## Slice 3 — README de consumidor

`docs(readme): explain how the root locale redirect detects same-site navigation`

- [x] **T3.1 — Ampliar la nota de `README.md:335`** con el párrafo exacto de `design.md`
      § *Documentación de consumidor* (inglés, como el resto del README). La nota queda en el mismo
      bloque `>` tras la frase existente.

      **Verificación:** lectura del bloque renderizado; `npm run check`. `AGENTS.consumer.md` **no**
      se sincroniza: no cambian API pública, opciones, rutas ni env vars, y no menciona la
      redirección (comprobado).

---

## Gates finales antes de Review

- [ ] `npm run typecheck` · `npm test` · `npm run check` · `npm run features:validate` ·
      `npm run e2e` (no hay e2e de la redirección pública; debe seguir verde sin cambios).

---

## Fuera de estos slices

- **`docs/specs/public-locale-routing.md`** — el `spec-delta.md` se aplica en la fase **Archive**.
- **Caché de `/`** — #192.
- **Playground** — no es una capacidad nueva; el comportamiento ya existía.
- **`page.astro`, `page-static.astro`** — sin cambios (`design.md` § *Lo que no se toca*).

## Cierre (solo cuando el humano lo pida)

Bump `patch` en `package.json` · entrada `### Fixed` en `CHANGELOG.md` · `src/meta/features.json` ·
`npm run features:validate` · badge de versión del `README.md` · commit y tag anotado `vX.Y.Z`.
