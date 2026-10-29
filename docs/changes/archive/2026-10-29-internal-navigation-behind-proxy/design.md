<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — `isInternalNavigation` compara hostnames

## La función

En `src/utils/localization.ts`, `hasSameOriginReferrer` se **renombra y reescribe** como:

```ts
export function isInternalNavigation(
  requestUrl: URL,
  refererValue: string | null | undefined,
): boolean;
```

1. `refererValue` vacío tras `trim` → `false`.
2. `new URL(refererValue)` lanza → `false`.
3. Devuelve `siteHostname(referer.hostname) === siteHostname(requestUrl.hostname)`.

Con un helper privado del módulo:

```ts
function siteHostname(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}
```

- `URL.hostname` ya llega en minúsculas, sin puerto y con IDN en punycode: no hace falta normalizar
  más.
- Se elimina **un** `www.` y solo al inicio (`www.www.host` → `www.host`). No se generaliza a otros
  prefijos.
- El esquema del `Referer` no se filtra. Un `Referer` con esquema no web (`android-app://…`) trae un
  hostname que no coincide y cae en externa por construcción; añadir una lista de esquemas
  permitidos no cambiaría ningún resultado real.

`resolveRootLocaleRedirect` sustituye su llamada (`if (isInternalNavigation(...)) return null;`).
No hay más consumidores: `localization.ts` no figura en `exports` de `package.json`, así que el
renombrado no es un cambio público.

## Lo que no se toca

- `src/routes/page.astro`: sigue pasando `Astro.request.url` y la cabecera `referer` tal cual.
- `src/routes/page-static.astro`: no tiene root locale redirect.
- Precedencia, `302`, `Vary: Accept-Language`, cookie `astroblocks-locale` y caché.

## Documentación de consumidor

`README.md:335` gana una frase tras la descripción existente, en inglés como el resto del README:

> The redirect is skipped when the visitor arrives at `/` from a page of the same site, detected
> through the `Referer` hostname (scheme, port and a leading `www.` are ignored). Behind a reverse
> proxy, forward the original `Host` header, and do not suppress the `Referer` on same-site
> navigation (e.g. `Referrer-Policy: no-referrer`), or your language switcher cannot return to the
> default locale.

## Tests (`tests/localization.test.js`, node:test)

El test de `hasSameOriginReferrer` se sustituye por uno de `isInternalNavigation` con
`requestUrl = new URL('http://example.com/')` (lo que ve el servidor detrás del proxy):

| Referer | Esperado |
|---|---|
| `https://example.com/es` | `true` — protocolo distinto |
| `http://example.com/es` | `true` |
| `https://example.com:8443/es` | `true` — puerto distinto |
| `https://www.example.com/es` | `true` — `www.` |
| `www.example.com` como petición, `https://example.com/es` | `true` — simetría |
| `https://dev.example.com/es` | `false` — otro subdominio |
| `https://www2.example.com/es` | `false` |
| `https://other.com/es` | `false` |
| `not-a-url`, `''`, `null` | `false` |

Y un test de escenario sobre `resolveRootLocaleRedirect` que reproduce Mas Jofre:
`requestUrl: http://example.com/`, `referer: https://example.com/es`, `cookieLocale: 'es'`,
`defaultLocale: 'ca'`, `availableLocales: ['ca', 'es']` → `null`.

Los tests importan desde `dist/`, así que corren tras el build de `npm test`.
