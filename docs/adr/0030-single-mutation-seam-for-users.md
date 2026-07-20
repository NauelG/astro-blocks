<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0030 — One mutation seam for users.json, with no way to skip the write

- **Status:** Accepted — 2026-07-19
- **Date:** 2026-07-19
- **Decisores:** Nauel Gómez
- **Source:** Issue [#135](https://github.com/NauelG/astro-blocks/issues/135) (P1, security), grilled 2026-07-19
- **Relación:** extiende ADR-0027 (`tokenVersion` como primitivo de revocación) y ADR-0028 (el store
  defiende sus propias invariantes). No reemplaza a ninguno.

## Contexto

`withUsersLock` existe desde #25 y es correcto. El problema nunca fue el lock: fue que **usarlo era
opcional**. Cuatro caminos escribían `users.json` y dos se lo saltaban, no por descuido puntual sino
porque nada en la forma del código obligaba a tomarlo. Cada handler hacía `loadUsers` → mutar →
`saveUsers`, y `saveUsers` escribe la lista entera: dos escrituras entrelazadas se pisan por
completo.

Lo que se pierde en esa carrera incluye el bump de `tokenVersion`, es decir, **una revocación de
sesión**. El operador cambia una contraseña comprometida, recibe `200`, y el token que cree muerto
sigue vivo. Sin error y sin traza. Es la clase fail-open de #124 alcanzada por concurrencia.

ADR-0028 ya había movido una invariante de `users.json` al store (`restoreUsers`) con este mismo
razonamiento. Esta decisión lo generaliza: **si la corrección depende de que cada llamante recuerde
algo, es cuestión de tiempo que alguien no lo recuerde.**

Al diseñar el seam apareció una segunda decisión, menos obvia y más fácil de deshacer por
"optimización": cómo indica el mutador que una operación falló y no debe escribirse.

## Decisión

**Toda mutación de `users.json` pasa por `data.mutateUsers(fn)`. El seam escribe siempre; no existe
mecanismo de aborto.**

- `mutateUsers` toma el lock, relee la lista **dentro** de él, se la entrega al mutador como array
  mutable, y la escribe. Devuelve lo que devuelva el mutador.
- **Los llamantes nunca adquieren `withUsersLock`.** El lock es no reentrante: un mutador que lo
  pidiera se autobloquearía. Tras este cambio sus únicos clientes son `mutateUsers` y el pipeline de
  import.
- **Las guardas se revalidan dentro del lock.** Unicidad de email, `ownerCount` y existencia del
  registro se evaluaban sobre una lectura previa. Sin esto se arreglaría el lost-update dejando
  intacto el check-then-act.
- **El hasheo de contraseña queda fuera de la sección crítica.** `hashPassword` es lento a
  propósito; sostener el lock mientras corre bloquea todos los logins.
- **No hay `commit()` ni centinela `ABORT`.** Un camino de error simplemente no muta, y se reescribe
  la lista sin cambios.

## Por qué no hay aborto

Es la parte que alguien querrá "mejorar" más adelante, así que queda escrito el porqué.

Las dos alternativas evitan una escritura redundante en rutas de error —que son raras— y a cambio
**crean una forma de descartar un cambio real en silencio**:

- **`commit()` explícito:** olvidarlo descarta la mutación y responde `200`. Es exactamente el modo
  de fallo que este ADR existe para eliminar, reintroducido en la herramienta que lo elimina.
- **Centinela `ABORT`:** el tipo de retorno pasa a ser `T | typeof ABORT` y contamina a todos los
  llamantes, que deben desempaquetarlo — ruido que un módulo profundo debería absorber, no emitir.

Escribir siempre no tiene modo de fallo silencioso: la peor consecuencia es un `rename(2)` de más.
La asimetría de coste entre "una escritura innecesaria" y "una revocación perdida sin traza" no
admite discusión.

## Consecuencias

- Un quinto camino que mañana escriba usuarios **nace correcto**, porque el seam es la única puerta y
  no hay nada que recordar. Ese es el objetivo entero de la decisión.
- **Se escribe en rutas de error** (404, email duplicado): un `rename(2)` atómico con contenido
  idéntico. Aceptado.
- **Se hashea en rutas de error.** Trabajo desperdiciado en una rama rara, con el efecto lateral de
  que el tiempo de una petición fallida depende menos de *por qué* falló.
- **La normalización de `tokenVersion` pasa a consolidarse en disco**: como toda mutación reescribe
  lo que `loadUsers` devolvió, un registro legado o malformado queda normalizado la primera vez que
  se toca a ese usuario. Efecto lateral benigno de ADR-0027, gratis.
- `restoreUsers` **no** es cliente del seam: su llamante ya sostiene el lock y reemplaza la lista en
  vez de mutarla. La regla es "toda *mutación*", no "toda escritura".
- El lock se sostiene ahora en más peticiones que antes (las tres de CRUD), pero durante mucho menos
  tiempo en las que ya lo sostenían, al sacar el hasheo fuera.
