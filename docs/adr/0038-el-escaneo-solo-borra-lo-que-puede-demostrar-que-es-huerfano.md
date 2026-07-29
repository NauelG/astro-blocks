<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0038 — El escaneo solo borra lo que puede demostrar que es huérfano, y la prueba es la antigüedad

- **Status:** Accepted — 2026-07-29
- **Date:** 2026-07-29
- **Decisores:** Nauel Gómez
- **Source:** Issue [#164](https://github.com/NauelG/astro-blocks/issues/164), reenfocada tras reproducir la corrupción
- **Relación:** corrige una consecuencia no prevista de ADR-0017 (variantes) tal como interactúa con
  el escaneo de huérfanos de `reconcileMedia`. No reemplaza a ADR-0017: su decisión sobre qué se
  genera y cuándo sigue vigente.

## Contexto

`reconcileMedia` recorre `public/uploads/**` y borra todo fichero que case el patrón de variante y no
figure en el registro. La regla implícita era **«si no está registrado, es huérfano»**. Es falsa.

`generateAndPersistVariants` escribe cada fichero de variante a disco **sin sostener el lock de
media** y solo llama a `markMediaVariantsReady` al terminar. Entre la primera codificación y ese
registro hay ficheros reales que el registro desconoce. No es una ventana teórica: el cliente del
panel refetchea la lista **justo después** de subir, y esa lectura ejecuta el escaneo. O sea, la
petición que borra las variantes es la de la propia subida.

Reproducido: entrada `status: ready` declarando **8 variantes**, de las cuales **5 no existen en
disco**. Nada lo señala —la entrada se marca lista— y esas URLs viajan al `srcset` de las páginas
publicadas.

Dos creencias sobre este código eran erróneas y conviene dejarlas escritas, porque ambas apuntaban a
arreglos que no habrían funcionado:

- **«El lock protege esto.»** No. El escritor no lo sostiene. Escritor y escaneador nunca estuvieron
  serializados, así que ninguna forma de sostener el lock en `reconcileMedia` lo habría evitado.
- **«Basta con que reconcile lea bajo un lock compartido.»** `withFileLock` es una cadena FIFO de
  promesas por clave — un mutex simple **sin modo compartido**. Esa opción no era un ajuste: era
  construir un lock lector/escritor.

## Decisión

**El escaneo solo borra un fichero de variante cuando puede demostrar que es huérfano. La prueba es
la antigüedad: `mtime` anterior a `ORPHAN_MIN_AGE_MS` (5 minutos).** La ausencia en el registro pasa
a ser condición necesaria, no suficiente.

Cinco minutos supera con holgura cualquier codificación plausible —cuatro breakpoints × dos formatos,
imagen grande, servidor cargado— y no cuesta nada: un huérfano que sobrevive cinco minutos no molesta
a nadie, mientras que borrar una variante en vuelo es pérdida de datos silenciosa. La asimetría entre
ambos errores es lo que fija el umbral, no una medición de cuánto tarda `sharp`.

**Se rechazan dos alternativas que parecen más precisas:**

*Declarar las variantes antes de escribirlas* sería correcto por construcción y sin ventana. Pero el
registro afirmaría variantes que aún no existen — exactamente la mentira que este cambio elimina,
solo que transitoria — salvo añadiendo un campo aparte, lo que cambia el contrato de `MediaEntry` y
reabre ADR-0017 por un problema que la antigüedad resuelve sin tocarlo.

*Rastrear los trabajos en vuelo en memoria* es preciso y no necesita margen arbitrario. Pero solo
vale dentro de un proceso: en serverless o multi-instancia, el escaneo de una instancia no ve los
trabajos de otra y la corrupción vuelve, en el despliegue donde además es más difícil de diagnosticar.
Es el mismo límite que el throttle de login ya documenta.

**Dos decisiones que se derivan de la primera:**

**La sección crítica se estrecha, y lo que se confirma es un filtro, no una foto.** La inspección
—`fs.access` por entrada y el recorrido— es de solo lectura y sale del lock. Dentro queda releer,
descartar y guardar. **El relectura es obligatoria, no una optimización**: escribir un conjunto
calculado antes de tomar el lock descartaría cualquier entrada añadida mientras tanto, que es
justamente la pérdida que el lock existe para evitar. Como efecto, una lectura de listado deja de
sostener el lock de escritura durante el recorrido, que era la petición original de #164.

**Reconcile repara lo ya roto.** Descarta los registros de variante cuyo fichero falta, en entradas
con `status: 'ready'` y nunca en `processing`. El bug ya se envió: proteger solo las subidas nuevas
dejaría a toda instalación existente sirviendo `srcset` rotos para siempre, sin forma de saberlo. La
reparación ocurre en la siguiente lectura, sin migración ni acción del owner.

## Consecuencias

**A favor.** El camino principal de subida deja de corromper el registro. Los registros ya dañados se
curan solos. Y una lectura de listado deja de bloquear a las siete funciones que mutan media, incluida
`markMediaVariantsReady` — de modo que teclear en el buscador ya no encola la persistencia de una
subida en curso.

**El coste, y es deliberado.** Un huérfano real vive hasta cinco minutos más de lo que vivía. Y el
umbral es un margen temporal, no una garantía formal: una codificación que superase los cinco minutos
volvería a ser vulnerable. Se acepta porque el número es holgado en dos órdenes de magnitud sobre lo
observado, y porque las alternativas que dan garantía formal tienen costes peores —contrato del
registro, o romperse en multi-instancia.

**Lo que este ADR NO decide.** El recorrido de directorios **sigue ocurriendo en cada lectura de
listado**. Ya no bloquea, pero el I/O por pulsación debounced sigue ahí. Sacarlo de la ruta de lectura
cambia *cuándo* se recolectan los huérfanos —comportamiento observable— y merece su propio ciclo.
Tampoco se regeneran las variantes perdidas: el original está intacto, así que la imagen se sigue
viendo y solo hay menos alternativas responsive; regenerar desde una ruta de lectura sería la clase de
sorpresa que este ADR quita.

**Si algún día cambia.** Si el escaneo sale de la ruta de lectura, esta decisión **no** se revierte:
un escaneo manual o por TTL puede coincidir con una generación exactamente igual, así que la prueba
de antigüedad sigue siendo necesaria. Y si alguna vez se adopta la declaración previa de variantes,
el umbral pasa a ser redundante y puede retirarse — pero solo entonces.
