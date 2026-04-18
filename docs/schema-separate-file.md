# Schema en archivo separado (evitar import .astro desde config)

Si al usar `import { schema as heroSchema } from './src/components/Hero.astro'` en la config obtienes un error de parsing ("invalid JS syntax"), es porque la config se carga antes de que los `.astro` se procesen como componentes. En ese caso, define el schema en un **archivo solo JS o TS** junto al componente y pasa la ruta del componente con `new URL('./Nombre.astro', import.meta.url).href`.

## Ejemplo en TypeScript

**src/components/Hero.schema.ts**:

```ts
import { defineBlockSchema } from 'astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'Hero',
    icon: 'Layout',
    key: 'hero',
    items: {
      title: { type: 'string', label: 'Título', required: true },
      subtitle: { type: 'text', label: 'Subtítulo' },
    },
  },
  new URL('./Hero.astro', import.meta.url).href
);
```

**astro.config.mts** (o `astro.config.ts`):

```ts
import { defineConfig } from 'astro/config';
import astroBlocks from 'astro-blocks';
import { schema as heroSchema } from './src/components/Hero.schema';

export default defineConfig({
  integrations: [
    astroBlocks({
      layoutPath: './src/layouts/Layout.astro',
      blocks: [heroSchema],
    }),
  ],
});
```

## Ejemplo en JavaScript

**src/components/Hero.schema.mjs** (o `Hero.schema.js`):

```js
import { defineBlockSchema } from 'astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'Hero',
    icon: 'Layout',
    key: 'hero',
    items: {
      title: { type: 'string', label: 'Título', required: true },
      subtitle: { type: 'text', label: 'Subtítulo' },
    },
  },
  new URL('./Hero.astro', import.meta.url).href
);
```

**astro.config.mjs**:

```js
import { schema as heroSchema } from './src/components/Hero.schema.mjs';

export default defineConfig({
  integrations: [
    astroBlocks({
      layoutPath: './src/layouts/Layout.astro',
      blocks: [heroSchema],
    }),
  ],
});
```

**Hero.astro** queda solo como componente (no necesita exportar schema):

```astro
---
const { title = '', subtitle = '' } = Astro.props;
---
<section class="hero">
  <h1>{title}</h1>
  {subtitle ? <p class="subtitle">{subtitle}</p> : null}
</section>
```

El plugin usa la URL guardada en el schema para generar el runtime e importar `Hero.astro`; el archivo `.schema.mjs` solo sirve para que la config pueda importar el schema sin tocar `.astro`.
