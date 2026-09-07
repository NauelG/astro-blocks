<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0001 — BUSL-1.1 license with 2029 change date to MIT

- **Status:** Accepted
- **Date:** 2026-06-29
- **Decisores:** Nauel Gómez
- **Procedencia:** recorded in `docs/DECISIONS.md` when that log was created (v3.1.1) and
  relocated here verbatim, so every ADR has one home, one format and one numbering.

## Contexto

The project needs a license that protects the author during active development while
committing to open-source availability in the future. Pure open-source (MIT) would allow
commercial forks from day one; a proprietary license would prevent community contribution.

## Decisión

Business Source License 1.1 (BUSL-1.1), with a Change Date of `2029-01-01`. On that date the
license automatically converts to MIT.

## Consecuencias

BUSL-1.1 allows free use, modification, and distribution for non-production and internal
purposes. It restricts competing production SaaS use until the change date. The automatic MIT
conversion gives the community a clear, time-bound commitment. The `LICENSE.md` and `NOTICE.md`
files, the `package.json#license` field, and the copyright header on every source file all carry
this declaration.
