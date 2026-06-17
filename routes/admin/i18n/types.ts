/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

export const SUPPORTED_UI_LOCALES = ['en', 'es'] as const;

export type UiLocale = typeof SUPPORTED_UI_LOCALES[number];

/** Flat dot-namespaced key → string value. */
export type Catalog = Record<string, string>;

/** Optional interpolation parameters. */
export type TParams = Record<string, string | number>;

/** Bound translate function returned by createT(). */
export type TranslateFn = (key: string, params?: TParams) => string;
