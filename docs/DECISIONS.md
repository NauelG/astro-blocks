<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Architecture Decision Records

The **public, discoverable index** of every architectural decision in
`@astroblocks/astro-blocks`, so a contributor can see the "why" behind the project's conventions
without reading forty files.

This document holds **no decision text**. Every ADR body lives in `docs/adr/NNNN-titulo.md`, in
Nygard format, and is **immutable**: if a decision changes, a new ADR supersedes the old one and
the old one's `Status` records it. `AGENTS.md` § *Enrutado de artefactos* routes every decision
there; this file only indexes them.

The table below is **generated**. Run `npm run adr:index` after adding an ADR, or let
`npm run adr:check` fail the build — CI runs it on every push and pull request.

---

## Index

<!-- adr-index:start -->
| # | Decision | Status | Date |
| --- | --- | --- | --- |
| [ADR-0001](./adr/0001-busl-license-with-2029-change-date.md) | BUSL-1.1 license with 2029 change date to MIT | Accepted | 2026-06-29 |
| [ADR-0002](./adr/0002-node-builtin-test-runner.md) | Node built-in test runner (`node:test`) | Accepted | 2026-06-29 |
| [ADR-0003](./adr/0003-tag-driven-release-automation.md) | Tag-driven release automation with npm provenance and dist-tag policy | Accepted | 2026-06-29 |
| [ADR-0004](./adr/0004-admin-ui-english-default-i18n.md) | Admin UI default language English; i18n with en/es catalogs (SSR-first) | Accepted | 2026-06-29 |
| [ADR-0005](./adr/0005-consumer-agents-md-ships-in-tarball.md) | `AGENTS.consumer.md` ships in the npm tarball; mandatory sync | Accepted | 2026-06-29 |
| [ADR-0006](./adr/0006-playground-sample-per-feature.md) | Playground sample required per feature | Accepted | 2026-06-29 |
| [ADR-0007](./adr/0007-token-in-header-auth-no-csrf.md) | Token-in-header JWT auth model (no CSRF surface) | Accepted | 2026-06-30 |
| [ADR-0008](./adr/0008-json-file-store-atomic-write-mutex.md) | JSON file store: atomic write + per-file mutex | Accepted | 2026-06-13 |
| [ADR-0009](./adr/0009-runtime-registry-resolution.md) | Runtime registry resolution for injected & precompiled routes | Accepted | 2026-04-21 |
| [ADR-0010](./adr/0010-ssr-adapter-config-guard.md) | SSR adapter required via config-time guard, not peerDependency | Accepted | 2026-07-06 |
| [ADR-0011](./adr/0011-canonical-html-escaper.md) | Single canonical context-aware HTML escaper | Accepted | 2026-07-07 |
| [ADR-0012](./adr/0012-handlers-decomposition-nodenext-shim.md) | Decompose api/handlers.ts behind a NodeNext re-export shim | Accepted | 2026-07-07 |
| [ADR-0013](./adr/0013-biome-ci-gate.md) | Adopt Biome as a CI gate separate from tests | Accepted | 2026-07-07 |
| [ADR-0014](./adr/0014-coverage-c8.md) | Test coverage via c8; browser-only controllers excluded | Accepted | 2026-06-15 |
| [ADR-0015](./adr/0015-bootstrap-import-full-restore.md) | Bootstrap import = full restore, gated only by zero-users | Accepted | 2026-06-30 |
| [ADR-0016](./adr/0016-image-field-value-model.md) | Image field value is a structured object (alt, dimensions, caption) | Accepted | 2026-06-13 |
| [ADR-0017](./adr/0017-responsive-images-variant-generation.md) | Responsive images via sharp on-upload variant generation | Accepted | 2026-06-14 |
| [ADR-0018](./adr/0018-non-image-file-uploads.md) | Non-image file uploads: 'file' prop type + server-side denylist | Superseded by [ADR-0023](./0023-supported-file-type-catalog.md) | 2026-06-29 |
| [ADR-0019](./adr/0019-media-lifecycle-delete-replace.md) | Media lifecycle: warn-and-allow delete, same-MIME keep-URL replace | Accepted | 2026-06-14 |
| [ADR-0020](./adr/0020-media-server-side-search-pagination.md) | Media library: server-side search + pagination | Accepted | 2026-06-14 |
| [ADR-0021](./adr/0021-src-as-publish-root.md) | `src/` is the publish root: `dist/` mirrors `src/` | Accepted | 2026-07-14 |
| [ADR-0022](./adr/0022-admin-escaping-enforced-by-source-guard.md) | Admin HTML escaping is enforced by a source guard, not by the linter | Accepted | 2026-07-14 |
| [ADR-0023](./adr/0023-supported-file-type-catalog.md) | The supported-file-type catalog is the single source of truth | Accepted | 2026-07-14 |
| [ADR-0024](./adr/0024-streaming-ingest-and-range-serving.md) | Category-branched ingest and Range-capable, streamed serving | Accepted | 2026-07-14 |
| [ADR-0025](./adr/0025-schema-map-hard-dependency.md) | The schema map is a hard dependency: no degraded reads | Accepted | 2026-07-14 |
| [ADR-0026](./adr/0026-media-user-facing-vocabulary.md) | User-facing media vocabulary: media, asset, file, image | Accepted | 2026-07-15 |
| [ADR-0027](./adr/0027-stateful-session-revocation.md) | Stateful session revocation via `tokenVersion` | Accepted | 2026-07-15 |
| [ADR-0028](./adr/0028-restore-is-a-session-revocation-event.md) | Restore is a session-revocation event | Accepted | 2026-07-19 |
| [ADR-0029](./adr/0029-integration-version-contract.md) | The integration's version does not track Astro's | Accepted | 2026-07-19 |
| [ADR-0030](./adr/0030-single-mutation-seam-for-users.md) | One mutation seam for users.json, with no way to skip the write | Accepted | 2026-07-19 |
| [ADR-0031](./adr/0031-floating-panels-stay-in-the-dom.md) | Los paneles flotantes del admin no se sacan del DOM | Accepted | 2026-07-20 |
| [ADR-0032](./adr/0032-no-usamos-la-ip-como-clave-de-throttling.md) | La IP del cliente no es clave de throttling; el login se frena por email y con retraso, no con bloqueo | Accepted | 2026-07-20 |
| [ADR-0033](./adr/0033-el-modulo-de-bake-es-isomorfo-y-el-fallo-no-es-un-response.md) | El módulo del bake es isomorfo; el fallo devuelve un union, no un Response | Accepted | 2026-07-20 |
| [ADR-0034](./adr/0034-la-parity-i18n-y-los-mensajes-de-validacion-son-un-solo-origen-enforced-por-el-compilador.md) | La parity i18n y los mensajes de validación son un solo origen, enforced por el compilador | Accepted | 2026-07-21 |
| [ADR-0035](./adr/0035-createlisteditor-es-un-modulo-profundo-con-escaping-estructural-sobre-un-sink-visible.md) | createListEditor es un módulo profundo con escaping estructural sobre un sink visible | Accepted | 2026-07-21 |
| [ADR-0036](./adr/0036-el-handler-es-la-unica-implementacion-del-listado-de-media.md) | El handler es la única implementación del listado de media; el consumidor pide, no filtra | Accepted | 2026-07-27 |
| [ADR-0037](./adr/0037-el-panel-no-renderiza-datos-en-servidor-porque-no-puede-autenticar-la-navegacion.md) | El panel no renderiza datos en servidor, porque no puede autenticar la navegación | Accepted | 2026-07-28 |
| [ADR-0038](./adr/0038-el-escaneo-solo-borra-lo-que-puede-demostrar-que-es-huerfano.md) | El escaneo solo borra lo que puede demostrar que es huérfano, y la prueba es la antigüedad | Accepted | 2026-07-29 |
| [ADR-0039](./adr/0039-las-cadenas-de-cliente-del-panel-vienen-de-ct.md) | Las cadenas de cliente del panel vienen de `ct`, no de un puente i18n | Accepted | 2026-08-20 |
| [ADR-0040](./adr/0040-el-orden-del-backlog-es-una-cadena-de-blocked-by-no-las-etiquetas-p0-p3.md) | El orden del backlog es una cadena de `blocked_by`, no las etiquetas `P0`–`P3` | Accepted | 2026-09-07 |
| [ADR-0041](./adr/0041-the-adr-corpus-is-written-in-english.md) | The ADR corpus is written in English, and translating one does not break its immutability | Accepted | 2026-09-08 |
| [ADR-0042](./adr/0042-the-media-variant-cache-key-is-not-mtime-alone.md) | The media variant cache key is not mtime alone | Accepted | 2026-09-08 |
<!-- adr-index:end -->

---

## Adding a decision

1. Write `docs/adr/NNNN-titulo.md` with the next free number, using the header and section format
   documented in `AGENTS.md` § *Enrutado de artefactos*.
2. Run `npm run adr:index` to refresh the table above.
3. Never edit an accepted ADR to change its decision. Write a new one, and set the old one's
   `Status` to `Superseded by [ADR-NNNN](./NNNN-....md)`.
