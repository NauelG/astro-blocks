<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0039 — Las cadenas de cliente del panel vienen de `ct`, no de un puente i18n

- **Status:** Accepted — 2026-08-20
- **Date:** 2026-08-20
- **Decisores:** Nauel Gómez
- **Source:** Issue [#119](https://github.com/NauelG/astro-blocks/issues/119)
- **Relación:** estrecha el alcance del **puente i18n** tal como lo describe ADR-0022. No lo reemplaza:
  la razón por la que existe el patrón de dos scripts —que el renderizado HTML viva en un módulo
  linteado y con acceso al escaper canónico— sigue intacta. Lo que cambia es **qué** viaja por él.

## Contexto

El panel tiene dos caminos para que un módulo cliente obtenga una cadena traducida.

El **canónico** es `ct(key)` (`routes/admin/i18n/client.ts`): el módulo importa el helper, lee el
locale de `window.getCmsUiLocale()` y resuelve contra el catálogo en el navegador.

El **otro** es el **puente i18n**: la página `.astro` construye en frontmatter un objeto
`{ propiedad: t('alguna.clave') }`, un `<script define:vars>` lo cuelga de `window.__cmsXI18n`, y el
módulo cliente lo baja con un cast.

Los dos terminan en el mismo `createT` sobre el mismo `catalogs.ts`. **Mismo catálogo, mismo locale,
mismas traducciones.** La diferencia no es de corrección: es *dónde* se resuelve la clave.

Tres editores —`languages`, `users`, `import-export`— usaban el segundo. No por una razón técnica:
`CONTEXT.md` §3 documentaba el puente y **no mencionaba `ct` ni una vez** en 331 líneas, y la
convención de §4 remataba diciendo *"put the logic in a client module (wired via the i18n bridge)"*.
El mecanismo equivocado era el único señalizado.

El coste se materializó en las dos direcciones posibles. `ImportExportI18n.confirmUnavailable` estaba
declarado en el tipo y nunca se publicaba, así que su traducción española existía sin que la alcanzara
nadie. `usersI18n.loading` se publicaba y se tipaba, y no lo leía nadie. TypeScript no podía ver
ninguno de los dos: la correspondencia entre el objeto de la página y el tipo del editor cruza la
frontera `.astro` → módulo, donde el compilador no llega. El cast que cerraba el círculo
—`(win as unknown as { __cmsUsersI18n?: UsersI18n }).__cmsUsersI18n as UsersI18n`— admitía en su
interior que el valor puede faltar y lo negaba en su exterior.

## Decisión

**Las cadenas de i18n de cliente se obtienen con `ct`. El puente i18n transporta datos, nunca
cadenas traducidas.**

Un módulo cliente que necesita texto lo pide al catálogo por clave, en el navegador. No recibe texto
ya resuelto desde el frontmatter.

Esto elimina por construcción la lista de claves mantenida a mano: no hay dos declaraciones que
puedan divergir, porque no hay dos declaraciones. La clave es el único identificador, y vive en un
solo sitio.

**El puente sigue existiendo y sigue siendo correcto** para lo que ADR-0022 lo necesita: pasar datos
de la página al módulo. `getCmsUiLocale` es precisamente eso, y es el cimiento sobre el que `ct`
funciona. No se toca.

**Se rechaza la alternativa de resolver el conflicto al revés** —estandarizar en el puente y retirar
`ct`— aunque tiene un argumento real (ver Consecuencias). Falla porque el puente es exactamente el
mecanismo que el compilador no puede verificar, y porque `ct` ya sirve a la mayoría del panel: mover
esa mayoría al puente multiplicaría por diez las listas de claves a mano.

## Consecuencias

**A favor.** Desaparece una clase entera de bug —la divergencia silenciosa entre el objeto publicado
y el tipo declarado— porque desaparece la duplicación que la causaba. Desaparecen tres casts
`as unknown as`. Y una cadena de i18n deja de tener dos representaciones (clave en el servidor, nombre
de propiedad en el cliente) para tener una sola.

**El coste, y es el que hay que tener presente al aplicar esta regla.** El puente resuelve en SSR, así
que el cliente **no necesita el catálogo**. `ct` obliga a embarcar los catálogos en el bundle del
panel. En los tres editores migrados esto no cuesta nada —ya importan `common.ts`, que arrastra `ct`
y ambos catálogos— pero la regla impone ese peso a **cualquier página futura**, incluida una que hoy
no pague nada. Se acepta porque el panel es una superficie autenticada y no un sitio público: su
presupuesto de bytes no compite con el de las páginas que el CMS publica.

**Un modo de fallo se sustituye por otro, y hay que saberlo.** Con el puente, una cadena que falta
lanza `TypeError` y la página se rompe de forma escandalosa — lo que, accidentalmente, hacía que dos
specs e2e fallaran. Con `ct`, una clave que no resuelve **devuelve la clave como texto y no lanza**:
la página se ve casi bien, con `users.deleteLabel` escrito literalmente, y los tests siguen en verde.
Ese silencio se compensa deliberadamente: `ct` emite `console.warn` en desarrollo cuando una clave no
resuelve, y un test e2e carga el panel con `Accept-Language: es` sin cookie y afirma texto en español
—que una clave sin resolver no puede satisfacer—.

**Lo que este ADR NO decide.** No estrecha la firma de `ct`, que sigue siendo `key: string`. Tipar la
clave como `CatalogKey` es deseable y no es gratis: `messageKey` viaja sin tipar desde
`utils/block-validation.ts` hasta el servidor en `localizedJsonError`, y hacerlo bien exige que
`src/utils/` importe del panel — una flecha de dependencia de núcleo a presentación que merece su
propio ciclo. Tampoco decide sobre `layout.astro`, cuyos dos puentes de cadenas siguen en pie como
excepción con dueño (#106), ni sobre `cache.astro`, que no tiene módulo cliente al que migrar.

**Si algún día cambia.** Si el peso del catálogo en el bundle del panel llegara a importar, la salida
**no** es volver al puente: es dividir los catálogos por página o cargarlos bajo demanda. El problema
sería de empaquetado, y el puente no es una solución de empaquetado — es una duplicación de
declaraciones que resulta tener, de rebote, un efecto de empaquetado.
