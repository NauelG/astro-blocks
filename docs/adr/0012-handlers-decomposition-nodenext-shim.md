<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0012 — Decompose api/handlers.ts behind a NodeNext re-export shim

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-07-07
- **Source:** engram observation(s) #1996, #2001

## Context

`api/handlers.ts` had grown to ~2600 lines and mixed concerns across auth, users, pages, media,
menus, redirects, configs, languages, global blocks, cache invalidation, and backup/import. The
original decomposition plan called for deleting the file and replacing it with an
`api/handlers/index.ts` barrel.

That plan does not work under this repo's `tsconfig.json` setting `"moduleResolution": "NodeNext"`.
NodeNext resolves explicit, `.js`-suffixed relative specifiers (e.g. `./handlers.js`) literally — it
does **not** fall back to resolving a directory index the way classic/bundler resolution does. Since
`api/route-table.ts` and `routes/api/catchall.ts` import from `./handlers.js`, and roughly two dozen
test files import the **compiled** `../dist/api/handlers.js` (not the TypeScript source), deleting
`handlers.ts` in favor of a directory would break every one of those import sites both at the source
level and, separately, at the compiled-output level used by tests. A further wrinkle: some of the
values re-exported here are module-load-time singletons with side effects (JWT secret
classification, an allowed-file-types cache with a `console.warn` on first access), so decomposition
also has to preserve load-order/identity, not just relocate function bodies.

## Decision

We will keep `api/handlers.ts` as a real, physical file acting as a thin re-export shim. It performs
no logic of its own — it only re-exports named bindings from the new domain modules under
`api/handlers/*.ts` (`shared`, `site`, `auth-core`, `auth`, `users`, `languages`, `pages`,
`global-blocks`, `media`, `menus`, `redirects`, `configs`, `cache`, `backup-routes`, plus
`locale-resolution` and `schema-loading` as internal-only modules). Existing consumers
(`api/route-table.ts`, `routes/api/catchall.ts`, and all test files importing
`dist/api/handlers.js`) keep working unmodified because the specifier they resolve against still
physically exists, both in source and in the compiled `dist/` output.

Delivery was executed as a chain of PRs (one per domain slice) rather than one large PR, since the
line-count diff from moving function bodies verbatim is large even though the change is
semantically a refactor. That delivery mechanic is a project-management detail, not part of the
architectural decision itself.

## Consequences

- Domain modules are independently readable, testable, and ownable, replacing one 2600-line file.
- The shim's export set becomes a contract: anything consuming `api/handlers.ts` (source or
  compiled) still resolves correctly, but the shim must be kept in sync whenever a domain module's
  exports change, and it must exist post-build (`dist/api/handlers.js`) for tests that import
  compiled output.
- Module-load-time singletons and their side effects (JWT secret constants, the allowed-file-types
  cache) had to move intact into their new domain module rather than being re-initialized per file,
  to avoid subtly changing runtime behavior for tests that spawn child processes against the
  compiled shim (e.g. JWT-secret hardening tests).
- Refactor-only function moves still show as large add+delete diffs in `git diff`/GitHub, which can
  make review harder to calibrate; an export-set snapshot test on the shim is a more reliable
  regression signal than reading every moved line.

## Evidence (current repo)

- `api/handlers.ts` — 69 lines, contains only `export { ... } from './handlers/<domain>.js'`
  statements (and one type re-export); no logic of its own. Confirms the "thin shim" decision is
  live.
- `api/handlers/` — contains `auth-core.ts`, `auth.ts`, `users.ts`, `languages.ts`, `pages.ts`,
  `global-blocks.ts`, `media.ts`, `menus.ts`, `redirects.ts`, `configs.ts`, `cache.ts`,
  `backup-routes.ts`, `site.ts`, `shared.ts`, `locale-resolution.ts`, `schema-loading.ts`,
  `cache-invalidation.ts` — the domain modules referenced in the source.
- `tsconfig.json` — `"moduleResolution": "NodeNext"`, confirming the resolution constraint that
  motivated the shim approach.
- `api/route-table.ts:30` — `import * as handlers from './handlers.js';`, an unmodified consumer of
  the shim's specifier.
- `tests/jwt-secret-hardening.test.js` — imports `../dist/api/handlers.js` and spawns child
  processes against it; 23 test files in total import from `dist/api/handlers.js`, confirming the
  shim must exist in compiled output.

See ADR-0013 for the CI gate that caught a format regression in one of this decomposition's PRs.
