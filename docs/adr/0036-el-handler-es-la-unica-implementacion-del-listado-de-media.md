<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0036 — El handler es la única implementación del listado de media; el consumidor pide, no filtra

- **Status:** Accepted — 2026-07-27
- **Date:** 2026-07-27
- **Decisores:** Nauel Gómez
- **Source:** Issue [#104](https://github.com/NauelG/astro-blocks/issues/104) (P2, bug), grilled 2026-07-27
- **Relación:** extiende ADR-0020 (search + pagination server-side) sin reemplazarlo — ADR-0020 decidió
  *dónde* vive el pipeline; este decide *que no haya un segundo*. Toca la frontera que ADR-0023
  (catálogo/allowlist) define para la subida, y afina el vocabulario que
  [#102](https://github.com/NauelG/astro-blocks/issues/102) necesita sin responderlo.

## Contexto

ADR-0020 decidió que la búsqueda y la paginación de la biblioteca de media ocurren **una vez, en el
servidor**, compartidas por los dos consumidores, «en lugar de que cada uno reimplemente el filtrado
en cliente». El handler cumple esa decisión línea por línea. Los dos consumidores la reimplementan
igual, en los bordes que el ADR nunca miró.

El paint SSR de `media.astro` volcaba el registry **entero** sin ordenar ni cortar. El picker
filtraba por `accept` en cliente **después** del slice del servidor, de modo que el contador podía
decir «0 de N» mientras los ficheros que coincidían estaban en páginas posteriores, y `total` —y por
tanto el pager— contaba el conjunto sin filtrar.

Leer a los consumidores, y no solo al handler, cambió el diagnóstico dos veces.

**Primero: el grid SSR no era contenido lento, era contenido descartado.** `initMediaPage()` llama a
`loadMedia()` **incondicionalmente** en cada carga y `renderGrid()` reemplaza el contenedor entero. El
grid del servidor se construía, se serializaba, viajaba y se tiraba siempre. Y ni siquiera era usable
mientras existía: la toolbar nace `cms-hidden` y solo la revela `renderGrid()`, así que no se podía
buscar ni paginar hasta que aterrizaba el JS. No hay un solo `noscript` en `src/`.

**Segundo: había dos bugs latentes peores que el reportado**, y ambos con la misma raíz. El picker en
modo `image` no filtraba nada, así que ofrecía PDFs y vídeos como seleccionables y elegir uno metía la
URL de un PDF en el `url` de un campo de imagen. Y `computeEffectiveAccept` intersectaba el `accept`
declarado con el allowlist: si un prop declaraba `accept: ['application/pdf']` en una instancia que ya
había quitado PDF de `allowedFileTypes`, el resultado era `[]` —y la guarda `length > 0` desactivaba
el filtro entero, mostrando **todo**. Un allowlist más restrictivo producía un picker más permisivo.

La raíz común: **una sola variable, `effectiveAccept`, respondía dos preguntas distintas** — qué se
puede subir y qué se puede elegir de lo ya subido.

## Decisión

**1. `handleGetMedia` es la única implementación de «qué entradas se listan y en qué orden». Ningún
consumidor ordena, filtra ni corta por su cuenta.** Un consumidor que necesita otro conjunto lo pide
como parámetro y renderiza el sobre tal cual llega.

La consecuencia directa es que **la página de media no renderiza tarjetas en el servidor**: su
contenedor lleva una línea de carga localizada con `role="status"` y el cliente pide la página 1.
La tentación era la que propone el issue —que el SSR replique el pipeline (sort, slice, limit) para
emitir lo mismo que el endpoint. Se rechaza: eso conserva un payload que nadie lee, conserva el markup
de tarjeta duplicado y los tres formatters que `media.astro` copiaba byte a byte de `media-fetch.ts`
(sostenidos por un comentario de advertencia y un test), y **añade** una segunda implementación del
pipeline de ADR-0020 que mantener sincronizada con la primera. Se paga complejidad de sincronización
por contenido que se descarta milisegundos después.

Lo que se gana no es rendimiento sino una garantía: **`client/media.ts:renderCard` es el único
renderizador de tarjeta del código**. No hay una segunda implementación sobre la que primer paint y
re-render puedan discrepar. El comentario que decía *«este grid y el renderizado en servidor deben
coincidir, o el mismo fichero saca dos tiles distintos»* desaparece porque la condición que advertía
deja de existir.

**2. `GET /cms/api/media` acepta `?accept`, y NO lo intersecta con el allowlist.** Lista de MIMEs
separada por comas, comparación por **igualdad exacta** (nunca prefijo ni comodín), aplicada **junto a
`q` y antes de `total`** — esa posición es todo el arreglo del pager. Ausente o vacío = sin filtro. Un
MIME que el catálogo no conoce simplemente no coincide con nada: página vacía y **200**, no un error.

Aquí está la decisión que un lector futuro va a querer «arreglar», así que se dice en voz alta: **es
deliberado que este endpoint no consulte `getAllowedFileTypes()`**. El allowlist es la puerta de
**subida** (spec R7, R16); esto es una **lectura** sobre ficheros que ya están en disco. Intersectar
aquí significaría que encoger `allowedFileTypes` oculta recursos ya subidos que páginas publicadas
siguen referenciando, sin forma de que el owner vuelva a seleccionarlos. Parecería endurecimiento y
sería pérdida de datos diferida. Tampoco se rechaza con 400 un MIME fuera del allowlist: convertiría
un cambio de configuración en errores en pickers que ya tenían resuelto el accept anterior.

**3. `uploadAccept` y `browseAccept` son preguntas distintas y viven separadas.** `uploadAccept =
def.accept ∩ allowlist` gobierna el atributo `accept` del input de subida —ahí intersectar **sí** es
correcto, porque ofrecer subir lo que el servidor va a rechazar es mentir. `browseAccept = def.accept`
tal cual, o las filas del catálogo de la categoría del modo cuando el prop no declara ninguno, o vacío
para un `file` sin restricción; es lo que viaja en `?accept`.

Esta separación **no parchea** los dos bugs latentes: los hace imposibles. El picker de imagen recibe
un filtro no vacío por primera vez, y un prop cuyo `accept` declarado no está en el allowlist sigue
filtrando en vez de caer por la guarda `length > 0` hacia mostrarlo todo.

## Consecuencias

**A favor.** Un solo renderizador de tarjeta y un solo pipeline de listado; el HTML inicial deja de
cargar el registry completo; el contador y el pager del picker describen por fin el mismo conjunto,
así que `allLoaded = items.length >= total` es cierto cuando lo afirma. El picker pierde un filtro,
una guarda y una variable de módulo, y gana un campo en una llamada. Y el vocabulario queda escrito en
`CONTEXT.md §3`, que es lo que impide que alguien vuelva a colapsar los dos accept.

**El coste, y es deliberado.** Se pierde contenido en el primer paint: en una biblioteca grande el
usuario ve una línea de «cargando» durante todo el fetch, y ese fetch **no** es necesariamente corto,
porque `reconcileMedia()` toma el file lock de media, hace un `fs.access` por entrada y recorre
`public/uploads/**` completo en cada GET. Ese coste queda **explícitamente fuera** de este cambio: es
una decisión de rendimiento y concurrencia con sus propios compromisos (¿cuándo se podan las entradas
fantasma?) y mezclarla aquí haría el diff irrevisable y este ADR ambiguo sobre qué se decidió. Se
abre issue con la medición. La línea `role="status"` con `aria-live="polite"` existe precisamente
porque esa espera puede ser larga: un lector de pantalla se entera de que hay algo en curso.

Se rechazó también un skeleton de tarjetas fantasma, que daría mejor percepción y evitaría el salto de
layout. Ni `src/` ni `docs/DESIGN.md` tienen hoy ningún patrón de carga, así que sería CSS nuevo,
decidir cuántas tarjetas, animación con `prefers-reduced-motion` y una regla nueva en `DESIGN.md`: un
mini-proyecto de diseño dentro de un fix. `cms-muted` ya existe.

**Frontera con #102.** #102 observa que el `accept` por componente no se valida en la **subida** aunque
ADR-0018 (hoy reemplazado por ADR-0023) daba a entender que sí. Este ADR no lo resuelve: es otro
endpoint y otra pregunta. Lo que sí hace es dar nombre a las dos mitades, de modo que la conversación
de #102 pueda ser precisa —trata sobre hacer cumplir `uploadAccept` en el servidor— en vez de discutir
un «accept» ambiguo.

**Si algún día cambia.** Si un consumidor necesita un orden o un recorte distinto, la vía **no** es
volver a filtrar en el consumidor: es un parámetro nuevo del endpoint. Y si alguna vez hiciera falta
restringir la lectura por política, no se hace intersectando con el allowlist de subida —haría falta
un concepto propio, y su propio ADR.
