/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { en } from './en.js';

/**
 * The authoritative catalog key set, derived from the English catalog (#40, ADR-0034).
 *
 * `en` is the key authority; every other catalog must carry exactly these keys. Deriving the type
 * here — in a leaf that imports only `en` — lets `es.ts` say `satisfies Record<CatalogKey, string>`
 * without an import cycle (`catalogs.ts` imports `es`, so `CatalogKey` cannot live there). A missing
 * key then fails tsc with TS1360 and an extra key with TS2353: parity is total and compile-time, not
 * a runtime test.
 */
export type CatalogKey = keyof typeof en;
