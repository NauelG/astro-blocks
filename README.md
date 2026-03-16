<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

<p align="center">
  <img src="img/blocks_logo.jpg" alt="AstroBlocks" width="160" />
</p>

<h1 align="center">AstroBlocks</h1>
<p align="center">
  <strong>CMS sin base de datos para Astro.</strong> Panel de administración, páginas editables, menús y configuración del sitio. Todo en JSON.
</p>

<p align="center">
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.8.0-blue" alt="version" /></a>
  <img src="https://img.shields.io/badge/status-alpha-orange" alt="alpha" />
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js" alt="Node 18+" /></a>
  <a href="https://astro.build"><img src="https://img.shields.io/badge/Astro-6+-FF5D01?logo=astro" alt="Astro 6+" /></a>
</p>

---
Licencia:
<blockquote style="font-size: 10px;">
AstroBlocks is source-available software.

You are free to use it for personal projects, open-source work,
and internal company usage.
You may not offer AstroBlocks as a SaaS or hosted service.
</blockquote>

---

<p align="center">
  <img src="img/dashboard.jpg" alt="AstroBlocks dashboard" width="860" style="border-radius:8px" />
</p>

---

## Características

- **Panel de administración** en `/cms`: dashboard, páginas, menús, ajustes, usuarios y regenerar sitio
- **Sin base de datos**: contenido en `data/*.json` y archivos en `public/uploads/`
- **Bloques editables**: define componentes con `defineBlockSchema` y edita props desde el panel
- **White-label**: colores y logo del sitio configurables en Ajustes
- **Autenticación**: primer usuario como propietario, JWT para la API
- **SEO**: campos predefinidos por página (título, descripción, canonical, imagen); páginas indexables o no; sitemap y robots con Disallow para no indexables

## Requisitos

| Dependencia   | Versión  |
|---------------|----------|
| **Astro**    | 6+       |
| **Node.js**  | 18+      |
| **Adapter**  | `@astrojs/node` (v10+) para rutas del panel y la API |

En Astro 6 se usa `output: 'static'`; las rutas del CMS son server-rendered con el adapter.

---

## Instalación

### Dependencia local (mismo repo o ruta externa)

Si el paquete está en una carpeta del repo (p. ej. `lib/astro-blocks`) o en una ruta externa (p. ej. otro repositorio):

```json
{
  "dependencies": {
    "astro-blocks": "file:./lib/astro-blocks"
  }
}
```

Ejecuta `npm install` (o equivalente) en el **proyecto Astro** para que las dependencias de astro-blocks se instalen ahí.

**Desarrollo local:** Si usas `file:../astro-blocks` y ves un error al resolver `@picocss/pico` o `animate.css`, ejecuta también `npm install` **dentro de la carpeta astro-blocks**. Así el paquete tendrá su propio `node_modules` y podrá resolver esas dependencias cuando el bundler use la ruta real del paquete. Cuando el paquete esté instalado desde npm, no es necesario. (El paquete usa `legacy-peer-deps` en su `.npmrc` porque `@lucide/astro` aún no declara soporte para Astro 6 en su peer dependency.)

### Desde npm (cuando esté publicado)

```bash
npm install astro-blocks
```

---

## Configuración rápida

1. **Integración en `astro.config.mjs`:**

```js
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import astroBlocks from 'astro-blocks';
import { schema as heroSchema } from './src/components/Hero.astro';
// import { schema as ctaSchema } from './src/components/Cta.astro';

export default defineConfig({
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    astroBlocks({
      layoutPath: './src/layouts/Layout.astro',
      blocks: [heroSchema],
    }),
  ],
});
```

2. **Adapter Node** es obligatorio para que el panel (`/cms`) y la API funcionen.

3. La carpeta **`data/`** se crea automáticamente en la raíz del proyecto con `pages.json`, `site.json`, `menus.json` y `users.json`.

El panel usa **Pico CSS**, **Animate.css**, **Sortable.js** y **simple-dropzone**; todo va incluido en el paquete y solo se carga en el admin.

---

## Opciones del plugin

| Opción        | Descripción |
|---------------|-------------|
| `layoutPath`  | Ruta al layout del proyecto (ej. `'./src/layouts/Layout.astro'`). Recibe props de SEO (`title`, `description`, `canonical`, `noindex`, `site`, `seo`) en páginas servidas por el CMS. El objeto `seo` incluye `image` (URL absoluta para og:image/twitter:image) y `nofollow` (boolean). Para una experiencia SEO completa, el layout debe renderizar `<meta property="og:title">`, `og:description`, `og:image`, `og:url` (canonical) y opcionalmente `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`; y para `noindex`/`nofollow` usar `content="noindex"` o `content="noindex, nofollow"` según las props. |
| `blocks`      | Array de schemas. Cada schema se importa desde su componente (`import { schema as heroSchema } from './src/components/Hero.astro'`). Cada componente debe exportar `schema` con `defineBlockSchema(definition, import.meta.url)`. Ver [contrato de bloques](#contrato-de-componentes). |

---

## Carpeta `data/`

En la **raíz del proyecto**:

| Archivo        | Uso |
|----------------|-----|
| `data/pages.json`  | Páginas (slug, draft/published, bloques, `indexable`, SEO: título, descripción, canonical, imagen, nofollow). Las no indexables se excluyen del sitemap y llevan meta noindex; sus rutas se añaden a `robots.txt` como Disallow (excepto la home). |
| `data/site.json`   | Sitio: nombre, baseUrl, favicon, logo, colores, SEO por defecto. |
| `data/menus.json`  | Lista de menús: `{ "menus": [ { "id", "name", "selector", "items": [ { "name", "path", "children"?: [...] } ] } ] }`. El **selector** es la clave que se usa en código (ej. `main`, `footer`). Los ítems pueden tener `children` para submenús anidados. |
| `data/users.json`  | Usuarios del panel (email, rol owner/editor). |

Los archivos subidos se guardan en **`public/uploads/`**. Puedes versionar `data/` en tu repo.

---

## Menús en el sitio: `getMenu(selector)`

En código servidor (p. ej. frontmatter de Astro):

```astro
---
import { getMenu } from 'astro-blocks/getMenu';

const menu = await getMenu('main');
---
<nav>
  {menu.map((item) => (
    <a href={item.path}>{item.name}</a>
  ))}
</nav>
```

Devuelve un array de ítems: `{ name: string, path: string, children?: Array<...> }[]`. Si un menú tiene submenús, cada ítem puede incluir `children` con la misma forma para renderizar dropdowns o listas anidadas.

---

## Contrato de componentes

Cada bloque debe:

1. Importar `defineBlockSchema` desde `astro-blocks/contract`.
2. Exportar un `schema` con `defineBlockSchema(definition, import.meta.url)`. La definición incluye `name` (nombre del bloque), `icon` (opcional; nombre de icono Lucide para el selector), `key` (opcional; clave del tipo) e `items` (props editables con `type`, `label`, `required?`, `options?` para select).

**Ejemplo:**

```astro
---
import { defineBlockSchema } from 'astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'Hero',
    icon: 'Layout',
    items: {
      title: { type: 'string', label: 'Título', required: true },
      subtitle: { type: 'text', label: 'Subtítulo' },
    },
  },
  import.meta.url
);
const { title = '', subtitle = '' } = Astro.props;
---
<section>
  <h1>{title}</h1>
  {subtitle ? <p>{subtitle}</p> : null}
</section>
```

En la config del plugin se importa el schema y se pasa en `blocks: [heroSchema, ...]`. Ver más abajo el apartado [Editor de bloques](#editor-de-bloques).

**Tipos de prop:** `string`, `text`, `number`, `boolean`, `image`, `link`, `select`.

---

## Editor de bloques

Al editar una página en **Contenido → Páginas**, el modal de detalle incluye el **editor de bloques**: lista reordenable por arrastre, botón para añadir bloques (modal de selección de tipo), y por cada bloque un acordeón con el formulario de sus props. No se puede guardar si faltan props obligatorias; se permite guardar una página sin bloques (`blocks: []`).

- **Columna izquierda:** pestañas **Información** (título, slug, indexable) y **SEO** (título SEO, descripción, canonical, imagen, nofollow). El tab SEO solo se muestra si la página es indexable.
- **Columna derecha:** lista de bloques con arrastre para reordenar, botones para expandir/colapsar, duplicar y eliminar cada bloque.

<p align="center">
  <img src="img/page_editor.jpg" alt="Editor de bloques en el modal de página" width="860" style="border-radius:8px" />
</p>

---

## Panel de administración (`/cms`)

- **Dashboard** — Resumen y acceso rápido.
- **Contenido** — Páginas (crear, editar, eliminar en modal) y Menús.
- **Configuración** — Ajustes (nombre, URL, favicon, logo, colores), Usuarios, Regenerar sitio.

La edición se hace en **modales** en la misma pantalla del listado. Las acciones destructivas usan un diálogo de confirmación (`window.cmsConfirm()`). Interfaz **white-label** con colores configurables en Ajustes.

### Diálogos de confirmación

El layout incluye `ConfirmDialog.astro`. Uso:

```js
const ok = await window.cmsConfirm({
  message: '¿Eliminar este elemento?',
  confirmLabel: 'Eliminar',
  cancelLabel: 'Cancelar',
});
```

---

## Seguridad y usuarios

- **Primer usuario** → pantalla de registro (se crea como propietario).
- **Resto de usuarios** → login con email y contraseña.
- **Sesión** → JWT en `Authorization: Bearer <token>` en las peticiones a la API.
- **Variables de entorno** (recomendadas en producción):
  - `CMS_SECRET` — secreto compartido para la API.
  - `CMS_JWT_SECRET` — firma de los JWT.

---

## Regenerar sitio

En **Configuración → Regenerar sitio** (`/cms/rebuild`) un botón ejecuta `npm run build` en la raíz del proyecto (p. ej. para actualizar HTML, sitemap y metadatos). Requiere Node y acceso al disco; en entornos serverless puede no estar disponible.

---

## Página de inicio y conflicto con `index.astro`

Para que la **ruta `/`** la gestione el CMS, crea en el panel una página con slug `/`. Evita conflictos **eliminando o renombrando** `src/pages/index.astro`; las rutas basadas en archivo pueden tener prioridad. Si existe `src/pages/index.astro`, el plugin muestra un aviso en consola.

---

*AstroBlocks* — CMS para [Astro](https://astro.build). Panel en `/cms`, datos en JSON, sin base de datos.
