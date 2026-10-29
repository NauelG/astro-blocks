<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — internal navigation behind a TLS proxy

## ADDED: Public locale routing (nueva spec `docs/specs/public-locale-routing.md`)

Capacidad nueva en la spec viva: cómo el sitio público decide el idioma de `/` y cómo recuerda la
elección del visitante. Hasta ahora solo estaba descrita en una nota del README.

- **R1 — Alcance de la root locale redirect.** Solo la evalúa la ruta pública `[...slug]` en
  `publicRendering: 'server'` (`page.astro`), y solo cuando el pathname es exactamente `/`. Ninguna
  otra ruta redirige por idioma; `page-static.astro` no la implementa.
- **R2 — La internal navigation nunca redirige.** Si la petición a `/` es una internal navigation,
  se sirve el home del idioma por defecto sin consultar cookie ni `Accept-Language`.
- **R3 — Internal navigation = mismo hostname.** Una petición es internal navigation si el
  hostname de su `Referer` coincide con el de la petición tras eliminar **un único** `www.` inicial
  de ambos. Protocolo y puerto se ignoran: detrás de un proxy que termina TLS el servidor ve `http`
  y el navegador envía `https`. Cualquier otro subdominio es distinto. Sin `Referer`, o con uno que
  no es una URL, la petición es externa.
- **R4 — Precedencia en peticiones externas.** (a) Si la locale preference es un idioma habilitado
  igual al por defecto, no hay redirección. (b) Si es un idioma habilitado distinto del por defecto
  con home publicado, `302` a su home. (c) Si no, se toma la **primera** entrada de
  `Accept-Language` (por orden de `q`) que resuelva a un idioma habilitado — por código exacto o por
  idioma base —; si ese idioma no es el por defecto y tiene home publicado, `302` a su home con
  `Vary: Accept-Language`. Si la primera coincidencia es el idioma por defecto, la búsqueda se
  detiene ahí. (d) Si no, no hay redirección.
- **R5 — La redirección conserva la query y fija la preferencia.** El destino es el path localizado
  del home más la query original, y la respuesta escribe el idioma destino como locale preference.
- **R6 — Cada página pública escribe su idioma.** Toda respuesta de `[...slug]` que no sea una root
  locale redirect persiste en `astroblocks-locale` el idioma resuelto de su URL (solo idiomas
  habilitados; `Path=/`, un año, `SameSite=Lax`, `HttpOnly`). Así, una internal navigation a `/`
  devuelve la preferencia al idioma por defecto.
- **R7 — Limitaciones conocidas.**
  - El hostname de la petición sale de la cabecera `Host`: un proxy que no la reenvía rompe R3.
  - Un sitio que suprime el `Referer` en la navegación interna (`Referrer-Policy: no-referrer`)
    hace que el selector no pueda volver al idioma por defecto (R3: sin `Referer` = externa).
  - Una respuesta de `/` servida desde la caché de rutas no evalúa R2–R6 (#192).
- **R8 — Cobertura.** `tests/localization.test.js` fija R3 (protocolo, puerto, `www.`, otros
  subdominios, otro host, Referer ausente o inválido) y el escenario detrás de proxy de R2:
  petición `http://host/`, `Referer: https://host/es`, preferencia `es` → sin redirección.
