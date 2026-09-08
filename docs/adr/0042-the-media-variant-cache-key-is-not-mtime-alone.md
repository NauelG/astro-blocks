<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0042 — The media variant cache key is not mtime alone

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Nauel Gómez
- **Source:** #182

## Context

ADR-0017 describes `utils/getMediaVariants.ts` as "an mtime-cached registry reader": a module-level
singleton, keyed by `data/media.json`'s modification time in milliseconds, reloaded only when that
value changes. The premise was that two writes to the registry would not collide inside one
millisecond often enough to matter.

That premise is false, and #182 measured it two ways:

- Sampling 36 pre-existing `.ts` files under `src/api/` and `src/utils/` on this repo's own
  filesystem yielded only 4 distinct `mtimeMs` values across them — millisecond collisions are the
  common case here, not the edge case.
- Writing `data/media.json` twice in immediate succession via `data.ts#writeJson` (the sole writer
  of every store file) and comparing `fs.stat(..., { bigint: true }).mtimeNs` — nanosecond
  resolution — still collided in roughly 45 of 50 back-to-back writes, on both a `tmpfs` temp
  directory and the repo's own `ext4` checkout. The clock source `stat` reads is coarser than the
  nanosecond field implies; raising resolution alone does not fix the underlying problem.

The consequence lands on the public site: `handleReplaceUpload` clears an entry's variants and sets
`status: 'processing'` under the media lock, then a fire-and-forget job regenerates them (ADR-0017).
If both the pre-replace read and the post-replace write land in one collision window, the render-time
accessor keeps serving the pre-replace snapshot — `status: 'ready'` with a variant list whose files
the replace already deleted. `BlockImage.astro` renders a `<picture>` whose `srcset` 404s on every
entry, silently.

A fix needed a signal that changes on **every** write to the file, not merely most of them, without
turning the cache into something that reads disk on every render (`ADR-0017`'s whole reason to
cache) and without making the data layer aware of a render-time cache module (avoidable coupling,
weighed against ADR-0017's own future-latency note about `reconcileMedia()`).

`data.ts#writeJson` writes to a freshly, randomly named temp file and `fs.rename`s it over the
target path. That rename always allocates a new inode for the target — the previous inode is freed,
not reused in place. Measured across 500 back-to-back writes through that exact path, with no delay
between them, the inode number never repeated once.

## Decision

`getMediaVariants`'s cache key is the triple `(ino, size, mtimeNs)` read via
`fs.stat(mediaJsonPath, { bigint: true })`, not `mtimeMs` alone.

`ino` is what actually discriminates every write that goes through `writeJson` — which is every
production write path (`replaceMedia`, `appendMediaEntry`, `removeMediaEntryByUrl`,
`updateMediaEntryAlt`, `markMediaVariantsReady`, `markMediaVariantsFailed`, `replaceMediaEntryBytes`,
and the reconcile path all funnel through `saveMedia` → `writeJson`). `size` and `mtimeNs` are
retained as a cheap fallback for the one write path in the codebase that does not go through
`writeJson`: test fixtures that `fs.writeFile` the registry in place. The cache otherwise behaves
exactly as ADR-0017 describes — a module-level singleton, reloaded only on a key change, harmless to
race because the event loop is single-threaded.

`ino`-based invalidation is a property of `writeJson`'s atomic rename-over pattern, not an
independent guarantee `getMediaVariants` enforces on its own. If a future writer of `media.json`
ever bypasses `writeJson` for an in-place write, this cache degrades back to the `size`/`mtimeNs`
fallback and inherits the same collision risk this ADR fixes — that writer must go through
`writeJson`, the same rule ADR-0008 already states for every other store file.

Explicit invalidation from the mutation seam (`data.ts` calling into the cache directly) was the
alternative with the strongest guarantee, considered and set aside: it would couple the data layer
to a specific render-time cache's internals for a guarantee the identity key already provides
without that coupling.

## Consequences

- `tests/get-media-variants.test.js`'s invalidation test no longer needs an artificial delay between
  writes; a rapid-burst test (20 writes, no delay, read after each) now covers the collision case
  directly rather than relying on wall-clock timing to reproduce it.
- `tests/media-replace.test.js`'s P5 (#181) stops depending on the host filesystem's clock
  resolution to pass — the same failure mode it fails under is what this ADR fixes.
- Any future `media.json` writer that skips `writeJson` for an in-place edit silently reintroduces
  the collision window this ADR closes; there is no runtime assertion that catches it.
</content>
