<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0032 — La IP del cliente no es clave de throttling; el login se frena por email y con retraso, no con bloqueo

- **Status:** Accepted — 2026-07-20
- **Date:** 2026-07-20
- **Decisores:** Nauel Gómez
- **Source:** Issue [#125](https://github.com/NauelG/astro-blocks/issues/125) (P2, security), grilled 2026-07-20
- **Relación:** no reemplaza a ninguno. Añade una defensa por delante del seam de autenticación que
  describen ADR-0007 (token en cabecera, sin credencial ambiental) y ADR-0027 (`tokenVersion` como
  primitivo de revocación).

## Contexto

`handleLogin` no tenía contador de intentos de ninguna clase. scrypt encarece **cada** adivinanza,
pero no acota **cuántas** se hacen, y la cuenta que se adivina es la del owner del CMS.

La issue proponía lo que propone cualquier manual: contador por `email + IP`, backoff y lockout
temporal con `Retry-After`. Al llevarlo al código aparecieron dos problemas que no son de
implementación sino de información disponible.

### La IP que recibimos no es la que creemos

Astro 7 resuelve la dirección así (`astro/dist/core/app/node.js:51-53`):

```js
const forwardedClientIp = hostValidated ? getFirstForwardedValue(req.headers["x-forwarded-for"]) : void 0;
const clientIp = forwardedClientIp || req.socket?.remoteAddress;
```

Son dos fuentes con defectos **complementarios**, y ninguna sirve como clave:

- `req.socket.remoteAddress` es el peer TCP real y no se falsifica a ciegas — pero detrás de un
  proxy inverso **es la dirección del proxy**, idéntica para todos los clientes. Fiable e inútil.
- `x-forwarded-for` identifica al cliente real solo si un proxy de confianza la reescribe.
  `@astrojs/internal-helpers` la valida comprobando que el **primer** valor case con
  `/^[0-9a-fA-F.:]{1,45}$/`: una comprobación de forma, sin frontera de confianza ni conteo de
  saltos. Útil y falsificable.

Y el orden de precedencia es `forwardedClientIp || socket`: **la cabecera falsificable gana al
socket fiable**. Una instancia expuesta directamente con `allowedDomains` configurado creerá el
`X-Forwarded-For` del atacante por encima del peer real.

AstroBlocks se distribuye como paquete npm. No sabe en qué despliegue corre, luego no sabe cuál de
los dos valores tiene en la mano. Esto no es una carencia que se cierre con más código: **el dato no
existe en esta capa**.

Conviene precisar qué **no** es el problema, para que nadie lo ataque por el lado equivocado. No es
disponibilidad: ADR-0010 ya obliga a que haya adaptador SSR en `build` vía
`assertAdapterConfigured`. Pero esa guarda es deliberadamente agnóstica del adaptador —node,
vercel, netlify, cloudflare o el que venga—, así que no puede garantizar que el adaptador elegido
rellene `clientAddress`; y el getter de Astro **lanza** `StaticClientAddressNotAvailable` cuando
falta (`astro/dist/core/middleware/index.js:60-65`). Aun suponiendo disponibilidad universal, el
problema de confianza descrito arriba queda igual: que un valor **esté** no lo convierte en un valor
que **signifique** lo que necesitamos.

Peor que inútil, es contraproducente. Con la IP en la clave, el atacante rota la cabecera y obtiene
intentos ilimitados; y si además limitamos *por* IP, puede falsificar la de un tercero para
limitarlo a él. Le damos un arma a cambio de nada.

### El lockout es un DoS que nos hacemos solos

El CMS tiene **un único owner**. Denegar esa cuenta tras N fallos permite que cualquiera sin
autenticar deje la instancia inadministrable fallando cinco veces, sabiendo solo un email. Se cambia
un riesgo de fuerza bruta por una pérdida de disponibilidad garantizada y trivial de provocar.

Hay además un tercer efecto que el lockout arrastra: hoy `auth.ts:64` devuelve un 401 idéntico para
"no existe ese email" y "contraseña incorrecta". Un `429` que solo aparece en cuentas reales
**enumera** las cuentas. La defensa abriría un agujero distinto.

## Decisión

**1. La clave es el email normalizado, y nada más.** Es el único valor que el atacante no puede
rotar sin dejar de atacar la cuenta. No exige fontanería de IP, ni cambiar la firma de
`handleLogin`, ni tocar `catchall.ts`, ni depender de qué expone cada adaptador.

**2. Retraso exponencial acotado, no bloqueo.** Tres fallos libres, luego 500 ms doblando hasta un
tope de 8 s. El owner legítimo nunca queda fuera; la tasa sostenida del atacante se desploma. El
tope existe porque un retraso ilimitado es una conexión abierta que el atacante acumula.

**3. La respuesta no cambia.** Un intento frenado devuelve el mismo `401 errors.invalidCredentials`,
sin `Retry-After` ni estado propio, y el retraso se aplica igual exista o no el email. El retraso es
lo único observable, y no distingue cuentas.

**4. El contador vive en memoria, acotado, y desaloja por número de fallos.** Persistirlo
significaría una escritura a disco por login fallido (`data.ts:300`, tmp + rename) y contención con
el lock de usuarios: un amplificador de I/O regalado al atacante, justo en el camino que se defiende.
Como la clave la controla el atacante, el mapa se acota (1 024 entradas) y el **orden de desalojo es
una propiedad de seguridad**: primero las caducadas, después las de **menos** fallos. Un LRU sería el
bypass — inundar con mil emails basura expulsaría la entrada de la cuenta realmente atacada.

**5. El proxy inverso sigue siendo la capa de producción**, y se documenta como tal. Esto es defensa
en profundidad, no la defensa.

## Consecuencias

**A favor.** El brute-force sostenido contra el owner pasa de miles de intentos por minuto a ~7,5.
No se añade superficie: sin cabeceras nuevas, sin estados nuevos, sin claves i18n nuevas, sin
cambios en el contrato de respuesta ni en la firma de ningún handler. La propiedad
anti-enumeración de R1 se conserva intacta porque el camino de fallo sigue siendo uno solo.

**En contra, y aceptado.** No frena un ataque distribuido que reparta intentos entre muchas cuentas
—hay una sola que valga la pena— ni una ráfaga concurrente que llegue antes de que ningún contador
suba; contra eso lo que acota el caudal es el coste de scrypt. El contador se pierde al reiniciar y
no se comparte entre instancias, así que en serverless o multi-instancia su valor es parcial. Todo
ello es explícito en la spec en lugar de quedar implícito en el código.

**El coste real de esta decisión** es que "falta limitar por IP" parecerá una carencia obvia a
quien lea `login-throttle.ts` sin este contexto. Por eso existe este ADR: **añadir la IP a la clave
no es una mejora pendiente, es una regresión**, y quien quiera revertir esta decisión necesita
primero resolver cómo un paquete distribuible distingue una IP de proxy de una falsificada — que es
el problema que aquí se declara irresoluble en esta capa.

**Si algún día cambia.** La vía no es leer la cabecera con más cuidado, sino que el consumidor
declare explícitamente su topología (número de saltos de proxy de confianza) y que AstroBlocks
rechace usar la IP si esa declaración no existe. Eso es un ADR nuevo, no un parche a este.
