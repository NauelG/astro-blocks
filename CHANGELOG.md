# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
