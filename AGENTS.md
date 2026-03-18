<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Guía para agentes – AstroBlocks

Documento de referencia para iteraciones futuras sobre el CMS. Describe la estructura, convenciones y puntos de extensión.

---

## 1. Estructura del directorio

```
lib/astro-blocks/
├── plugin/           # Integración Astro (injectRoute, runtime, config)
│   └── index.ts      # Entry del plugin; hook astro:config:setup
├── contract/         # Contrato de componentes (defineBlockSchema)
│   └── index.ts
├── api/              # Capa de datos y handlers HTTP
│   ├── data.ts
│   └── handlers.ts
├── routes/           # Entrypoints inyectados (no están en src/pages)
│   ├── admin/        # Panel: layout.astro, components/, index, pages, users, settings, menus, cache
│   │   └── components/
│   │       ├── DetailModal.astro   # Modal reutilizable para crear/editar (mismo diseño que formularios)
│   │       ├── ConfirmDialog.astro # Diálogo de confirmación (overlay + panel centrado); expone window.cmsConfirm()
│   │       └── AlertDialog.astro    # Diálogo de aviso (mismo estilo); expone window.cmsAlert()
│   │   └── client/   # Helpers cliente compartidos y módulos para scripts del admin
│   └── api/          # catchall.ts
├── styles/           # Estilos del panel (white-label)
│   └── cms-admin.css # Overrides Pico, layout, footer (.cms-footer, .cms-footer-logo), componentes, .cms-detail-modal, .cms-dragging, .cms-dropzone
├── img/              # Assets del paquete (logo para footer y README)
│   └── blocks_logo.jpg
├── utils/            # Utilidades compartidas (bloques, slugs, paths, menús)
├── types/            # Tipos compartidos del dominio
├── scripts/          # Build local del paquete
├── dist/             # Artefacto distribuible generado por tsc + copia de assets
├── playgrounds/
│   └── basic/        # Proyecto Astro consumidor para validar el paquete
├── package.json      # exports tipados a dist/, scripts y workspaces
├── README.md         # Solo consumidor
├── DEVELOPING.md     # Solo mantenedor del paquete
├── LOCAL_PACKAGE_TESTING.md # Flujo temporal para probar el tarball local
└── AGENTS.md
```

- **Datos del proyecto (fuera del paquete):** `data/` y `public/uploads/` en la **raíz del proyecto**. El plugin usa `projectRoot` (p. ej. `process.cwd()` o `ASTRO_BLOCKS_PROJECT_ROOT`).

---

## 2. Rutas y prefijos

- **Panel:** todo bajo **`/cms`**: `/cms`, `/cms/pages`, `/cms/users`, `/cms/settings`, `/cms/menus`, `/cms/cache`. El detalle (crear/editar) se hace en modal en la propia lista, no hay rutas `/new` ni `/[id]`.
- **API:** bajo **`/cms/api`**: `/cms/api/pages`, `/cms/api/pages/[id]`, `/cms/api/site`, `/cms/api/menus`, `/cms/api/upload`, `/cms/api/cache/invalidate`.
- **Páginas del sitio:** ruta inyectada **`/[...slug]`**. En alpha, el modo por defecto es SSR con cache experimental de Astro (`routes/page.astro`). Si el consumidor fuerza `publicRendering: 'static'`, el plugin inyecta `routes/page-static.astro`. Home = slug vacío o `/`.
- **Sitemap / robots:** `/sitemap-index.xml`, `/robots.txt` (endpoints con `prerender = false`).

Al añadir rutas nuevas del panel o de la API, mantener estos prefijos y actualizar enlaces y `fetch()` en los .astro del admin.

**Estructura del panel:** `layout.astro` incluye topbar (logo/título + perfil con dropdown “Salir”), sidebar con menú agrupado (Dashboard; Contenido: Páginas, Menús; Configuración: Ajustes, Caché), y **footer fijo** (`.cms-footer`) con el logo de AstroBlocks (`img/blocks_logo.jpg`, optimizado con `astro:assets`), nombre y versión. El contenido hace scroll entre topbar y footer. Iconos con `@lucide/astro`. La pantalla `/cms/cache` se usa para invalidación total de caché; no lanza builds ni va en el formulario de edición de página.

---

## 3. Estilos del panel (Pico CSS, Animate.css, tema white-label y design system)

- **Tailwind eliminado.** El panel no usa Tailwind ni ninguna integración de estilos inyectada desde el plugin.
- **Base UI:** Pico CSS (`@picocss/pico`). Se importa en `routes/admin/layout.astro` junto con Animate.css y `styles/cms-admin.css`. Orden: Pico → Animate.css → cms-admin.css para que los overrides del CMS tengan prioridad.
- **Tema white-label:** En el layout se inyectan en `<body class="cms-root">` las variables `--cms-primary` y `--cms-secondary` desde `site.primaryColor` y `site.secondaryColor` (Settings). En `cms-admin.css`, `.cms-root` redefine `--pico-primary` (y variantes) con `var(--cms-primary)` para que Pico use el color del tema.

### 3.1. Principios del design system

El panel debe seguir siempre estos principios visuales:

- **90% neutro, 10% color de acento.** El color configurable (`--cms-primary`) es un acento, no el color dominante del layout.
- **White-label real:** el panel debe verse correcto con cualquier color primario configurable. No diseñar pensando en un azul fijo.
- **Superficies planas:** evitar elevaciones fuertes; usar superficies claras, bordes suaves y sombras muy ligeras.
- **Jerarquía por capas:** distinguir visualmente fondo de app, superficie de contenido y superficies de componentes (cards, tablas, modales), sin abusar del color.
- **Compacto pero profesional:** el panel está pensado para uso frecuente; mantener densidad alta, especialmente en tablas y formularios.
- **Decoración sutil:** se permite cierta personalidad visual, pero siempre funcional y contenida. No convertir el panel en una interfaz de marketing.

### 3.2. Reglas de color y superficies

- **Usar `--cms-primary` solo como acento** en:
  - botones primarios
  - item activo de sidebar
  - focus states de inputs
  - pequeños acentos interactivos
- **No usar `--cms-primary`** en:
  - fondos grandes del layout
  - cabeceras de tabla
  - fondos de cards
  - fondos de modales
  - superficies principales del panel
- **Colores semánticos independientes del tema:**
  - éxito/publicado → verde suave
  - borrador/neutro → gris suave
  - archivado/aviso → ámbar suave
  - destructivo → rojo refinado
- El layout debe apoyarse principalmente en neutros:
  - fondo de app ligeramente gris
  - cards y paneles en blanco o casi blanco
  - bordes suaves
  - hover states muy sutiles

### 3.3. `styles/cms-admin.css`

`cms-admin.css` es la fuente de verdad del design system del panel. Las mejoras visuales del admin deben implementarse preferentemente aquí.

Clases base del sistema:

- **Layout:** `.cms-wrap`, `.cms-sidebar`, `.cms-main`, `.cms-nav`, `.cms-topbar`, `.cms-footer`, `.cms-login-wrap`
- **Superficies y componentes:** `.cms-card`, `.cms-table`, `.cms-btn`, `.cms-field`, `.cms-badge`
- **Utilidades:** `.cms-stack`, `.cms-cluster`, `.cms-title`, `.cms-muted`, `.cms-hidden`
- **Animaciones:** `.cms-animate-in`
- **Drag & drop:** `.cms-dragging`, `.cms-drag-handle`
- **Upload:** `.cms-dropzone`, `.cms-dropzone--active`

### 3.4. Sidebar y topbar

- **Sidebar:** debe ser una superficie neutra, separada del contenido por borde sutil.
- El item activo debe usar `--cms-primary` de forma **suave**:
  - tinte leve de fondo
  - texto/icono con color primario
  - sin “pill” gigante ni bloque excesivamente decorativo
- Hover de navegación: sutil, sin grandes contrastes.
- **Topbar:** fondo claro, borde inferior sutil, espaciado limpio; debe verse integrada en el shell, no como una barra decorativa.
- **Dropdown de perfil:** panel limpio, borde suave, sombra ligera, mismo lenguaje visual que cards y modales.

### 3.5. Botones

- **Botones siempre flat:** no usar degradados en ningún botón.
- Jerarquía estándar:
  - **Primario:** fondo sólido con `--cms-primary`, texto claro
  - **Secundario:** neutro con borde o fondo muy suave
  - **Ghost:** mínimo, sin peso excesivo
  - **Danger:** rojo refinado, no estridente
- Todos los botones deben compartir:
  - radio consistente
  - altura consistente
  - padding consistente
  - transición de hover/focus sutil
- En formularios usar `.cms-form-actions`, `.cms-form-actions-left` y `.cms-form-actions-right`.

### 3.6. Formularios

- Los formularios del panel deben ser **compactos y limpios**.
- Campos con `.cms-field`, espaciado controlado y tipografía contenida.
- Inputs, textarea y select deben compartir:
  - borde suave
  - radio consistente
  - padding compacto
  - focus state con `--cms-primary`
- El focus visual debe reforzar usabilidad, no protagonismo decorativo.
- Mantener consistencia entre formularios de páginas, menús, usuarios, ajustes y modales.

### 3.7. Cards y paneles

- Las cards deben ser **planas**, con:
  - fondo claro
  - borde suave
  - sombra mínima, casi imperceptible
- No usar elevaciones agresivas ni estilos tipo template genérico.
- El contraste entre card y fondo debe venir más del borde y de la jerarquía del layout que de la sombra.

### 3.8. Modales y diálogos

- **Componente de detalle:** usar siempre `routes/admin/components/DetailModal.astro` para crear/editar entidades.
- El panel del modal (`.cms-detail-modal-panel`) debe seguir el mismo criterio visual que `.cms-card`:
  - superficie clara
  - borde suave
  - sombra ligera
  - padding consistente
- El modal debe tener:
  - cabecera clara
  - separación visual razonable con el body
  - acciones compactas y bien alineadas
- **Confirmaciones y avisos:** nunca usar `confirm()` ni `alert()` nativos. Usar siempre:
  - `window.cmsConfirm(...)`
  - `window.cmsAlert(...)`

### 3.9. Tablas (lenguaje de diseño unificado)

- Las tablas son un elemento central del CMS. Deben ser:
  - compactas
  - legibles
  - consistentes
  - de aspecto profesional
- **Tipografía:** todas las celdas con `font-size: 0.75rem`.
- **Cabecera:** fondo ligeramente diferenciado del body, texto algo más marcado que el texto secundario, con jerarquía clara.
- **Hover de fila:** sutil; suficiente para dar vida a la tabla sin romper su densidad.
- **Columnas de acciones:**
  - primera columna → solo editar
  - última columna → solo eliminar
- **Iconos:** Pencil y Trash2 de `@lucide/astro`; mantener tamaño y grosor consistentes.
- **Celdas técnicas:** usar `.cms-table-cell-monospace` para slugs o valores similares.
- **Indicador indexable:** usar `.cms-indexable-dot`.
- **Densidad:** la tabla compacta es la referencia. Si en el futuro se quiere soportar una variante más cómoda, debe hacerse como extensión explícita (por ejemplo, clase de densidad), manteniendo la compacta como default.

### 3.10. Dashboard

El dashboard debe seguir el mismo design system, pero con reglas específicas:

- No debe parecer un panel de analítica ni un dashboard financiero.
- Debe ser una **pantalla de control del CMS**, no una pantalla decorativa.
- Debe aprovechar mejor el espacio horizontal y estructurarse por bloques:
  - cabecera
  - acciones rápidas
  - métricas compactas
  - bloques útiles (por ejemplo, páginas recientes / accesos rápidos)
- No inventar métricas o gráficos sin datos reales.
- Las cards del dashboard deben seguir el mismo criterio:
  - fondo claro
  - borde suave
  - sombra mínima
  - sin fondos de icono exagerados
- El color primario configurable debe usarse solo como acento, también en dashboard.

### 3.11. Tips y bloques informativos

- Cuando se quiera mostrar información contextual o tips, seguir el patrón de la página de menús:
  - card superior
  - icono al inicio
  - texto fluido dentro de `.cms-menus-info-body`
- Mantener estilo informativo, no promocional.

### 3.12. Qué NO hacer nunca en el panel

- No introducir Tailwind ni frameworks visuales nuevos.
- No usar degradados en botones.
- No diseñar contra un color fijo; el sistema es white-label.
- No abusar de sombras, blur o glassmorphism.
- No convertir el admin en una landing page.
- No romper la compacidad de tablas y formularios sin una razón clara.
- No crear estilos ad hoc para cada pantalla si pueden resolverse dentro del sistema compartido.

---

## 4. Archivos clave

| Archivo | Responsabilidad |
|--------|------------------|
| `plugin/index.ts` | Genera `.astro-blocks/runtime.mjs`, inyecta rutas, define alias `astro-blocks-runtime`, `ASTRO_BLOCKS_PROJECT_ROOT`. No inyecta integraciones de CSS. |
| `api/data.ts` | Lee/escribe `data/pages.json`, `data/site.json`, `data/menus.json`. `ensureDefaultFiles()` crea `data/` y JSON por defecto si no existen. |
| `api/handlers.ts` | Lógica de cada endpoint: auth con `CMS_SECRET`, CRUD páginas/site/menus, upload a `public/uploads` e invalidación de caché. |
| `routes/api/catchall.ts` | Despacha por método y path (segmentos tras `/cms/api/`). `getPathSegments` usa `pathname.split('/').filter(Boolean).slice(2)`. |
| `routes/page.astro` | Ruta pública SSR por defecto en alpha. Lee `data/pages.json` en cada request, aplica `Astro.cache.set(...)` si la cache experimental está activa, resuelve la página publicada por slug y renderiza con layout + `componentMap`. |
| `routes/page-static.astro` | Variante estática para `publicRendering: 'static'`; usa `getStaticPaths()` y mantiene el flujo prerenderizado tradicional. |
| `routes/robots-get.ts` | Genera `robots.txt` con `Disallow: /cms`, líneas `Disallow` por cada página publicada y no indexable (excepto home), y `Sitemap`. |
| `utils/paths.ts` | Resolución de `projectRoot`, `data/`, `public/uploads`, directorio del paquete (para entrypoints). |
| `utils/blocks.ts` | Resolución de keys de bloque, serialización de schemas y validación compartida de bloques. |
| `utils/slug.ts` | Normalización de slugs, canonical y SEO derivado para el render público. |
| `scripts/build.mjs` | Build del paquete: copia assets/`.astro` a `dist/` y compila TypeScript con `tsc`. |

---

## 5. Contrato de componentes

- Los componentes del **proyecto** importan `defineBlockSchema` desde `astro-blocks/contract` y exportan `schema` con `defineBlockSchema(definition, import.meta.url)`. La definición tiene `name`, `icon?` (nombre Lucide), `key?` e `items` (Record de PropDef con `type`, `label`, `required?`, `options?`). El path del componente se guarda en el schema (propiedad interna) para que el plugin genere el runtime.
- La config del plugin usa **solo** `blocks: Schema[]` (array de schemas importados desde cada componente). No existe la opción `components`.
- El plugin genera en `.astro-blocks/runtime.mjs` imports del layout y de cada bloque; exporta `Layout`, `componentMap` (key → componente) y `schemaMap` (key → schema serializable: name, icon, items). Keys duplicadas o schema sin path → error en `generateRuntime`.
- En `page.astro` se hace `componentMap[block.type]` y se renderiza con `block.props`. Añadir un nuevo tipo de bloque = crear el componente con `export const schema = defineBlockSchema(..., import.meta.url)` y añadirlo al array `blocks` en la config.

---

## 6. Pre-render vs server

- **Astro 6:** `output: 'static'`. Las rutas con `export const prerender = false` se sirven en el servidor (requieren adapter, p. ej. `@astrojs/node`).
- **Pre-render:** en el build actual, las pantallas estáticas del admin que no declaran `prerender = false`, y opcionalmente `routes/page-static.astro` si el consumidor fuerza `publicRendering: 'static'`.
- **Server:** en alpha, `routes/page.astro` es la referencia por defecto para páginas públicas. También usan `prerender = false` `routes/admin/cache.astro` (inyectada como `/cms/cache`), `routes/api/catchall.ts`, `sitemap-get.ts`, `robots-get.ts`, `uploads-get.ts`, `routes/admin/menus.astro` y `routes/admin/users.astro`.

---

## 7. Páginas de detalle: siempre modal (coherencia de diseño)

- **Convención:** La creación y edición de una entidad (detalle) no son páginas separadas; se hacen con un **modal** en la propia página de listado.
- **Componente:** Usar `routes/admin/components/DetailModal.astro`. Props: `id` (id del `<dialog>`), `title` (opcional). Slots: contenido por defecto (formulario con clase `cms-form`, campos con `cms-field`), `slot="actions-left"` (ej. botón Cancelar con `data-close-modal="id"`), `slot="actions-right"` (botón Guardar/Crear; puede usar `form="id-del-form"` si el form está en el slot por defecto).
- **Comportamiento:** Al abrir para **crear**: vaciar el formulario, poner título ej. "Nueva entidad", botón "Crear". Al abrir para **editar**: cargar datos (p. ej. `GET /cms/api/entidad` y localizar por id), rellenar el formulario, título "Editar entidad", botón "Guardar". Cerrar con `dialog.close()`; al enviar el form, llamar a la API (POST o PUT), cerrar modal y refrescar lista (o `location.reload()`).
- **Formulario de página (SEO):** Campos predefinidos (título SEO, descripción, canonical, imagen con botón "Subir imagen", nofollow). El bloque de campos SEO (`#page-detail-seo-fields`) se muestra u oculta según el checkbox "Indexable"; si no indexable, se muestra el hint `#page-detail-seo-hidden-hint`. En PUT, el body envía `seo` como objeto; el handler hace merge con `existing.seo` para preservar claves extra.
- **Estilos:** El panel del modal (`.cms-detail-modal-panel`) sigue el mismo criterio que `.cms-card` (borde, sombra, padding). Los botones y campos usan `.cms-form-actions`, `.cms-btn`, `.cms-field` como en el resto del panel.

## 8. Tablas (lenguaje de diseño unificado)

- **Tipografía:** Todas las columnas con el mismo `font-size` (0.75rem). Celdas con monospace solo cuando sea dato técnico (ej. slug): clase `.cms-table-cell-monospace`.
- **Columnas de acciones:** Primera columna (`<th class="cms-table-actions">` vacío): solo botón **editar** (icono lápiz, `.cms-table-btn-edit`, `aria-label="Editar"`). Última columna (`<th class="cms-table-actions-delete">` vacío): solo botón **eliminar** (icono papelera, `.cms-table-btn-delete`, rojo, `aria-label="Eliminar"`), alineado a la derecha.
- **Indicador indexable (páginas):** Columna "Indexable" con `<span class="cms-indexable-dot cms-indexable-dot--yes|no" role="img" aria-label="Indexable|No indexable">`. Estilos en `cms-admin.css`: `.cms-indexable-dot` (8px, border-radius 50%), `--yes` verde, `--no` rojo.
- **Iconos:** Pencil (editar) y Trash2 (eliminar) de `@lucide/astro`; en filas generadas por JS usar el mismo SVG inline (14×14, stroke 2).
- **Confirmación antes de eliminar:** Usar `window.cmsConfirm({ message: '...', confirmLabel: 'Eliminar' })` (devuelve `Promise<boolean>`). El componente `ConfirmDialog.astro` está incluido en el layout del panel.
- **Referencia:** `pages.astro` y `users.astro`. Mantener este criterio en futuras tablas del panel.

## 9. Extender el CMS (checklist para agentes)

- **Nueva pantalla del panel (listado + detalle):** crear `routes/admin/nombre.astro` con la tabla/listado y un **DetailModal** para crear/editar; inyectar en el plugin `injectRoute({ pattern: '/cms/nombre', entrypoint: ... })`, enlazar desde `layout.astro`. No crear páginas separadas para "nuevo" o "editar"; usar siempre el modal en la misma pantalla que el listado. **Tablas:** seguir el lenguaje de diseño unificado (sección 8): primera columna solo editar (lápiz), última columna solo eliminar (papelera roja) si aplica; font-size 0.75rem; para eliminar usar `window.cmsConfirm`. Ver `pages.astro` y `users.astro` como referencia.
- **Nueva pantalla sin listado (ej. ajustes o caché):** crear `routes/admin/nombre.astro` sin modal (ej. `settings.astro`, `cache.astro`).
- **Nuevo endpoint API:** en `handlers.ts` añadir la función; en `routes/api/catchall.ts` despachar por método y segmentos; en el admin usar `fetch('/cms/api/...')`.
- **Menús:** Estructura en `data/menus.json`: `{ menus: [ { id, name, selector, items } ] }`; cada ítem tiene `name`, `path` y opcionalmente `children` (submenús anidados). API: GET/POST `/cms/api/menus`, PUT/DELETE `/cms/api/menus/:id`. Selector: solo `[a-zA-Z0-9_-]`, único. Ruta obligatoria en todos los ítems; validación en cliente y API. Reordenación de ítems y submenús con Sortable.js (`ghostClass: 'cms-dragging'`, handle `.cms-drag-handle`). `getMenu(selector)` devuelve ítems con `children` para el sitio.
- **Nuevo tipo de prop en el contrato:** en `contract/index.ts` y `types/index.ts` añadir el tipo; en el panel, si hay UI generada por schema, soportar el nuevo tipo.
- **Cambio de prefijo de rutas:** buscar y reemplazar `/cms` y `/cms/api` en plugin, admin, robots-get.ts y README; en el catchall ajustar `getPathSegments` (p. ej. `slice(2)` para `/cms/api/...`).
- **Al entregar cambios en el paquete:** no hacer bump de versión ni entrada en CHANGELOG hasta que la versión se dé por cerrada (ver sección 12). En el momento en que se pida hacer el commit, previamente se actualiza la versión en `package.json` y se añade la entrada en `CHANGELOG.md`.
-  **Toda nueva pantalla o componente del panel** debe reutilizar el design system existente en `cms-admin.css`. Antes de crear clases nuevas, revisar si el caso encaja en `.cms-card`, `.cms-table`, `.cms-btn`, `.cms-field`, `.cms-badge`, `.cms-stack`, `.cms-cluster` o variantes existentes. Cualquier nueva clase visual debe mantener las reglas del sistema: white-label real, superficies planas, bordes suaves, sombras mínimas, color primario como acento y densidad compacta.

---

## 10. Compatibilidad con versiones antiguas

**Hasta próximo aviso:** no se da soporte a versiones antiguas. Toda implementación que suponga un *breaking change* se implementa **sin fallback** ni migración: se asume el nuevo formato o contrato y se documenta el cambio. No añadir lógica de compatibilidad hacia atrás (p. ej. detectar formato antiguo en `loadMenus` y convertirlo); si se cambia la estructura de datos o la API, el código solo maneja la versión nueva.

---

## 11. Plan de referencia

El diseño completo (requisitos, data en raíz, contrato, borrador/publicado, SEO, sitemap, robots, getMenu, etc.) está en el plan final del proyecto (documento "Plan final: CMS para Astro"). Usar este AGENTS.md junto con ese plan para mantener coherencia en iteraciones futuras.

---

## 12. README y versionado

### Estilo del README (`README.md`)

El README debe mantenerse **100% orientado al consumidor**. Al actualizarlo o ampliarlo:

- **Cabecera:** logo centrado (`img/blocks_logo.jpg`, ancho ~160px), título H1 centrado, tagline en una línea. **Badges** en una fila: versión del proyecto (enlazando a `CHANGELOG.md`; ej. `https://img.shields.io/badge/version-X.Y.Z-blue`), badge de estado (ej. alpha) si aplica, Node ≥18, Astro 6+ (shields.io). Al hacer bump de versión en `package.json`, actualizar también el número en el badge de versión del README.
- **Estructura:** sección **Características** al inicio (viñetas cortas). Luego **Requisitos** (tabla), **Instalación** (npm / tarball local), **Configuración rápida** (bloque de código completo) y **Recommended Imports**. Opciones del plugin y carpeta `data/` en **tablas**. Resto en secciones concisas con código cuando aplique.
- **Formato:** separadores `---` entre bloques, tablas para listas de opciones/archivos/requisitos, negrita y cursiva para resaltar. Sin párrafos largos; preferir listas y tablas.
- **Contenido:** si se añaden opciones del plugin, rutas del panel, archivos en `data/` o endpoints de API, actualizar README (tablas y texto) para que la documentación pública siga al día.
- **No mezclar audiencias:** notas de build, playground, `npm pack` o mantenimiento interno deben ir a `DEVELOPING.md` o `LOCAL_PACKAGE_TESTING.md`, no al README.

### Guía del mantenedor

- `DEVELOPING.md` es la guía del mantenedor del paquete.
- `LOCAL_PACKAGE_TESTING.md` describe cómo compilar, empaquetar con `npm pack` e instalar el tarball en un proyecto Astro limpio.
- No convertir `AGENTS.md` en sustituto de esas guías; `AGENTS.md` es operativo para agentes, no documentación para consumidores.

### Tooling y DX

- El flujo oficial de desarrollo del paquete usa **TypeScript + `tsc` + `dist/`**.
- El flujo oficial de validación del artefacto distribuible usa **`npm pack`**.
- Hay un **playground** en `playgrounds/basic` para validar el paquete desde un proyecto Astro real.
- En alpha, la dirección preferida del producto es **`publicRendering: 'server'` + cache experimental de Astro**.
- AstroBlocks no implementa una cache propia; usa `Astro.cache` y `context.cache`.
- Tags estándar de cache:
  - `astro-blocks`
  - `astro-blocks:pages`
  - `astro-blocks:page:<id>`
  - `astro-blocks:path:<path>`
  - `astro-blocks:menus`
  - `astro-blocks:site`
  - `astro-blocks:global`
- No documentar ni recomendar `file:` como flujo principal de desarrollo o validación.
- No usar alias `@` en imports internos del paquete. Mantener imports internos **relativos**.

### Versionado y CHANGELOG

- **Cuándo actualizar:** No se crea la versión ni la entrada en el CHANGELOG hasta que la versión se dé por **cerrada** y se decida hacer el commit. Durante el desarrollo o al entregar cambios, el agente no debe hacer bump de versión ni tocar el CHANGELOG. En el momento en que el usuario pida **hacer el commit**, previamente se hace: (1) incrementar `version` en `package.json`, (2) añadir la entrada en `CHANGELOG.md`; después se realiza el commit. Ver también sección 10 (compatibilidad: sin fallback).
- **Versión:** al cerrar versión, incrementar `version` en `package.json` según semver: *patch* (0.0.X) para docs, fixes o cambios menores; *minor* (0.X.0) para nuevas funcionalidades compatibles; *major* (X.0.0) para cambios incompatibles.
- **CHANGELOG:** Formato [Keep a Changelog](https://keepachangelog.com/en/1.0.0/):
  - Nueva entrada al **inicio** del archivo, bajo el título "Changelog".
  - Encabezado: `## [X.Y.Z] - AAAA-MM-DD`.
  - Bloques `### Added`, `### Changed`, `### Fixed`, `### Removed` según corresponda.
  - Descripción breve y clara de cada cambio; enlaces a archivos o secciones si ayuda.

---

## 13. Commits

En este proyecto **todos los commits** siguen [Conventional Commits](https://www.conventionalcommits.org/). El mensaje debe tener una primera línea con tipo (y opcionalmente ámbito) y descripción; cuerpo y footer son opcionales.

- **Idioma:** **Todos los mensajes de commit se escriben siempre en inglés** (tipo, descripción, cuerpo y footer). Sin excepciones.
- **Antes de commit:** si se pide hacer el commit y hay cambios en el paquete que aún no tienen versión cerrada, primero actualizar `package.json` (bump) y `CHANGELOG.md` (entrada nueva) según la sección 12, y después ejecutar el commit.

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

---

## 14. Copyright y licencia

- **Archivos nuevos:** Al generar cualquier archivo nuevo (código o documentación), incluir siempre al inicio el bloque de copyright BSL con el formato adecuado al tipo de archivo: bloque `/* ... */` para .mjs, .js, .mts, .ts, .css y .astro (en .astro al inicio del frontmatter, no en el template, para que no se renderice); comentario HTML `<!-- ... -->` para .md. No añadir copyright a archivos JSON (package.json, etc.) por limitación del formato.
- **Cambio de año:** Al cambiar el año natural (p. ej. de 2026 a 2027), actualizar el año en **todos** los bloques de copyright del repositorio (búsqueda y reemplazo del año en esos bloques). Incluir esta tarea en la revisión de inicio de año o cuando se detecte el cambio.
