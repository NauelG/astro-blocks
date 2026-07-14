<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0025 — The schema map is a hard dependency: no degraded reads

- **Status:** Accepted
- **Date:** 2026-07-14
- **Deciders:** Nauel Gómez
- **Source:** issue #101, raised by the ADR-0009 compliance pass.

## Contexto

ADR-0009 established that a generated runtime artifact must never be resolved by a single strategy,
because `.astro-blocks/` is a gitignored build artifact that is routinely absent on a deployed
server. It fixed this for the global-blocks registry: the precompiled API route reads a value baked
into `import.meta.env`, with the filesystem read demoted to a dev fallback.

The **schema map** got only the fragile half. `loadSchemaMap()` resolved it from disk alone, behind a
swallowing `catch`. #101 closes that by baking it (`ASTRO_BLOCKS_SCHEMA_MAP`) — mechanical, and fully
covered by ADR-0009.

What ADR-0009 does **not** settle is what happens on the API side when resolution nevertheless fails.
Its no-swallow rule is scoped, in its own words, to *"the Astro-page side"*. And on the API side the
code had drifted into an asymmetry nobody chose:

- **Writes failed loudly.** `handlePostPages`, `handlePutPage` and `handleUpdateGlobalBlock` returned
  500.
- **Reads degraded silently.** `handleGetPages`, `handleGetGlobalBlocks`, `handleGetGlobalBlock` and
  `handleDeleteLanguage` (a *mutation*) read `schemaResult.schemaMap || null` without ever consulting
  the error, and carried on.

That drift was possible because the loader's return type made the failure advisory:
`{ schemaMap?: SchemaMap; error?: string }` — both fields optional. Four of eight call sites simply
never looked. The swallowing `catch` was the symptom; **the type that permitted ignoring the failure
was the disease**.

The observable consequence of degrading was small — with a null schema map, `projectBlockProps` never
matches `def?.type === 'image'`, so image props reach the admin in their raw legacy shape instead of
an `ImageFieldValue`. But it is the visible tip of a state in which the admin **reads and cannot
write**: every save in that state returns 500. Two worse hypotheses (a destructive merge on save, a
corrupting language deletion) were checked against the code and found unreachable — `ensureValidBlocks`
guards the save path, and `removeLocaleFromPage` branches on value shape rather than schema.

There is no ambiguity to trade against: a project that declares zero blocks bakes `"{}"`, which
resolves successfully to an empty map. **Unresolvable never means empty.**

## Decisión

The schema map is a **hard dependency** of the CMS API. When it cannot be resolved, every handler
that needs it fails with 500 (`errors.loadBlockSchemasFailed`) — **reads included, and mutations
especially**. No handler serves a partial projection, and no handler mutates state on a resolution the
system could not make. `handleDeleteLanguage` in particular refuses to delete.

This is enforced by the **type system, not by convention**. `loadSchemaMap()` returns a discriminated
union:

```ts
{ ok: true; schemaMap: SchemaMap } | { ok: false; reason: 'unresolved' }
```

There is exactly **one** way to fail. A second reason (`incomplete`, for declared blocks carrying no
schema) was drafted and dropped: `buildSchemaMap` omits a key it cannot serialize rather than
assigning `undefined`, and the baked path cannot express it either, since JSON drops `undefined`. No
artifact can reach it, nothing consumed it, and no test covered it. A branch no input can reach is
not defensive — it is one more green light that means nothing, which is the very thing this ADR is
about.

So no call site type-checks without branching on the failure. This mirrors the repo's existing stance
on authorization: `defineRoute<A>` exists (see `api/route-table.ts`) so that a handler's
`RouteContext<A>.user` nullability is checked against its declared `auth` literal **at compile time**,
rather than trusting each handler to remember. Registry resolution earns the same guarantee.

Resolution failures are logged with the artifact name and the remedy. No `catch` may discard the
underlying error, return an empty registry, or substitute `null` for the map — including the
`catch { return [] }` in `loadGlobalBlocksRegistry`, the last live instance of the original ADR-0009
symptom.

### The trade-off, stated plainly

A resolution failure now turns the admin's page list into a hard error instead of a list with broken
images. **We accept the worse read-path UX**, because the alternative hides a broken deployment behind
a UI that looks almost right — and an admin that renders pages it will 500 on saving is a trap, not a
degradation. This is the same failure ADR-0009 diagnosed ("declared global blocks silently disappeared
from the admin UI"); half-rendering is the modern form of that sin.

## Consecuencias

- **Easier:** a broken deployment announces itself at the first admin request, with a log line naming
  the artifact and the fix, instead of surfacing as "the images look wrong" and later "I can't save".
  The failure mode is now one thing, not two.
- **Easier:** new call sites cannot reintroduce the drift. The compiler rejects them.
- **Harder / watch for:** `loadSchemaMap()`'s union is now part of the internal contract; adding a
  reason means touching every call site. That is the intended cost.
- **Harder / watch for:** the baked path remains unreachable from `node --test` (`import.meta.env`
  does not exist there) — see #81. The e2e suite is therefore the **only** guard proving the baked
  resolution works, which is why `e2e/global-setup.ts` no longer copies `.astro-blocks/` into the
  server's project root. **That copy must not be reintroduced**: it made the standalone server look
  like it could resolve schemas it could not, and it is what kept this bug invisible.
- **Trade-off accepted:** a resolution failure degrades the read UX from "partly wrong" to "hard
  error". Deliberate. See above.
