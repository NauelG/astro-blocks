<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.13.0-alpha.2] - 2026-03-28

### Added

- **Feature manifest for the informational website:** nuevo catálogo interno `meta/features.json` con `schemaVersion`, `id` estable por feature y metadata de versión (`sinceVersion`, `updatedIn`), incluido en el artefacto distribuible como `dist/meta/features.json`.
- **Feature manifest validation tooling:** nuevos scripts `scripts/features-manifest.mjs` y `scripts/validate-features.mjs` con validaciones de estructura, ids únicos, categorías y estados permitidos, y versiones semver-like.
- **Feature manifest build/test coverage:** nuevo comando `npm run features:validate` y nuevo test `tests/features-manifest.test.js` para verificar que el build publica un manifiesto válido.

### Changed

- **Build pipeline:** `scripts/build.mjs` ahora valida el manifiesto de features antes de compilar y copia `meta/` a `dist/`.
- **Maintainer workflow:** se actualizan `DEVELOPING.md` y `AGENTS.md` para incluir revisión/actualización de `meta/features.json` como paso obligatorio en el cierre de versión.
- **Feature history metadata:** ajustes de `sinceVersion` y `updatedIn` en `meta/features.json` para reflejar hitos reales según `CHANGELOG.md`.

## [0.13.0-alpha.1] - 2026-03-28

### Added

- **Native array editing in the page builder:** soporte completo para props `array` dentro del editor de bloques con UX compacta para `array<primitive>` y `array<object>` (añadir, eliminar, reordenar, colapsar/expandir y resumen por fila).
- **Shared array validation path:** nueva validación compartida de bloques/arrays para cliente y backend (`minItems`, `maxItems`, `required` y validación de campos requeridos dentro de `array<object>`), con mensajes de error consistentes en guardado.
- **Playground coverage block for arrays:** nuevo bloque `ContentList` en `playgrounds/basic` con datos de ejemplo localizables para probar arrays primitivos y de objetos en el CMS.

### Changed

- **Schema contract and types:** el contrato tipado de bloques incorpora soporte explícito para `array` y `array<object>`; se añade validación estructural temprana del schema al resolver bloques para detectar definiciones inválidas antes del runtime.
- **Page editor implementation:** el cliente del editor de páginas incorpora estado UI específico por array (fila abierta, paths de error, límites `min/max`) y sincronización de cambios por path estable en `blocksList`.
- **README block schema docs:** se documenta el uso de arrays en schemas de bloque para facilitar adopción de la nueva capacidad.

### Fixed

- **FAQ row action alignment:** corrección de alineación visual en los botones de acción (expandir/eliminar) de filas `array<object>` en el editor de bloques, validada en desktop, tablet y móvil.

## [0.12.0-alpha.3] - 2026-03-27

### Changed

- **Admin default branding alignment:** default site values now use `/favicon.ico` and AstroBlocks brand accents (`#2C53B8` primary, `#0DB8DB` secondary) instead of generic gray fallbacks.
- **Admin head icons:** CMS layout now includes explicit favicon and Apple touch icon links using AstroBlocks assets for more consistent branding across devices.
- **Settings UX defaults:** settings form fallbacks/placeholders and live theme preview now use the same brand defaults, keeping persisted values and runtime preview behavior aligned.

## [0.12.0-alpha.2] - 2026-03-20

### Changed

- **Scoped package identity for npm publishing:** el paquete pasa a distribuirse como `@astroblocks/astro-blocks` (incluyendo `package.json`, lockfile, README y guías de mantenimiento), y el playground consumidor actualiza imports/subpaths al nuevo scope.
- **Release docs for local tarball validation:** se actualizan ejemplos de instalación/desinstalación y nombre de tarball para el paquete scopeado (`astroblocks-astro-blocks-<version>.tgz`).

### Fixed

- **Locale choice persistence on SSR home redirect:** la redirección automática de `/` ahora respeta la preferencia del usuario mediante cookie (`astroblocks-locale`) y evita forzar de nuevo el idioma del navegador durante navegación interna.
- **Coverage for locale redirect behavior:** nuevos tests en localización para preferencia por cookie, navegación same-origin y fallback controlado a `Accept-Language`.

## [0.12.0-alpha.1] - 2026-03-20

### Added

- **Redirects MVP (SSR):** nueva entidad `data/redirects.json`, CRUD completo en `/cms/api/redirects`, pantalla `/cms/redirects` en el admin y resolución pública de redirecciones exactas por path con códigos `301/302`, manteniendo el comportamiento i18n V2 por rutas explícitas.
- **Validación y tests de redirecciones:** utilidades compartidas para normalización/validación de rutas internas (sin URL externa, query ni fragmento), cobertura de tests para handlers y utilidades, e invalidación de caché global al mutar redirecciones.
- **Automatización de capturas del README:** nuevo comando `npm run screenshots:readme` con Playwright para regenerar y sobrescribir `img/dashboard.jpg` y `img/page_editor.jpg` desde el playground.

### Changed

- **Navegación y documentación del panel:** el sidebar incorpora acceso a `/cms/redirects`; README actualizado con `data/redirects.json`, ruta del panel y nota explícita de alcance SSR-only para redirecciones en alpha.
- **Checklist de cierre de versión:** se establece como criterio de release ejecutar `npm run screenshots:readme` cuando una iteración incluya cambios de UI.

## [0.11.0-alpha.3] - 2026-03-19

### Added

- **npm package metadata for Astro listing:** added `description`, `homepage`, `repository`, `bugs`, and `license` fields so AstroBlocks exposes complete metadata for npm consumers and Astro Integrations Library cards.
- **Discovery and categorization keywords:** added package `keywords` including `astro-integration`, `withastro`, and category-friendly tags (`seo`, `tooling`, `utils`) to improve discoverability and listing classification.

## [0.11.0-alpha.2] - 2026-03-19

### Changed

- **Admin visual normalization:** unified border radius and spacing in the CMS admin with a shared token contract (`--cms-radius-base`, `--cms-radius-pill`, `--cms-space-*`) to remove mixed sizing across shell, lists and builders.
- **Design system consistency:** normalized neutral borders and replaced inline spacing/border styles in admin templates and client-rendered markup with reusable classes in `cms-admin.css`.
- **Toolbar controls:** aligned list toolbar controls to the same visual height and sizing rules, including the custom select trigger used by filters.

### Fixed

- **Page editor block actions:** the delete action now matches the same dimensions as toggle and duplicate actions in block cards.

## [0.11.0-alpha.1] - 2026-03-19

### Added

- **Multi-language content model:** nuevo archivo `data/languages.json`, gestión de idiomas de contenido desde `/cms/languages` y soporte para documento único con campos localizables por locale en páginas, bloques y menús.
- **API y helpers públicos para i18n:** nuevo CRUD `/cms/api/languages`, helper `getLanguages()` para leer idiomas configurados desde el proyecto consumidor y helper `getI18nMeta()` para generar `html lang`, `hreflang`, `x-default` y metadatos Open Graph por idioma.
- **Cobertura de tests para i18n:** nuevos tests para localización, helpers públicos, localización estricta en plano público y props de bloques localizables.

### Changed

- **Contrato de bloques:** `PropDef` incorpora `localizable?: boolean` para marcar explícitamente qué campos string/text se traducen por locale.
- **Admin multi idioma:** topbar con selector de idioma de contenido, separación entre idioma de interfaz y de contenido, labels sutiles por locale en todos los campos localizables y edición localizada también en builders de bloques y menús.
- **Routing público:** MVP de rutas localizadas con estrategia `prefix-except-default` sobre path, manteniendo el contrato preparado para extenderse más adelante sin exponer aún subdominio o dominio.
- **Playground y README:** ejemplos actualizados para reflejar la nueva versión, incluyendo layout consumidor con `getI18nMeta()`, uso de `getLanguages()` y menús consumidos por locale.
- **Dashboard y shell del CMS:** el dashboard pasa a mostrar idiomas en lugar de usuarios y se refinan dropdowns, selector de locale y affordances del topbar para encajar mejor con el design system actual.

### Fixed

- **Sin fallback público implícito entre idiomas:** páginas, menús, sitemap, robots y alternates ya no reutilizan silenciosamente el `defaultLocale` cuando falta contenido en el locale solicitado.
- **Detección de idioma del navegador en SSR:** `/` usa `Accept-Language` para redirigir al locale no default cuando existe contenido publicado y ahora añade `Vary: Accept-Language` para evitar respuestas cacheadas incorrectamente.
- **Sincronización del locale activo en el admin:** correcciones en refresco, tablas, labels de formularios, builders y selector del topbar para que el idioma seleccionado se mantenga y se refleje de forma consistente.

## [0.10.0-alpha.1] - 2026-03-18

### Added

- **Block editor section in README:** nueva sección dedicada al editor de bloques como funcionalidad principal del producto, con captura actualizada del `page editor`.
- **Criterios de release y diseño en AGENTS:** reglas explícitas para topbar mínima, sidebar sobrio, toolbars secundarias, dashboard sin bloques redundantes, builders compactos, limpieza de CSS obsoleto y uso de versiones `alpha` con tags de git.

### Changed

- **Rediseño del admin:** shell, dashboard, listados, formularios, botones, topbar, sidebar y tablas se compactan y alinean hacia una dirección visual más SaaS/CMS, sin cambiar contratos públicos ni añadir dependencias.
- **Dashboard:** nueva composición operativa con resumen principal, métricas compactas, acciones rápidas, actividad reciente y card de sitio/branding; se elimina la card redundante de estado del workspace.
- **Listados y toolbars:** barras de búsqueda y filtros pasan a ser elementos secundarios y más discretos; tablas y acciones mantienen mayor densidad visual y mejor legibilidad.
- **Editor de páginas:** tarjetas de bloque y selector de bloques simplificados; se eliminan chips/pseudo-iconos irrelevantes y se refuerza el enfoque builder compacto.
- **Editor de menús:** builder rediseñado con items principales colapsables, submenús inline, apertura más robusta del detalle y menor ruido visual general.
- **Página de caché:** simplificada a una única card operativa con una sola acción principal y menos información redundante.
- **Assets y documentación pública:** `dashboard.png` y `page_editor.png` se convierten a `.jpg`, y la documentación pública pasa a referenciar los nuevos assets.

### Fixed

- **Dropdown de usuario:** correcciones de interacción, z-index, hover/focus y posicionamiento para que funcione de forma consistente en desktop y responsive.
- **Responsive de topbar:** menú hamburguesa visible, estructura móvil más limpia y menor desorden visual en pantallas estrechas.
- **Menú lateral:** restaurado `text-decoration: none` para evitar subrayado accidental en los enlaces de navegación.

## [0.9.0] - 2026-03-18

### Added

- **TypeScript build and typed distribution:** el paquete migra a TypeScript, compila a `dist/` con `tsc` y publica JS + declaraciones tipadas con subpath exports para `astro-blocks`, `astro-blocks/contract` y `astro-blocks/getMenu`.
- **DX de mantenimiento:** nuevo workspace con `playgrounds/basic`, validación local con `npm pack`, scripts dedicados para build, playground y empaquetado, y guía separada en `DEVELOPING.md` y `LOCAL_PACKAGE_TESTING.md`.
- **Render público SSR con cache experimental de Astro:** modo alpha por defecto con invalidación selectiva por path al editar páginas, invalidación global por tags al tocar menús/ajustes y endpoint `POST /cms/api/cache/invalidate`.

### Changed

- **Documentación:** README reescrito para consumidores, imports recomendados documentados y notas claras sobre `experimental.cache.provider`, `memoryCache()` y el comportamiento de la cache en `dev`.
- **Panel del CMS:** la acción de gestión de cache vive en `/cms/cache` y la pantalla interna pasa a `routes/admin/cache.astro`, alineando nombre, ruta y propósito.
- **Admin internals:** scripts inline grandes de páginas y menús extraídos a módulos cliente compartidos, con mejor separación de responsabilidades.

### Removed

- **Rebuild manual del sitio desde el CMS:** se elimina la acción que lanzaba builds del proyecto desde el panel; la pantalla de `/cms/cache` queda dedicada únicamente a invalidación de cache.

## [0.8.0] - 2026-03-16

### Added

- **Editor de bloques (modal de página):** modal casi a pantalla completa con dos columnas: izquierda (pestañas Información y SEO; tab SEO solo visible si la página es indexable), derecha (lista de bloques reordenable). Botón duplicar bloque (icono copia, color azul/índigo sutil) que inserta una copia debajo. Botón expandir con chevron en lugar de +/−. Botón eliminar con icono papelera. Lista de bloques y selector de tipo sin decoración de lista; ítems del selector con borde/sombra tipo card.
- **Pie del modal de página:** botones Guardar (siempre a la derecha), Publicar (verde sutil) y A borrador (ámbar sutil) según estado; campo Estado retirado del formulario. Nuevas páginas en borrador; Publicar/A borrador cambian estado al guardar.
- **API block-schemas en build:** el plugin genera `.astro-blocks/schema-map.mjs` (solo datos, sin imports .astro); el handler GET `/cms/api/block-schemas` carga ese archivo en lugar de `runtime.mjs` para que funcione tras `npm run build` en Node.
- **README:** apartado "Editor de bloques" con descripción del modal y captura `img/page_editor.jpg`. Eliminados `docs/plan-editor-bloques-schema.md` y `docs/plan-final-editor-bloques.md`.

### Changed

- **DetailModal:** prop opcional `large` para modal casi pantalla completa (usado en página). Columnas del modal de página con scroll independiente, divisor entre columnas, scrollbar fina y sutil.
- **Tabs Información/SEO:** estilos de tab sin borde/outline en focus; solo borde inferior en tab activo. Focus de inputs más sutil (ring 1px en lugar de 3px).
- **Hint no indexable:** margen ajustado para no solaparse con el checkbox; clase `cms-field-indexable` con margen inferior.

### Fixed

- **Editar página no funcionaba:** el script inline usaba sintaxis TypeScript `(window as any).Sortable`; sustituido por `window['Sortable']` para que el navegador no lanzara SyntaxError y se registraran los listeners.

---

## [0.7.0] - 2026-03-16

### Added

- **Dashboard rediseñado:** nueva estructura en dos columnas (`cms-dashboard-grid`) con fila de métricas compactas (total/publicadas/borradores/menús), bloque de páginas recientes con tabla inline y badge de estado, bloque de acciones rápidas y card con enlace externo al sitio web.
- **Estilos del dashboard (`cms-admin.css`):** nuevas clases `.cms-dashboard`, `.cms-dashboard-stats`, `.cms-dashboard-stat`, `.cms-dashboard-grid`, `.cms-dashboard-left/right`, `.cms-dashboard-block-header`, `.cms-dashboard-block-title`, `.cms-dashboard-block-link`, `.cms-dashboard-recent-table`, `.cms-dashboard-actions`, `.cms-dashboard-action-item`, `.cms-dashboard-site-link`, `.cms-dashboard-external-link`. Layout responsivo: dos columnas en escritorio, columna única reordenada en móvil.

### Changed

- **AGENTS.md §3:** sección "Estilos del panel" expandida con design system completo: 12 subsecciones (principios, reglas de color, `cms-admin.css`, sidebar/topbar, botones, formularios, cards, modales, tablas, dashboard, tips y qué NO hacer). Sustituye el párrafo monolítico anterior.

---

## [0.6.2] - 2026-03-15

### Added

- **Copyright y licencia BSL:** bloque de copyright al inicio de todos los archivos (código, estilos, .md). En .astro, el bloque va al inicio del frontmatter con `/* ... */` para no renderizarse. En .md se usa comentario HTML `<!-- ... -->`. Criterios en AGENTS.md §14: incluir el copy en archivos nuevos y actualizar el año en todos los bloques al cambiar de año.
- **Disclaimer en README:** texto sobre software source-available, uso permitido (proyectos personales, open-source, uso interno) y prohibición de ofrecer AstroBlocks como SaaS o servicio alojado.

---

## [0.6.1] - 2026-03-15

### Added

- **Diálogo de aviso (cmsAlert):** componente `AlertDialog.astro` con el mismo estilo que el de confirmación (overlay + panel centrado); expone `window.cmsAlert({ message, title?, okLabel? })`. Sustitución de todos los `alert()` del panel por cmsAlert (regenerar sitio, ajustes, páginas, menús).
- **Favicon del CMS:** el panel usa el logo de AstroBlocks como favicon (solo en rutas bajo `/cms`).

### Changed

- **AGENTS.md:** criterio de no utilizar nunca `alert()` ni `confirm()` nativos en el panel; usar siempre cmsConfirm y cmsAlert. Estructura del directorio con `AlertDialog.astro`. Criterio para tips informativos (estilo `.cms-menus-info-card`).

---

## [0.6.0] - 2026-03-15

### Added

- **Menús mejorados:** tabla de menús (nombre, selector) con editar y eliminar; modal de detalle con nombre, selector (validado: alfanumérico, guiones, guiones bajos), tabla de ítems con añadir/eliminar, reordenación con Sortable.js, submenús anidados (`children`) con la misma lógica. Validación de ruta obligatoria en cliente y API. API: GET/POST `/cms/api/menus`, PUT/DELETE `/cms/api/menus/:id`. Estructura en `data/menus.json`: `{ "menus": [ { id, name, selector, items } ] }`; ítems con `name`, `path` y opcionalmente `children`. `getMenu(selector)` devuelve ítems con `children` para navegación anidada.
- **Card informativa en página de menús:** texto explicativo con icono de bombilla sobre el uso del selector y `getMenu()` en el sitio (tipografía 8px, maquetación en párrafo).

### Changed

- **Menús:** se elimina la edición en JSON; formato antiguo de `menus.json` sin soporte (criterio de no compatibilidad hacia atrás en AGENTS.md).

---

## [0.5.2] - 2025-03-15

### Added

- **Ruta `/uploads/[...path]`:** endpoint que sirve los archivos de `public/uploads/` para que las imágenes subidas no devuelvan 404 al ser capturadas por la ruta dinámica `/[...slug]`. Inyectado antes del catch-all en el plugin.
- **README:** badge de estado alpha.

### Changed

- **AGENTS.md:** el bump de versión y la entrada en CHANGELOG no se hacen durante el desarrollo; solo al cerrar la versión cuando se pide hacer el commit. En ese momento se actualizan `package.json` y `CHANGELOG.md` y después se ejecuta el commit.

---

## [0.5.1] - 2025-03-15

### Added

- **Prefijo tipo token en subida de imágenes:** el nombre del archivo subido incluye un prefijo aleatorio (8 caracteres hex) para evitar colisiones (ej. `a1b2c3d4-foto.jpg`).
- **Campo imagen SEO con miniatura:** en el formulario de página, el campo imagen muestra una miniatura (80×80) en lugar de la ruta; botones "Subir imagen" / "Cambiar" y "Eliminar" para mantener el valor ordenado.
- **Eliminación de archivo al quitar imagen:** al pulsar "Eliminar" se borra el atributo `seo.image` y, si la URL es del CMS (`/uploads/...`), también se elimina el archivo en disco. Nuevo endpoint `DELETE /cms/api/upload` con body `{ url }`.

---

## [0.5.0] - 2025-03-15

### Added

- **Campos SEO predefinidos:** el formulario de página deja de usar un JSON libre y ofrece campos concretos: Título SEO, Descripción, URL canónica, Imagen (con botón "Subir imagen") y checkbox "Añadir nofollow". Los campos SEO se ocultan cuando la página no es indexable.
- **Indicador de indexable en la tabla de páginas:** columna "Indexable" con círculo verde (indexable) o rojo (no indexable). Estilos `.cms-indexable-dot`, `.cms-indexable-dot--yes`, `.cms-indexable-dot--no` en `cms-admin.css`.
- **Robots.txt:** se añaden líneas `Disallow` para cada página publicada y no indexable (excepto la home, para no bloquear todo el sitio). El sitemap sigue excluyendo páginas no indexables.

### Changed

- **Formulario de página:** reemplazo del textarea "SEO (JSON)" por los campos predefinidos anteriores. En PUT de página, el objeto `seo` enviado se hace merge con el existente para preservar claves extra que el layout pueda usar.
- **page.astro:** si `seo.image` es una URL relativa, se convierte a absoluta con `site.baseUrl` antes de pasarla al Layout (og:image / twitter:image).
- **README:** descripción de SEO ampliada (campos predefinidos, indexable, robots, recomendaciones para el layout: og:, twitter:, nofollow).

---

## [0.4.4] - 2025-03-15

### Added

- **Resolución de CSS con instalación por ruta:** aliases de Vite para `@picocss/pico` y `animate.css` que apuntan al `node_modules` del proyecto consumidor, de modo que el panel del CMS funcione cuando astro-blocks se instala por `file:` (ruta externa al proyecto Astro).

---

## [0.4.3] - 2025-03-15

### Changed

- **README:** badge de versión muestra la versión del proyecto (enlace a CHANGELOG) en lugar de la versión npm. AGENTS.md: convención de badge de versión y actualizar README al hacer bump.

---

## [0.4.2] - 2025-03-15

### Changed

- **README:** estilo moderno para repositorio público: cabecera con logo y badges (npm, Node, Astro), sección Características, tablas para requisitos/opciones/data, configuración rápida y secciones concisas.
- **AGENTS.md:** nueva sección 11 "README y versionado": convenciones para mantener el estilo del README (badges, tablas, estructura) y para actualizar la documentación cuando cambien opciones, rutas o data. Regla obligatoria: en cada cambio del paquete, hacer bump de versión en `package.json` y añadir entrada en `CHANGELOG.md`. Checklist de la sección 9 ampliada con esta regla.

---

## [0.4.1] - 2025-03-15

### Added

- **Logo en el panel:** logo de AstroBlocks (`img/blocks_logo.png`) en el footer del admin, muy pequeño (12px), servido con optimización de Astro (`astro:assets`).
- **Logo en README:** imagen del logo en la cabecera del README del paquete.

### Changed

- **Documentación:** AGENTS.md con estructura actualizada (carpeta `img/`, footer y logo en la descripción del panel; tipo `AstroBlocksOptions`). CHANGELOG con entrada 0.4.1.

---

## [0.4.0] - 2025-03-15

### Added

- **Footer del panel:** pie fijo en el layout del admin con el nombre "AstroBlocks" y el código de versión. El contenido hace scroll entre la topbar y el footer.

### Changed

- **Renombrado a AstroBlocks:** el paquete pasa de `astro-cms` a `astro-blocks`. Directorio del paquete: `lib/astro-blocks`. Alias de runtime: `astro-blocks-runtime`. Variable de entorno: `ASTRO_BLOCKS_PROJECT_ROOT`. Carpeta generada: `.astro-blocks`. Actualizar en proyectos: `package.json`, `astro.config.mjs`, imports (`astro-blocks`, `astro-blocks/contract`, `astro-blocks/getMenu`) y `.gitignore` (`.astro-blocks`).

---

## [0.3.0] - 2025-03-15

### Added

- **Usuarios:** pantalla `/cms/users` para gestionar usuarios (CRUD). Datos en `data/users.json`. API: `GET/POST /cms/api/users`, `PUT/DELETE /cms/api/users/:id`. Primer usuario se crea como propietario; solo propietarios pueden acceder al panel.
- **DetailModal:** componente reutilizable `routes/admin/components/DetailModal.astro` para crear/editar entidades en modal (mismo diseño que formularios). Usado en Páginas y Usuarios.
- **ConfirmDialog:** componente `routes/admin/components/ConfirmDialog.astro` para acciones destructivas. Diálogo centrado con overlay (mismo patrón que el modal de detalle). Expone `window.cmsConfirm(options)` que devuelve `Promise<boolean>`.
- **Eliminar en Páginas:** botón eliminar en la tabla de Páginas con confirmación vía `cmsConfirm` y `DELETE /cms/api/pages/:id`.

### Changed

- **Páginas:** creación y edición se hacen en modal en la misma pantalla de listado (`pages.astro`). Eliminadas las rutas dedicadas `pages-new.astro` y `pages-[id].astro`.
- **Tablas (diseño unificado):** primera columna solo botón editar (lápiz), última columna solo botón eliminar (papelera), alineado a la derecha. Tipografía de celdas a 0.75rem. Botones de acción 1.5rem con iconos 12px; `margin-bottom: 0` para alineación vertical.
- **Badges:** menos padding (0.125rem 0.375rem), `inline-flex` y `vertical-align: middle` para alineación en tablas.
- **Confirmación:** las acciones destructivas usan `cmsConfirm` en lugar de `confirm()` nativo.
- **Documentación:** README raíz del demo y `lib/astro-blocks/README.md` actualizados (Usuarios, diálogos de confirmación). AGENTS.md con ConfirmDialog en la estructura y patrón overlay/panel.

### Removed

- Rutas `routes/admin/pages-new.astro` y `routes/admin/pages-[id].astro`.

---

## [0.2.0] - 2025-03-15

### Added

- **Página Regenerar sitio** (`/cms/rebuild`): nueva entrada en el menú Configuración que lleva a una página con texto explicativo (regeneración de HTML, recursos, sitemap) y botón de confirmación que llama a `POST /cms/api/rebuild`. La acción ya no está en el formulario de edición de página.

### Changed

- **Formularios:** botones de acción siempre abajo a la derecha (no a ancho completo). En formularios con página previa (p. ej. editar página), el botón «Volver» queda abajo a la izquierda.
- **Alineación de botones:** misma altura y alineación para todos los botones (Volver, Guardar, etc.) mediante `height: 2rem`, `inline-flex` y `box-sizing: border-box`. Eliminado borde extra en el botón primario.
- **Diseño más compacto:** menos espaciado en formularios y páginas de detalle (márgenes de `.cms-field`, `.cms-form-actions`, padding de `.cms-card` y `.cms-main`), tipografía de labels e inputs reducida a 0.75rem.
- **Footer de formularios:** separación visual con `border-top` en la línea de botones; reducido el espacio bajo los botones (padding inferior de card y main) para un pie más compacto.
- **Documentación:** README y AGENTS.md actualizados con la estructura del panel (menú Configuración, ruta `/cms/rebuild`), convenciones de formularios y estilos.

### Removed

- Botón «Regenerar sitio» del formulario de edición de página (la acción se realiza desde Configuración → Regenerar sitio).

---

## [0.1.0] - (inicial)

- Panel de administración en `/cms` con Pico CSS, Animate.css, Lucide.
- Gestión de páginas, menús y ajustes del sitio; datos en JSON en `data/`.
- API bajo `/cms/api` (páginas, site, menús, upload, rebuild).
- White-label (colores primario/secundario en Ajustes).
- Autenticación por `CMS_SECRET` y cabecera `x-cms-secret`.
