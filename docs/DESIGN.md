<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# DESIGN.md — Design system del panel AstroBlocks

Sistema de diseño del panel de administración (white-label). Léelo antes de cualquier trabajo de UI
del admin. La fuente de verdad de estilos es `src/styles/cms-admin.css`.

---

## 1. Estilos del panel (Pico CSS, Animate.css, tema white-label y design system)

- **Tailwind eliminado.** El panel no usa Tailwind ni ninguna integración de estilos inyectada desde el plugin.
- **Base UI:** Pico CSS (`@picocss/pico`). Se importa en `src/routes/admin/layout.astro` junto con Animate.css y `src/styles/cms-admin.css`. Orden: Pico → Animate.css → cms-admin.css para que los overrides del CMS tengan prioridad.
- **Tema white-label:** En el layout se inyectan en `<body class="cms-root">` las variables `--cms-primary` y `--cms-secondary` desde `site.primaryColor` y `site.secondaryColor` (Settings). En `cms-admin.css`, `.cms-root` redefine `--pico-primary` (y variantes) con `var(--cms-primary)` para que Pico use el color del tema.

### 1.1. Principios del design system

El panel debe seguir siempre estos principios visuales:

- **90% neutro, 10% color de acento.** El color configurable (`--cms-primary`) es un acento, no el color dominante del layout.
- **White-label real:** el panel debe verse correcto con cualquier color primario configurable. No diseñar pensando en un azul fijo.
- **Superficies planas:** evitar elevaciones fuertes; usar superficies claras, bordes suaves y sombras muy ligeras.
- **Jerarquía por capas:** distinguir visualmente fondo de app, superficie de contenido y superficies de componentes (cards, tablas, modales), sin abusar del color.
- **Compacto pero profesional:** el panel está pensado para uso frecuente; mantener densidad alta, especialmente en tablas y formularios.
- **Decoración sutil:** se permite cierta personalidad visual, pero siempre funcional y contenida. No convertir el panel en una interfaz de marketing.
- **Diseño por sustracción:** ante la duda, quitar antes que añadir. Evitar información duplicada, cards redundantes, labels repetidas y bloques que compitan entre sí sin aportar claridad.
- **Jerarquía tranquila:** topbar, toolbars, tips y bloques auxiliares deben sentirse secundarios respecto al contenido principal; no deben tener el mismo peso visual que una card operativa o una tabla.

### 1.2. Reglas de color y superficies

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

### 1.3. `src/styles/cms-admin.css`

`cms-admin.css` es la fuente de verdad del design system del panel. Las mejoras visuales del admin deben implementarse preferentemente aquí.

Clases base del sistema:

- **Layout:** `.cms-wrap`, `.cms-sidebar`, `.cms-main`, `.cms-nav`, `.cms-topbar`, `.cms-footer`, `.cms-login-wrap`
- **Superficies y componentes:** `.cms-card`, `.cms-table`, `.cms-btn`, `.cms-field`, `.cms-badge`
- **Utilidades:** `.cms-stack`, `.cms-cluster`, `.cms-title`, `.cms-muted`, `.cms-hidden`
- **Animaciones:** `.cms-animate-in`
- **Drag & drop:** `.cms-dragging`, `.cms-drag-handle`
- **Upload:** `.cms-dropzone`, `.cms-dropzone--active`

### 1.4. Sidebar y topbar

- **Sidebar:** debe ser una superficie neutra, separada del contenido por borde sutil.
- El item activo debe usar `--cms-primary` de forma **suave**:
  - tinte leve de fondo
  - texto/icono con color primario
  - sin “pill” gigante ni bloque excesivamente decorativo
- Hover de navegación: sutil, sin grandes contrastes.
- **Branding del sidebar:** mantenerlo mínimo. El patrón actual de referencia es logo + `Content platform`; no duplicar ahí el nombre `AstroBlocks` si ya está presente en otros contextos del shell.
- **Topbar:** fondo claro, borde inferior sutil, espaciado limpio; debe verse integrada en el shell, no como una barra decorativa.
- **Topbar mínima:** no repetir marca o contexto ya visible en la navegación. La topbar no debe mostrar información redundante como una segunda línea de producto o acciones duplicadas.
- **Acción `Ver sitio`:** debe existir en un único punto principal de navegación contextual. Si ya está en topbar o en acciones de página, no duplicarla en el dropdown de perfil.
- **Dropdown de perfil:** panel limpio, borde suave, sombra ligera, mismo lenguaje visual que cards y modales.
- **Dropdown de perfil:** mantenerlo corto. Debe contener solo acciones de sesión o perfil; no usarlo como segundo menú de navegación.

### 1.5. Botones

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
- En la dirección actual del producto, los botones deben ser ligeramente compactos: evitar alturas “grandes de marketing” o CTAs sobredimensionados.
- En formularios usar `.cms-form-actions`, `.cms-form-actions-left` y `.cms-form-actions-right`.

### 1.6. Formularios

- Los formularios del panel deben ser **compactos y limpios**.
- Campos con `.cms-field`, espaciado controlado y tipografía contenida.
- Inputs, textarea y select deben compartir:
  - borde suave
  - radio consistente
  - padding compacto
  - focus state con `--cms-primary`
- El focus visual debe reforzar usabilidad, no protagonismo decorativo.
- Mantener consistencia entre formularios de páginas, menús, usuarios, ajustes y modales.
- En builders o formularios repetitivos (por ejemplo, editor de menús), preferir edición inline compacta frente a stacks largos de labels repetidas cuando la semántica siga siendo clara.

### 1.7. Cards y paneles

- Las cards deben ser **planas**, con:
  - fondo claro
  - borde suave
  - sombra mínima, casi imperceptible
- No usar elevaciones agresivas ni estilos tipo template genérico.
- El contraste entre card y fondo debe venir más del borde y de la jerarquía del layout que de la sombra.

### 1.8. Modales y diálogos

- **Componente de detalle:** usar siempre `src/routes/admin/components/DetailModal.astro` para crear/editar entidades.
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

### 1.9. Tablas (lenguaje de diseño unificado)

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

### 1.9.1. Toolbars de listados

- La barra de búsqueda/filtros de los listados es un elemento **secundario**, no una cabecera protagonista.
- Debe ser más ligera que las cards principales:
  - menor contraste
  - menor tamaño tipográfico
  - menor altura de controles
  - menos padding y separación
- El buscador no debe ocupar más ancho del necesario ni parecer un formulario principal.
- Los `select` deben mostrar claramente su affordance, pero sin ganar demasiado peso visual.
- El contador de resultados debe ser discreto.

### 1.10. Dashboard

El dashboard debe seguir el mismo design system, pero con reglas específicas:

- No debe parecer un panel de analítica ni un dashboard financiero.
- Debe ser una **pantalla de control del CMS**, no una pantalla decorativa.
- Debe aprovechar mejor el espacio horizontal y estructurarse por bloques:
  - cabecera
  - acciones rápidas
  - métricas compactas
  - bloques útiles (por ejemplo, páginas recientes / accesos rápidos)
- No inventar métricas o gráficos sin datos reales.
- Si un bloque no aporta capacidad operativa clara, eliminarlo en lugar de rellenar el dashboard con contexto redundante.
- Evitar cards de “estado” demasiado narrativas si ya existen métricas y acciones que explican el estado del proyecto.
- Las cards del dashboard deben seguir el mismo criterio:
  - fondo claro
  - borde suave
  - sombra mínima
  - sin fondos de icono exagerados
- El color primario configurable debe usarse solo como acento, también en dashboard.
- La referencia actual es un dashboard compacto con:
  - una card principal de resumen
  - métricas compactas
  - acciones rápidas
  - actividad reciente
  - una card secundaria de sitio y branding
- No volver a introducir una card equivalente a “Estado del workspace” salvo que exista una necesidad real y nuevos datos que la justifiquen.

### 1.11. Tips y bloques informativos

- Cuando se quiera mostrar información contextual o tips, seguir el patrón de la página de menús:
  - card superior
  - icono al inicio
  - texto fluido dentro de `.cms-menus-info-body`
- Mantener estilo informativo, no promocional.
- Si una pantalla puede resolverse con una única card operativa clara, preferir eso a combinar varios bloques informativos con contenido parcialmente repetido. La página de caché es referencia de este criterio.

### 1.12. Builders: páginas y menús

- **Editor de páginas:** es la funcionalidad principal del producto y debe seguir siendo un builder compacto y legible.
- En las tarjetas de bloque:
  - priorizar nombre + resumen + acciones
  - evitar “pseudo-iconos” o chips de letras que no aporten significado real
  - mantener acciones pequeñas y discretas
- El selector de bloques debe ser sobrio y compacto; no convertirlo en una galería decorativa.
- **Editor de menús:** debe sentirse como una estructura editable clara, no como una tabla recargada ni un formulario expandido por defecto.
- Los ítems de menú deben mostrarse colapsados por defecto con un resumen breve y expansión puntual.
- Los submenús deben representarse como filas inline compactas, con drag handle, nombre, ruta y eliminar; evitar mini-cards o cabeceras internas innecesarias.

### 1.13. Qué NO hacer nunca en el panel

- No introducir Tailwind ni frameworks visuales nuevos.
- No usar degradados en botones.
- No diseñar contra un color fijo; el sistema es white-label.
- No abusar de sombras, blur o glassmorphism.
- No convertir el admin en una landing page.
- No romper la compacidad de tablas y formularios sin una razón clara.
- No crear estilos ad hoc para cada pantalla si pueden resolverse dentro del sistema compartido.
- No duplicar información entre topbar, sidebar, dropdowns y acciones de página.
- No introducir nuevamente bloques informativos redundantes “por completar” una pantalla.
- No dejar reglas viejas y nuevas conviviendo para el mismo selector en `cms-admin.css` si el estilo anterior ya no forma parte del diseño final.
- No dejar cambios colaterales en el playground o datos de ejemplo cuando no formen parte explícita de la iteración.

### 1.14. Mantenibilidad del front

- `cms-admin.css` debe mantenerse como fuente de verdad, pero no como acumulador de capas muertas. Cuando una iteración sustituya reglas anteriores de shell, navegación, topbar o builders, limpiar las definiciones antiguas ya pisadas.
- Si un módulo cliente del admin crece con grandes strings HTML repetidos, extraer helpers pequeños de render antes de seguir ampliándolo. La prioridad es mejorar legibilidad sin cambiar el comportamiento.
- Antes de cerrar una iteración visual importante:
  - comprobar que no quedan selectores obsoletos sin uso
  - comprobar que no hay cambios de datos incidentales en playgrounds
  - pasar al menos `npm run typecheck` y `npm test`

---

## 2. Tablas (lenguaje de diseño unificado — detalle de implementación)

- **Tipografía:** Todas las columnas con el mismo `font-size` (0.75rem). Celdas con monospace solo cuando sea dato técnico (ej. slug): clase `.cms-table-cell-monospace`.
- **Columnas de acciones:** Primera columna (`<th class="cms-table-actions">` vacío): solo botón **editar** (icono lápiz, `.cms-table-btn-edit`, `aria-label="Editar"`). Última columna (`<th class="cms-table-actions-delete">` vacío): solo botón **eliminar** (icono papelera, `.cms-table-btn-delete`, rojo, `aria-label="Eliminar"`), alineado a la derecha.
- **Indicador indexable (páginas):** Columna "Indexable" con `<span class="cms-indexable-dot cms-indexable-dot--yes|no" role="img" aria-label="Indexable|No indexable">`. Estilos en `cms-admin.css`: `.cms-indexable-dot` (8px, border-radius 50%), `--yes` verde, `--no` rojo.
- **Iconos:** Pencil (editar) y Trash2 (eliminar) de `@lucide/astro`; en filas generadas por JS usar el mismo SVG inline (14×14, stroke 2).
- **Confirmación antes de eliminar:** Usar `window.cmsConfirm({ message: '...', confirmLabel: 'Eliminar' })` (devuelve `Promise<boolean>`). El componente `ConfirmDialog.astro` está incluido en el layout del panel.
- **Referencia:** `pages.astro` y `users.astro`. Mantener este criterio en futuras tablas del panel.