<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0033 — El módulo del bake es isomorfo; el fallo devuelve un union, no un Response

- **Status:** Accepted — 2026-07-20
- **Date:** 2026-07-20
- **Decisores:** Nauel Gómez
- **Source:** Issue [#116](https://github.com/NauelG/astro-blocks/issues/116) (P1, refactor), grilled 2026-07-20
- **Relación:** implementa el mecanismo que describen ADR-0009 (bake-as-resolution para la registry)
  y ADR-0025 (mismo patrón para el schema map), y da forma a lo que la spec
  `runtime-artifact-resolution.md` R4/R8 exige. No reemplaza a ninguno: aquellos deciden *que* se
  hornea y *que* falla fuerte; este decide *dónde vive* el mecanismo que ambos re-enseñan.

## Contexto

El *bake* es una interfaz superficial: su contrato entero —doble `JSON.stringify` al escribir,
guarda `typeof raw === 'string'` + `JSON.parse` + chequeo de forma + fallback al leer— está
recopiado en cada uno de los 7 lectores estructurados. Es el invariante con peor historial de bugs
del repo, y cada incidente tuvo la misma forma: un lector que decodificaba distinto de sus hermanos
(registry 404 → ADR-0009; schema map 500 → #101/ADR-0025; `allowedFileTypes` single-encoded → el 415
de `video/mp4`).

La issue #116 proponía un único `readBakedValue<T>({ decode, fallback, onUnresolved })`. Al llevarlo
al código aparecieron tres cosas que esa firma no puede satisfacer, y que juntas dictan el diseño.

**Primero: hay dos clases de valor, no una.** Para la registry y el schema map, ausencia significa
*despliegue roto* — no hay fallback legítimo, debe fallar fuerte. Para el allowlist, los tipos
custom y los límites por categoría, ausencia significa *dev/test* — y caer al default es correcto y
documentado. Dar a cada llamante un `fallback` **y** un `onUnresolved` a la vez le devuelve
exactamente la decisión que el módulo profundo debía absorber: *"¿puede faltar esta clave?"*. Y esa
respuesta es una propiedad de la **clave**, no del sitio que la lee.

**Segundo: dos de los siete lectores corren en el navegador.** `file-accept.ts` (vía la cadena de
`<script>` del admin) y la isla cliente de `media.astro`. Un `onUnresolved: () => Response`
construido con `localizedJsonError` arrastra los catálogos i18n al bundle del cliente. La
preocupación de servidor no puede vivir en un módulo que también ejecuta el navegador.

**Tercero: el fallback de la clase A es una lectura de disco, y disco es solo-Node.** La registry y
el schema map no van baked→fallo; van baked→`import()` de `.astro-blocks/*.mjs`→fallo. Ese paso
intermedio usa `path`, `pathToFileURL` y un `import()` dinámico. Ninguno puede existir en un módulo
browser-safe.

## Decisión

**El módulo `src/utils/baked.ts` es isomorfo, y absorbe el *mecanismo*, no la *resolución*.**

Se queda con: el conocimiento del doble encode (`defineBakedValue`), la guarda + parse + validación
(`decodeBaked`, que nunca lanza), la variante de config con default (`readBakedConfig`), la variante
de artifact que devuelve el union (`readBakedArtifact`), y la **definición única** del union
`BakedResolution<T>`. No importa ningún `node:*` ni ningún catálogo i18n, y un test lo verifica
mecánicamente.

**El fallo se representa como un union, no como un `Response`.** `readBakedArtifact` devuelve
`{ ok: false; reason: 'unresolved' }`. El llamante de servidor —`route-table`, `schema-loading`— es
quien, ante ese union, ejecuta su lectura de disco de dev/test y, solo si *esa* también falla,
construye el 500 con `localizedJsonError`. El módulo sabe *cómo* se detecta que un valor no resolvió;
el llamante sigue siendo dueño de *qué* significa que no resuelva.

Dicho de otro modo: la frontera del módulo cae entre "decodificar el bake" (dentro, isomorfo) y
"leer disco / emitir un 500" (fuera, servidor). Es la línea que la firma de #116 —una sola función
que devuelve `Response`— habría borrado.

**La clase la elige el entrypoint, no un parámetro** (spec R12). `readBakedConfig` para las 5 claves de config,
`readBakedArtifact` para las 2 de artifact. Ninguna función toma a la vez `fallback` y un callback de
fallo duro.

## Consecuencias

**A favor.** El doble encode y el union dejan de re-teclearse en 7 sitios; el bug de decode-divergente
que ya costó tres incidentes deja de tener superficie donde reaparecer. El módulo es unit-testeable
directo contra un `import.meta.env` simulado, lo que retira la guarda source-regex de
`schema-map-bake-guard.test.js` que su propio comentario admite que "no puede fallar" de forma fiable.
Y unificar los tres lectores del allowlist corrige de paso una divergencia real de comportamiento (ver
abajo).

**El coste, y es deliberado.** No es un módulo que "hace todo con el bake". Deja fuera, a propósito,
la lectura de disco y el `Response` —porque meterlos dentro rompería el isomorfismo— y deja fuera las
6 claves escalares de encode simple, porque nunca tuvieron el hazard y meterlas obligaría a
`defineBakedValue` a tomar un parámetro de clase, reabriendo la decisión que existe para cerrar. Un
lector que solo mire `baked.ts` verá un módulo que decodifica pero no resuelve, y podría leerlo como
incompleto. No lo es: la resolución de la clase A es Node-only por naturaleza y vive donde debe.

**Cambio de comportamiento arrastrado, y asumido.** Unificar los tres lectores de
`ALLOWED_FILE_TYPES` los obliga a compartir validador. Antes `media.astro` y `file-accept.ts` solo
exigían `length > 0` y casteaban `as string[]` sin validar, así que un `[123]` llegaba al atributo
`accept` como basura y un allowlist vacío caía al catálogo por defecto. El decoder compartido
(`decodeAllowlist`) corrige ambas: rechaza los elementos no-string y trata `[]` como valor.

Un matiz que apareció en la revisión y conviene dejar escrito para no sobre-afirmar: el atributo
`accept` **es una pista del picker, nunca el gate** — el servidor es quien aplica el allowlist. Para
`allowedFileTypes: []` el `accept` resultante queda vacío, y en HTML un `accept=""` se interpreta como
*acepta cualquier cosa* en el diálogo del sistema. Es decir, el picker no puede expresar "no ofrezcas
nada" para esa config; es un desajuste cosmético, porque el servidor rechaza igualmente cada archivo.
Lo que el refactor entrega de verdad es el decoder único (fin del drift entre lectores) y el rechazo
de basura, no que el picker ofrezca nada con un allowlist vacío. Es un cambio de comportamiento dentro
de un trabajo etiquetado refactor: se declara como tal en el spec-delta de `media-uploads.md`, en vez de colarse
como efecto colateral.

**Si algún día cambia.** Si apareciera una tercera clase de clave —por ejemplo una que quiera
degradar a un valor parcial en vez de fallar o defaultear— la vía no es añadir parámetros a las
funciones existentes, sino un tercer entrypoint con su nombre. La regla que este ADR fija es *una
función por semántica de ausencia*, no *una función configurable*.
