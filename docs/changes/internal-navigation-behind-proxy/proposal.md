<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — La navegación interna se reconoce detrás de un proxy TLS

_Reportado desde el entorno de dev de Mas Jofre. Grilled 2026-10-29. Seguimiento: [#192](https://github.com/NauelG/astro-blocks/issues/192)._

## El problema

En un sitio con `publicRendering: 'server'` servido detrás de un proxy que termina TLS, el visitante
no puede volver al idioma por defecto. Estando en `/es`, pulsa "CA" en el selector (enlace a `/`) y
vuelve a aterrizar en `/es`.

La **root locale redirect** omite la redirección cuando la petición es una **internal navigation**
— llegar a `/` desde dentro del sitio *es* elegir el idioma por defecto —. Hoy eso se decide
comparando el *origin* completo del `Referer` con el de la petición (`hasSameOriginReferrer`,
`src/utils/localization.ts`). Detrás del proxy:

- el navegador envía `Referer: https://host/es`;
- el adaptador de Node construye `Astro.request.url` como `http://host/`: el protocolo sale solo de
  si el socket está cifrado y `X-Forwarded-Proto` no se consulta nunca, ni con `allowedDomains`
  (`astro/dist/core/app/node.js`, Astro 7.1.1).

Los *origins* no coinciden, la petición se trata como externa, se lee la **locale preference**
(`es`) y se redirige a `/es`. En local no se reproduce porque todo va por `http`. El consumidor no
puede arreglarlo desde su configuración de Astro: el workaround actual de Mas Jofre es un
middleware propio.

## Reglas acordadas

1. **Internal navigation = mismo hostname.** Se compara el `hostname` del `Referer` con el de la
   petición. Protocolo y puerto se ignoran deliberadamente.
2. **`www.` es equivalente al dominio desnudo.** Antes de comparar se elimina **un único** `www.`
   inicial de ambos hostnames. Cualquier otro subdominio sigue siendo distinto (`dev.host` ≠ `host`,
   `www2.host` ≠ `host`). Sin Public Suffix List ni otras heurísticas.
3. **Sin `Referer` (o inválido) = externa.** El servidor no puede distinguir "escribió la URL" de
   "pulsó el selector con el Referer suprimido"; proteger el primer caso es el motivo de existir de
   la redirección. Queda documentado como limitación conocida.
4. **Nada más cambia**: solo `/`, solo `publicRendering: 'server'`, precedencia cookie →
   `Accept-Language`, `302`, persistencia de la locale preference.

## Non-goals

- **La caché de `/`** (#192): con la caché caliente la root locale redirect no se ejecuta ni se
  actualiza la locale preference. Requiere su propio ciclo y ADR.
- **Una señal explícita en el selector** (`?lang=`, ruta o cookie propia) que no dependa del
  `Referer`. Cambiaría el contrato con el consumidor.
- **Confiar en `X-Forwarded-*`**: AstroBlocks no reinterpreta la URL que construye Astro.
- **Sin ADR**: la regla es fácilmente reversible y no resulta de un trade-off difícil de deshacer.

## Entregables

- `isInternalNavigation(requestUrl, referer)` sustituye a `hasSameOriginReferrer` (módulo interno,
  no exportado en `package.json`).
- Tests unitarios de la regla y del escenario de Mas Jofre sobre `resolveRootLocaleRedirect`.
- Nota en `README.md`: reenviar la cabecera `Host` en el proxy y no suprimir el `Referer` en la
  navegación interna.
- Spec viva nueva `docs/specs/public-locale-routing.md`.
- Glosario: *Root locale redirect*, *Locale preference*, *Internal navigation* (ya en
  `docs/CONTEXT.md`).
