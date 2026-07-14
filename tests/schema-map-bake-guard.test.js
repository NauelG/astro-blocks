/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * A source guard, in the idiom of admin-define-vars-bridge.test.js.
 *
 * The baked resolution path CANNOT be exercised at `node --test`: `import.meta.env` does not
 * exist outside a Vite build, so every unit test necessarily takes the filesystem fallback
 * (see #81). The e2e suite is what proves the bake actually resolves — it runs a standalone
 * server with no .astro-blocks/ beside it.
 *
 * That leaves one hole this file closes: nothing else would notice if the bake were simply
 * deleted from the plugin. The filesystem read would keep every unit test green, e2e would
 * keep passing locally where the artifact exists, and the deployment bug of #101 would
 * silently return. So: assert the bake exists, and that it is double-encoded.
 *
 * On the double-encode — vite.define splices its value in as raw SOURCE. A single
 * JSON.stringify emits an object literal, which the runtime's `typeof raw === 'string'`
 * guard then rejects, falling back to a default as if the config had never been set. That is
 * not hypothetical: it is what shipped the video/mp4 415 (see plugin/index.ts and ADR-0023).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = fs.readFileSync(path.join(ROOT, 'src', 'plugin', 'index.ts'), 'utf8');

/**
 * Every registry the PRECOMPILED API route resolves. These cannot reach the
 * `astro-blocks-runtime` Vite alias (they are not part of the consumer's Vite graph), so a
 * baked value is their only reliable source on a deployed server — .astro-blocks/ is
 * gitignored and routinely absent there. See ADR-0009, ADR-0025.
 */
const BAKED_REGISTRIES = ['ASTRO_BLOCKS_SCHEMA_MAP', 'ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY'];

for (const name of BAKED_REGISTRIES) {
  test(`plugin bakes ${name} into vite.define`, () => {
    assert.ok(
      PLUGIN.includes(`vite.define['import.meta.env.${name}']`),
      `${name} is not baked into vite.define. The precompiled API route cannot read it from ` +
        'disk on a deployed server — .astro-blocks/ is gitignored and absent there. This is #101.',
    );
  });

  test(`the ${name} bake is double-encoded`, () => {
    const assignment = new RegExp(
      `vite\\.define\\['import\\.meta\\.env\\.${name}'\\]\\s*=\\s*JSON\\.stringify\\(\\s*JSON\\.stringify\\(`,
    );

    assert.match(
      PLUGIN,
      assignment,
      `${name} must be JSON.stringify'd TWICE. vite.define splices its value in as raw source, ` +
        'so a single stringify emits a literal that the runtime\'s `typeof === "string"` guard ' +
        'rejects — the config silently never arrives. That bug shipped once already (video/mp4 415).',
    );
  });
}

/**
 * Deliberately NOT guarded here: that `loadSchemaMap()` reads the baked value, and reads it
 * first.
 *
 * A source grep cannot tell code from prose. Both candidate assertions were written, and both
 * were then shown to be worthless by deleting the thing they claimed to protect and watching
 * them stay green:
 *
 * - matching `ASTRO_BLOCKS_SCHEMA_MAP` in schema-loading.ts matches the identifier inside the
 *   function's own `console.error` message, so it passes even with the bake read deleted;
 * - comparing the source offsets of the bake and the disk path measures comment order, so it
 *   fails on an innocent doc edit and passes on a real regression.
 *
 * A guard that cannot fail is not a guard — it is a green light that means nothing, and it is
 * more dangerous than no test at all, because it invites you to stop looking.
 *
 * The reader side is proven behaviourally instead, by the e2e: the standalone server resolves
 * block schemas with no `.astro-blocks/` beside it, which is possible only if the baked value
 * is the primary path. See ADR-0025 and #81.
 */
