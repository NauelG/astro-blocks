<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0004 — Admin UI default language English; i18n with en/es catalogs (SSR-first)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Decisores:** Nauel Gómez
- **Source:** Issue [#1](https://github.com/NauelG/astro-blocks/issues/1)
- **Procedencia:** recorded in `docs/DECISIONS.md` when that log was created (v3.1.1) and
  relocated here verbatim.

## Contexto

The admin panel was initially built in Spanish (the maintainer's language). Issue #1 raised by the
community requested English as the default for international contributors and consumers.

## Decisión

The admin UI defaults to English. A full i18n system was introduced in v3.1.0 with two catalogs
(`src/routes/admin/i18n/en.ts` and `src/routes/admin/i18n/es.ts`). Language resolution is
SSR-first: the server resolves the UI locale on every request using the resolution order
`cms-ui-locale` cookie → `Accept-Language` header → English fallback. A language switcher in the
profile dropdown writes the `cms-ui-locale` cookie and reloads the page — no client-side detection
or flash.

## Consecuencias

English is the lingua franca for OSS tooling. SSR resolution ensures the first paint is always in
the correct language (WCAG 3.1.1 — `<html lang>` attribute). The cookie/header approach requires no
URL changes and is transparent to the consumer's site routing. Both catalogs are TypeScript files
with strict parity enforced at compile time (missing or extra keys are type errors — see ADR-0034).
A hardcoded-string guard test (`tests/i18n-no-spanish-leak.test.js`) prevents Spanish literals from
leaking into shared files.

Evidence in the repo: `src/routes/admin/i18n/`, `CHANGELOG.md` v3.1.0.
