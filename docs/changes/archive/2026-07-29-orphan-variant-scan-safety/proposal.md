<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — The orphan scan may only delete what it can prove is an orphan

_Resolves [#164](https://github.com/NauelG/astro-blocks/issues/164), reframed. Grilled 2026-07-29._

## The real problem

#164 was filed as a performance issue: `reconcileMedia` holds the media write lock while walking
`public/uploads/**`, so a listing read blocks every write. That is true. It is not the important part.

**Uploading an image corrupts the media registry.** Reproduced:

```
status: ready | variants recorded: 8
variants recorded but MISSING on disk: 5
    /uploads/2026/06/ab12-photo-480.webp
    /uploads/2026/06/ab12-photo-480.avif
    /uploads/2026/06/ab12-photo-800.webp
    …
```

The entry is marked `ready`, so nothing signals a problem, and those URLs go into the `srcset` of
published pages. The site serves broken responsive images and the panel says everything is fine.

### The mechanism

1. `handleUpload` fires `generateAndPersistVariants` **without awaiting** and responds.
2. That function writes each variant file to disk in a loop (`utils/variant-generator.ts:78-81`) and
   registers them only at the end, via `markMediaVariantsReady` (`:88`).
3. The admin client re-fetches the list immediately after the upload response
   (`client/media.ts`, `uploadFile` → `loadMedia`) → `GET /cms/api/media` → `reconcileMedia()`.
4. The orphan scan (`api/data.ts:860-897`) deletes every file matching
   `/^.+-\d+\.(webp|avif)$/` that is not in the registry. The variants written so far are **not yet**
   in the registry, so it deletes them.
5. `markMediaVariantsReady` then records all eight, including the five it just lost.

So the request that triggers the deletion is the upload's own refresh. This is the normal path, not
an edge case.

## Two things #164 asserts that are wrong

Both were mine, and both mattered to the proposed fix:

- **"The lock is what protects this."** It is not. `generateAndPersistVariants` writes the files
  **without holding the media lock at all**, so the writer and the scanner were never serialised.
  Holding the lock differently could not have fixed this.
- **"Have reconcile read under a shared lock."** `withFileLock` (`api/data.ts:306-315`) is a
  per-key FIFO promise chain — a plain mutex with **no shared mode**. That option was not a small
  adjustment; it was building a reader-writer lock.

## The fix

**The scan may only delete a file it can prove is an orphan, and the proof is age.**

1. **Age threshold.** A variant file is a deletion candidate only if its `mtime` is older than
   **5 minutes**. A file being written right now is never a candidate, whatever the generation takes
   — a large image on a loaded server is protected just as well as a small one.

2. **Narrow the critical section.** The inspection — `fs.access` per entry, and the directory walk —
   is read-only and moves out of the lock. Inside the lock: re-read, filter out the pruned URLs,
   save. The **re-read is load-bearing**: writing back a snapshot computed before the lock was taken
   would silently drop an upload that landed in between, which is exactly what the lock exists to
   prevent.

3. **Repair what already broke.** Reconcile also drops variant records whose file is missing, for
   entries whose `status` is `ready` — never `processing`, which would be an in-flight generation.
   Without this, every instance that has uploaded an image since the scan shipped keeps serving
   broken `srcset` forever: fixing the race protects new uploads and does nothing for existing damage.

### Alternatives rejected

- **Declare the variants before writing them.** Correct by construction, no time window. But the
  registry would then claim variants that do not exist yet — the same lie this change removes, only
  transient — unless a separate `pendingVariants` field is added, which changes the registry contract
  and reopens ADR-0017.
- **Track in-flight jobs in memory.** Precise, no arbitrary margin. But it only holds within one
  process: on serverless or multi-instance, one instance's scan cannot see another's jobs and the
  corruption returns. The same limit the login throttle already documents.
- **Hold the media lock across variant generation.** Correct, and it makes #164's contention
  dramatically worse: every listing read would queue behind every image encode.

## Scope

`api/data.ts` (`reconcileMedia`), plus tests. No change to `variant-generator.ts`, to the upload
handler, or to the `MediaEntry` contract.

## Out of scope

**The walk still runs on every listing read.** It stops blocking writers, which is what #164's
acceptance criteria ask for, but the I/O per debounced keystroke remains. Taking the scan off the read
path entirely changes **when** orphans are collected — observable behaviour touching ADR-0017/0019/0020
— and deserves its own cycle and ADR rather than riding along in a correctness fix.

## Acceptance criteria

- [ ] A listing read issued during variant generation leaves the registry consistent: every variant
      the registry records exists on disk.
- [ ] A variant file younger than the threshold is never deleted by the scan.
- [ ] A genuine orphan older than the threshold is still deleted.
- [ ] A listing read does not hold the media write lock while walking the uploads tree.
- [ ] An upload landing during a reconcile is not lost.
- [ ] Reconcile drops variant records whose file is missing on `ready` entries, and leaves
      `processing` entries untouched.
- [ ] `typecheck` + `test` + `biome ci` + e2e green.
