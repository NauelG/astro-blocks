<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0034 — La parity i18n y los mensajes de validación son un solo origen, enforced por el compilador

- **Status:** Accepted — 2026-07-21
- **Date:** 2026-07-21
- **Decisores:** Nauel Gómez
- **Source:** Issue [#40](https://github.com/NauelG/astro-blocks/issues/40) (P1, refactor), grilled 2026-07-21
- **Relación:** comparte forma con ADR-0033 (un módulo isomorfo no puede importar código de una capa
  más pesada). No reemplaza a ninguno.

## Contexto

Dos invariantes del i18n del admin estaban "protegidas por un comentario, no por el compilador", y
uno de los comentarios ya había fallado y enviado un bug de localización a producción.

**Parity del catálogo.** `en.ts` es la autoridad de claves; `es.ts` debe tener exactamente las
mismas. El `satisfies Catalog & { [K in keyof typeof en]: string }` de `es.ts` ya cazaba una clave
*faltante* (verificado: TS1360), pero **no una clave de más**: `Catalog = Record<string, string>`
admite cualquier clave string (verificado: sin error). La otra mitad de la parity descansaba en un
test de runtime.

**Mensajes de validación duplicados.** `utils/block-validation.ts` es **isomorfo** — lo importan el
bundle del navegador (`page-editor`, `block-form/*`) y los handlers de servidor. Por eso no importa
`en.ts`: arrastraría el catálogo de 677 claves a cada bundle. Sus 19 templates ingleses estaban
copiados a mano y "sincronizados por un comentario". No lo estaban: **2 claves habían derivado**
(`fieldMustBeFile`, `fieldFileNeedsUrl`), que el validador emite pero que faltaban en `en`/`es`. El
admin resuelve el `messageKey` con `ct()`, y `t()` cae a la clave cruda como sentinel — así que un
error de campo *file* mostraba el string literal `blockValidation.fieldMustBeFile` en los dos
idiomas. El comentario falló exactamente donde la issue predecía.

Al diseñar la unificación apareció el acoplamiento no obvio que este ADR fija.

## Decisión

**1. Parity bidireccional a nivel de tipo.** `type CatalogKey = keyof typeof en` (en un módulo hoja
`catalog-key.ts` que solo importa `en`), y `es.ts satisfies Record<CatalogKey, string>`. Esto rechaza
falta (TS1360) y sobra (TS2353) — verificado empíricamente. El test de parity de runtime se retira
por redundante; se conservan sus comprobaciones de valor (no-vacío, todo-string), que el compilador
no cubre.

**2. Un solo origen para los templates, isomorfo y con claves literales.** Los ~19 templates viven
una vez en `src/utils/block-validation-messages.ts`. El validador los importa (queda lean, sin
catálogo); `en.ts` los esparce en su literal.

**3. El `as const` del módulo compartido es carga estructural, no estilo.** Aquí está el acoplamiento
que hay que proteger: `en.ts` **esparce** el módulo, así que si se anotara `Record<string, string>`
en vez de `as const`, `keyof typeof en` colapsaría a `string` y la parity de la Decisión 1 se
desactivaría **en silencio** — el compilador dejaría de comprobar nada y todo seguiría verde. Las dos
decisiones no son independientes: la 1 depende de que la 2 conserve claves literales.

**4. La dirección del origen es del módulo compartido hacia el catálogo, nunca al revés.**
`block-validation.ts` no importa `en.ts` (rompería la frontera de capa, el mismo hazard que
ADR-0033). `en.ts` importa del módulo compartido, no al contrario. `es.ts` traduce esas claves inline
en español — el módulo compartido es solo inglés, y la parity de la Decisión 1 fuerza que las
traducciones existan, incluidas las 2 que faltaban.

## Consecuencias

**A favor.** El bug de las 2 claves queda arreglado de raíz y hecho imposible de repetir: si el
validador emite un `messageKey`, el catálogo lo tiene por construcción, y si `es` no lo traduce, no
compila. La red de seguridad pasa de un comentario a `tsc`. Se retira un test de runtime que
duplicaba lo que ahora garantiza el compilador.

**El coste, y es deliberado.** Aparece un acoplamiento sutil y fácil de romper por "limpieza": añadir
`: Record<string, string>` al módulo compartido —un cambio que parece inofensivo y que muchos linters
sugerirían— desactiva la parity sin ninguna señal. Por eso el `as const` lleva un comentario que
nombra la consecuencia, y por eso este ADR existe: la relación entre el spread de `en.ts` y el
`as const` del módulo no es evidente leyendo ninguno de los dos ficheros por separado.

**Si algún día se añade un tercer locale.** No cambia nada de esto: el nuevo catálogo se declara con
`satisfies Record<CatalogKey, string>` como `es`, y hereda la parity bidireccional gratis. La
autoridad sigue siendo `en`.
