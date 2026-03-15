# Guía para agentes – AstroBlocks

Documento de referencia para iteraciones futuras sobre el CMS. Describe la estructura, convenciones y puntos de extensión.

---

## 1. Estructura del directorio

```
lib/astro-blocks/
├── plugin/           # Integración Astro (injectRoute, runtime, config)
│   ├── index.mjs     # Entry del plugin; hook astro:config:setup
│   └── index.d.mts   # Tipos (AstroBlocksOptions)
├── contract/         # Contrato de componentes (defineBlockSchema)
├── api/              # Capa de datos y handlers HTTP
├── routes/           # Entrypoints inyectados (no están en src/pages)
│   ├── admin/        # Panel: layout.astro, components/, index, pages, users, settings, menus, rebuild
│   │   └── components/
│   │       ├── DetailModal.astro   # Modal reutilizable para crear/editar (mismo diseño que formularios)
│   │       └── ConfirmDialog.astro  # Diálogo de confirmación (overlay + panel centrado); expone window.cmsConfirm()
│   └── api/          # catchall.mjs, sitemap-get.mjs, robots-get.mjs
├── styles/           # Estilos del panel (white-label)
│   └── cms-admin.css # Overrides Pico, layout, footer (.cms-footer, .cms-footer-logo), componentes, .cms-detail-modal, .cms-dragging, .cms-dropzone
├── img/              # Assets del paquete (logo para footer y README)
│   └── blocks_logo.png
├── utils/
├── package.json      # dependencies: @picocss/pico, animate.css, sortablejs, simple-dropzone
├── README.md
└── AGENTS.md
```

- **Datos del proyecto (fuera del paquete):** `data/` y `public/uploads/` en la **raíz del proyecto**. El plugin usa `projectRoot` (p. ej. `process.cwd()` o `ASTRO_BLOCKS_PROJECT_ROOT`).

---

## 2. Rutas y prefijos

- **Panel:** todo bajo **`/cms`**: `/cms`, `/cms/pages`, `/cms/users`, `/cms/settings`, `/cms/menus`, `/cms/rebuild`. El detalle (crear/editar) se hace en modal en la propia lista, no hay rutas `/new` ni `/[id]`.
- **API:** bajo **`/cms/api`**: `/cms/api/pages`, `/cms/api/pages/[id]`, `/cms/api/site`, `/cms/api/menus`, `/cms/api/upload`, `/cms/api/rebuild`.
- **Páginas del sitio:** ruta inyectada **`/[...slug]`** (entrypoint `routes/page.astro`); home = slug vacío o `/`.
- **Sitemap / robots:** `/sitemap-index.xml`, `/robots.txt` (endpoints con `prerender = false`).

Al añadir rutas nuevas del panel o de la API, mantener estos prefijos y actualizar enlaces y `fetch()` en los .astro del admin.

**Estructura del panel:** `layout.astro` incluye topbar (logo/título + perfil con dropdown “Salir”), sidebar con menú agrupado (Dashboard; Contenido: Páginas, Menús; Configuración: Ajustes, Regenerar sitio), y **footer fijo** (`.cms-footer`) con el logo de AstroBlocks (`img/blocks_logo.png`, optimizado con `astro:assets`), nombre y versión. El contenido hace scroll entre topbar y footer. Iconos con `@lucide/astro`. La acción “Regenerar sitio” es una página dedicada (`/cms/rebuild`, `admin/rebuild.astro`) con texto explicativo y botón que llama a `POST /cms/api/rebuild`; no va en el formulario de edición de página.

---

## 3. Estilos del panel (Pico CSS, Animate.css, tema white-label)

- **Tailwind eliminado.** El panel no usa Tailwind ni ninguna integración de estilos inyectada desde el plugin.
- **Base UI:** Pico CSS (`@picocss/pico`). Se importa en `routes/admin/layout.astro` junto con Animate.css y `styles/cms-admin.css`. Orden: Pico → Animate.css → cms-admin.css para que los overrides del CMS tengan prioridad.
- **Tema:** En el layout se inyectan en `<body class="cms-root">` las variables `--cms-primary` y `--cms-secondary` desde `site.primaryColor` y `site.secondaryColor` (Settings). En `cms-admin.css`, `.cms-root` redefine `--pico-primary` (y variantes) con `var(--cms-primary)` para que Pico use el color del tema. Todo el panel debe usar esas variables o clases `.cms-*` para mantener white-label.
- **styles/cms-admin.css:** Overrides de Pico, layout (`.cms-wrap`, `.cms-sidebar`, `.cms-main`, `.cms-nav`, `.cms-topbar`, `.cms-login-wrap`), componentes (`.cms-card`, `.cms-btn`, `.cms-table`, `.cms-field`, `.cms-badge`), utilidades (`.cms-stack`, `.cms-cluster`, `.cms-title`, `.cms-muted`, `.cms-hidden`), animaciones (`.cms-animate-in`), Sortable (`.cms-dragging`, `.cms-drag-handle`), dropzone (`.cms-dropzone`, `.cms-dropzone--active`). **Formularios:** `.cms-form-actions` con `.cms-form-actions-left` (ej. Volver) y `.cms-form-actions-right` (Guardar, etc.); botones con misma altura (`height: 2rem`), alineados; primario sin borde, secundario/ghost con borde; diseño compacto (`.cms-field` con menor margen y fuente 0.75rem). **Modal de detalle:** usar el componente `routes/admin/components/DetailModal.astro` para crear/editar entidades; estilos `.cms-detail-modal`, `.cms-detail-modal-panel`, `.cms-detail-modal-title`, `.cms-detail-modal-body`, `.cms-detail-modal-actions` (misma línea que `.cms-form-actions`). El modal recibe `id`, `title` (opcional; se puede actualizar por JS), slot por defecto (formulario), `slot="actions-left"` (ej. Cancelar) y `slot="actions-right"` (ej. Guardar/Crear). Cerrar con `dialog.close()`; botón de cancelar con `data-close-modal="id-del-dialog"`. **Tablas:** mismo lenguaje de diseño en todas las tablas: todas las celdas con el mismo `font-size` (0.75rem). Primera columna (`.cms-table-actions`): solo botón editar (icono lápiz, `.cms-table-btn-edit`, aria-label="Editar"). Última columna (`.cms-table-actions-delete`): solo botón eliminar (icono papelera, `.cms-table-btn-delete`, rojo, aria-label="Eliminar"), alineado a la derecha. Iconos Lucide: Pencil, Trash2. **Confirmación destructiva:** no usar `confirm()` nativo; usar el componente `routes/admin/components/ConfirmDialog.astro` y `window.cmsConfirm({ message, confirmLabel?, cancelLabel? })`, que devuelve una `Promise<boolean>`. El diálogo usa el mismo patrón que el modal de detalle: `<dialog>` a pantalla completa con fondo transparente y `::backdrop`; contenido en un panel centrado (`.cms-confirm-panel`) con borde, sombra y padding. Para reordenar listas: Sortable.js con `ghostClass: 'cms-dragging'`. Para upload: simple-dropzone con `cms-dropzone`.

## 4. Archivos clave

| Archivo | Responsabilidad |
|--------|------------------|
| `plugin/index.mjs` | Genera `.astro-blocks/runtime.mjs`, inyecta rutas, define alias `astro-blocks-runtime`, `ASTRO_BLOCKS_PROJECT_ROOT`. No inyecta integraciones de CSS. |
| `api/data.mjs` | Lee/escribe `data/pages.json`, `data/site.json`, `data/menus.json`. `ensureDefaultFiles()` crea `data/` y JSON por defecto si no existen. |
| `api/handlers.mjs` | Lógica de cada endpoint: auth con `CMS_SECRET`, CRUD páginas/site/menus, upload a `public/uploads`, rebuild (`npm run build`). |
| `routes/api/catchall.mjs` | Despacha por método y path (segmentos tras `/cms/api/`). `getPathSegments` usa `pathname.split('/').filter(Boolean).slice(2)`. |
| `routes/page.astro` | `getStaticPaths` desde `data/pages.json` (solo `status === 'published'`). Render con layout y `componentMap` del runtime; props SEO al layout. |
| `utils/paths.mjs` | Resolución de `projectRoot`, `data/`, `public/uploads`, directorio del paquete (para entrypoints). |

---

## 5. Contrato de componentes

- Los componentes del **proyecto** importan `defineBlockSchema` desde `astro-blocks/contract` y exportan `schema` con las props editables (type, label, options para select).
- El plugin genera en `.astro-blocks/runtime.mjs` imports del layout y de cada componente registrado en `components`; exporta `Layout` y `componentMap` (nombre → componente).
- En `page.astro` se hace `componentMap[block.type]` y se renderiza con `block.props`. Añadir un nuevo tipo de bloque = registrar el componente en la config del plugin y (opcionalmente) un nuevo tipo en `contract` si hace falta.

---

## 6. Pre-render vs server

- **Astro 6:** `output: 'static'`. Las rutas con `export const prerender = false` se sirven en el servidor (requieren adapter, p. ej. `@astrojs/node`).
- **Pre-render:** `page.astro` (páginas del sitio), y en el build actual también las pantallas estáticas del admin (index, pages, pages-new, settings, menus).
- **Server:** `routes/admin/pages-[id].astro`, `routes/admin/rebuild.astro`, `routes/api/catchall.mjs`, `sitemap-get.mjs`, `robots-get.mjs` tienen `prerender = false`. Si se quiere listado/dashboard siempre actualizados, añadir `prerender = false` a esos .astro del admin.

---

## 7. Páginas de detalle: siempre modal (coherencia de diseño)

- **Convención:** La creación y edición de una entidad (detalle) no son páginas separadas; se hacen con un **modal** en la propia página de listado.
- **Componente:** Usar `routes/admin/components/DetailModal.astro`. Props: `id` (id del `<dialog>`), `title` (opcional). Slots: contenido por defecto (formulario con clase `cms-form`, campos con `cms-field`), `slot="actions-left"` (ej. botón Cancelar con `data-close-modal="id"`), `slot="actions-right"` (botón Guardar/Crear; puede usar `form="id-del-form"` si el form está en el slot por defecto).
- **Comportamiento:** Al abrir para **crear**: vaciar el formulario, poner título ej. "Nueva entidad", botón "Crear". Al abrir para **editar**: cargar datos (p. ej. `GET /cms/api/entidad` y localizar por id), rellenar el formulario, título "Editar entidad", botón "Guardar". Cerrar con `dialog.close()`; al enviar el form, llamar a la API (POST o PUT), cerrar modal y refrescar lista (o `location.reload()`).
- **Estilos:** El panel del modal (`.cms-detail-modal-panel`) sigue el mismo criterio que `.cms-card` (borde, sombra, padding). Los botones y campos usan `.cms-form-actions`, `.cms-btn`, `.cms-field` como en el resto del panel.

## 8. Tablas (lenguaje de diseño unificado)

- **Tipografía:** Todas las columnas con el mismo `font-size` (0.75rem). Celdas con monospace solo cuando sea dato técnico (ej. slug): clase `.cms-table-cell-monospace`.
- **Columnas de acciones:** Primera columna (`<th class="cms-table-actions">` vacío): solo botón **editar** (icono lápiz, `.cms-table-btn-edit`, `aria-label="Editar"`). Última columna (`<th class="cms-table-actions-delete">` vacío): solo botón **eliminar** (icono papelera, `.cms-table-btn-delete`, rojo, `aria-label="Eliminar"`), alineado a la derecha.
- **Iconos:** Pencil (editar) y Trash2 (eliminar) de `@lucide/astro`; en filas generadas por JS usar el mismo SVG inline (14×14, stroke 2).
- **Confirmación antes de eliminar:** Usar `window.cmsConfirm({ message: '...', confirmLabel: 'Eliminar' })` (devuelve `Promise<boolean>`). El componente `ConfirmDialog.astro` está incluido en el layout del panel.
- **Referencia:** `pages.astro` y `users.astro`. Mantener este criterio en futuras tablas del panel.

## 9. Extender el CMS (checklist para agentes)

- **Nueva pantalla del panel (listado + detalle):** crear `routes/admin/nombre.astro` con la tabla/listado y un **DetailModal** para crear/editar; inyectar en el plugin `injectRoute({ pattern: '/cms/nombre', entrypoint: ... })`, enlazar desde `layout.astro`. No crear páginas separadas para "nuevo" o "editar"; usar siempre el modal en la misma pantalla que el listado. **Tablas:** seguir el lenguaje de diseño unificado (sección 8): primera columna solo editar (lápiz), última columna solo eliminar (papelera roja) si aplica; font-size 0.75rem; para eliminar usar `window.cmsConfirm`. Ver `pages.astro` y `users.astro` como referencia.
- **Nueva pantalla sin listado (ej. ajustes):** crear `routes/admin/nombre.astro` sin modal (ej. `settings.astro`, `rebuild.astro`).
- **Nuevo endpoint API:** en `handlers.mjs` añadir la función; en `routes/api/catchall.mjs` despachar por método y segmentos; en el admin usar `fetch('/cms/api/...')`.
- **Nuevo tipo de prop en el contrato:** en `contract/index.mjs` (y tipos en `contract/index.d.mts`) añadir el tipo; en el panel, si hay UI generada por schema, soportar el nuevo tipo.
- **Cambio de prefijo de rutas:** buscar y reemplazar `/cms` y `/cms/api` en plugin, admin, robots-get.mjs y README; en el catchall ajustar `getPathSegments` (p. ej. `slice(2)` para `/cms/api/...`).
- **Al entregar cualquier cambio en el paquete:** hacer **bump de versión** en `package.json` y **añadir entrada** en `CHANGELOG.md` (ver sección 11). Sin excepción.

---

## 10. Plan de referencia

El diseño completo (requisitos, data en raíz, contrato, borrador/publicado, SEO, sitemap, robots, getMenu, etc.) está en el plan final del proyecto (documento "Plan final: CMS para Astro"). Usar este AGENTS.md junto con ese plan para mantener coherencia en iteraciones futuras.

---

## 11. README y versionado

### Estilo del README (`README.md`)

El README debe mantenerse **moderno y listo para repositorio público**. Al actualizarlo o ampliarlo:

- **Cabecera:** logo centrado (`img/blocks_logo.png`, ancho ~160px), título H1 centrado, tagline en una línea. **Badges** en una fila: versión del proyecto (enlazando a `CHANGELOG.md`; ej. `https://img.shields.io/badge/version-X.Y.Z-blue`), Node ≥18, Astro 6+ (shields.io). Al hacer bump de versión en `package.json`, actualizar también el número en el badge de versión del README.
- **Estructura:** sección **Características** al inicio (viñetas cortas). Luego **Requisitos** (tabla), **Instalación** (local / npm), **Configuración rápida** (bloque de código completo). Opciones del plugin y carpeta `data/` en **tablas**. Resto en secciones concisas con código cuando aplique.
- **Formato:** separadores `---` entre bloques, tablas para listas de opciones/archivos/requisitos, negrita y cursiva para resaltar. Sin párrafos largos; preferir listas y tablas.
- **Contenido:** si se añaden opciones del plugin, rutas del panel, archivos en `data/` o endpoints de API, actualizar README (tablas y texto) para que la documentación pública siga al día.

### Versionado y CHANGELOG

- **Versión:** al hacer cambios que afecten al paquete, **incrementar `version`** en `package.json` según semver: *patch* (0.0.X) para docs, fixes o cambios menores; *minor* (0.X.0) para nuevas funcionalidades compatibles; *major* (X.0.0) para cambios incompatibles.
- **CHANGELOG:** **siempre** que se modifique código o documentación del paquete, **añadir una entrada** en `CHANGELOG.md`. Formato [Keep a Changelog](https://keepachangelog.com/en/1.0.0/):
  - Nueva entrada al **inicio** del archivo, bajo el título "Changelog".
  - Encabezado: `## [X.Y.Z] - AAAA-MM-DD`.
  - Bloques `### Added`, `### Changed`, `### Fixed`, `### Removed` según corresponda.
  - Descripción breve y clara de cada cambio; enlaces a archivos o secciones si ayuda.
- No cerrar una iteración sin: (1) versión actualizada en `package.json`, (2) entrada correspondiente en `CHANGELOG.md`.

---

## 12. Commits

En este proyecto **todos los commits** siguen [Conventional Commits](https://www.conventionalcommits.org/). El mensaje debe tener una primera línea con tipo (y opcionalmente ámbito) y descripción; cuerpo y footer son opcionales.

**Tipos admitidos:**

| Tipo | Uso |
|------|-----|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `docs` | Solo documentación |
| `chore` | Mantenimiento (dependencias, tooling) |
| `refactor` | Refactor sin cambio de comportamiento |
| `style` | Formato, espacios, etc. (no lógica) |
| `test` | Añadir o cambiar tests |

Formato de la primera línea: `<tipo>[ámbito opcional]: <descripción>`.

- **Reviewed-by:** Todo commit debe incluir en el footer el trailer `Reviewed-by: <nombre> <email>`, donde nombre y email son los del **usuario Git que ejecuta** el commit (`git config user.name`, `git config user.email`). Identifica a la persona que revisa/ejecuta el cambio.
- **Sin etiquetas del agente:** No añadir en los commits ninguna etiqueta ni meta-etiqueta que identifique al agente o herramienta que generó el código (p. ej. Co-authored-by de un bot, "Generated-by", "Agent: …"). El historial refleja solo autores humanos y el Reviewed-by del usuario que ejecuta.
