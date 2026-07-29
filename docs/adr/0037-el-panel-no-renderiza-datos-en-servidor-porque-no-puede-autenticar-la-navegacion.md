<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0037 — El panel no renderiza datos en servidor, porque no puede autenticar la navegación

- **Status:** Accepted — 2026-07-28
- **Date:** 2026-07-28
- **Decisores:** Nauel Gómez
- **Source:** Hallado el 2026-07-27 implementando [#104](https://github.com/NauelG/astro-blocks/issues/104); evaluación de impacto en advisory privada (`SECURITY.md`)
- **Relación:** generaliza [ADR-0036](./0036-el-handler-es-la-unica-implementacion-del-listado-de-media.md)
  de una página a todo el panel. No toca ADR-0027 (identidad y `tokenVersion`), y **preserva** la
  postura anti-CSRF que documenta `api/handlers/media.ts`.

## Contexto

Las páginas del panel renderizaban su contenido en el HTML inicial: `/cms/pages` emitía id, título,
slug, estado e indexable de cada página; el dashboard los recuentos más las cinco páginas modificadas
más recientemente; `configs`, `redirects`, `languages` y `menus` sus listas completas. Ese HTML no
está protegido: no hay middleware, y el frontmatter de `layout.astro` no llama ni a `getAuth` ni a
`Astro.redirect` — el formulario de login es un `div cms-hidden` que revela el JS de cliente.

La lectura evidente es «añade un guard de auth al layout». **No funciona, y el porqué decide el
cambio entero.**

`getAuth` (`api/handlers/auth-core.ts:131-141`) toma el token de la cabecera `Authorization` o
`x-cms-token`. El cliente lo guarda en `sessionStorage`. **Ninguno de los dos viaja en una navegación
de página** — el navegador manda cookies, y la única que existe es `cms-ui-locale`, que resuelve el
idioma de la interfaz.

Es decir: en una petición de página el servidor **no tiene credencial que comprobar**. La auth del
panel es de cliente no por descuido sino porque el transporte de sesión no deja otra. Un guard añadido
hoy sería una comprobación sin nada que comprobar.

## Decisión

**Ninguna página del panel renderiza datos de contenido en servidor. Un `.astro` del admin puede
llamar a `loadSite()` y a nada más.** Los datos llegan por `/cms/api/*`, que autentica cada petición,
y por ningún otro camino.

Se elimina la exposición en su origen: no hay nada que filtrar porque no hay nada en el HTML.

**Se rechaza explícitamente la cookie de sesión**, que era la alternativa real. Habría permitido que
el servidor autenticara la navegación y respondiera 302 o 404 a un no autenticado — más de lo que este
cambio logra. Pero `api/handlers/media.ts` documenta que el CSRF **no** es un problema para la API
*precisamente porque* el token nunca es ambiental: «una página cross-origin no puede forjar una
petición autenticada». Introducir una credencial ambiental obliga a rederivar ese razonamiento en cada
endpoint que muta estado. Es una decisión con su propio ciclo y su propio ADR, no un detalle de
implementación de este.

**`loadSite()` es la única excepción, y es deliberada.** `site.json` contiene solo marca pública
—nombre, baseUrl, favicon, logo, colores, SEO por defecto, estrategia de rutas i18n— que ya se
renderiza en el sitio público. Mantenerla en servidor es lo que permite que el shell pinte con la
marca puesta y sin destello, y el escenario S3 de `admin-html-rendering.md` ya daba por hecho que la
pantalla de login no autenticada renderiza `site`.

**El dato SSR ya estaba muerto, y eso es lo que hace barata la decisión.** `pages`, `configs`,
`redirects` y `languages` refetchean incondicionalmente al cargar y reemplazan lo que el servidor
mandó (`page-editor.ts:1071`, `configs-editor.ts:189`, `languages-editor.ts:354`, y el `refresh()` de
`createListEditor`). El comentario de `page-editor.ts:1069-1070` —«la tabla la renderiza el SSR, así
que un fallo aquí no deja la pantalla en blanco»— describe un respaldo que este ADR retira a
conciencia: el error ya se reporta por `reportFailure`, que pasa a ser el único camino, visible en vez
de enmascarado.

## Consecuencias

**A favor.** La superficie de exposición desaparece sin credencial nueva, sin cookie y sin superficie
de ataque nueva; la postura anti-CSRF de la API queda intacta. Un guard léxico sobre
`src/routes/admin/*.astro` convierte la regla en algo que CI comprueba, y cubre una página **nueva**
el día que se añade, sin que nadie recuerde extender un test. Y el panel gana una sola forma de
cargar: cada página pide sus datos a la API, en vez de dos orígenes que debían coincidir.

**El coste, y es real.** Cada página migrada pierde contenido en el primer paint y muestra una fila de
carga hasta que aterriza el fetch. Se conserva el `<thead>` para que no salte el layout, pero el dato
tarda más en verse que cuando venía en el HTML. En un panel autenticado que ya exige JS es un precio
aceptable; en otro contexto no lo sería.

Además, el dashboard pasa de no tener script de cliente a componer cuatro fetches. Se decidió
componer los endpoints existentes en vez de añadir `GET /cms/api/dashboard`: cero superficie de API
nueva, y el volumen descargado es el mismo que ya cargaba el SSR. Hay una tensión honesta con el
principio de ADR-0036 —el consumidor se trae listas enteras para derivar recuentos— y se acepta a
sabiendas: un endpoint agregado es un follow-up que debe nacer de evidencia de que duele, no de
especulación.

**Lo que este ADR NO decide.** Una ruta del panel sigue respondiendo **200** con su shell a cualquiera:
un extraño sabe que hay un CMS en `/cms` y ve la pantalla de login. Eso no es dato de contenido, y es
idéntico a lo que ocurría antes. Que `/cms` no exista para un no autenticado exige la cookie
rechazada arriba.

**Si algún día cambia.** Si se adopta la cookie de sesión, esta decisión **no** se revierte: seguiría
siendo correcto que el dato viva detrás de la API. La cookie añadiría una capa —poder rechazar la
navegación— sobre una regla que se sostiene por sí sola.
