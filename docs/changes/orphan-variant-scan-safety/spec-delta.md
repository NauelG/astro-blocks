<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — The orphan scan may only delete what it can prove is an orphan

Target: `docs/specs/media-uploads.md`. Adds a **Reconciliation** section (R38–R40) — the spec covers
ingest, serving, the admin surface and the listing, but has never said what reconcile is allowed to
delete, which is how the rule it needed went unwritten and unenforced. Modifies R22's framing. Adds
three scenarios.

---

## ADDED: R38 — Absence from the registry is not proof of orphanhood

> **R38 — The orphan scan may only delete a variant file it can prove is an orphan, and the proof is
> age.** A variant file that is not recorded in the registry may be an orphan — or it may be a file
> being written *right now* by a generation job that has not registered yet. Those are
> indistinguishable from the registry alone.
>
> `generateAndPersistVariants` writes variant files **without holding the media lock** and registers
> them only afterwards, so the window is real on the ordinary upload path: the admin client
> re-fetches the media list immediately after an upload, and that read runs the scan.
>
> A file is therefore a deletion candidate only when its `mtime` is older than
> `ORPHAN_MIN_AGE_MS` (5 minutes). The clock is sampled once per scan, so a slow walk cannot judge
> later files against a moved line. (ADR-0038)

## ADDED: R39 — Reconcile commits under the lock, and commits a filter, not a snapshot

> **R39 — Reconcile inspects without the lock and commits with it, applying a filter to the registry
> as it stands at commit time.** The `fs.access` sweep and the directory walk are read-only and run
> unlocked. The lock covers only: re-read, drop the pruned entries, drop the phantom variant records,
> save.
>
> The **re-read is required**, not an optimisation. Writing back a set computed before the lock was
> acquired would discard any entry appended in between — the loss the media lock exists to prevent.
> A listing read therefore no longer holds the write lock while walking the uploads tree, so it can
> no longer delay an upload, a delete, or the variant persistence that follows an upload.

## ADDED: R40 — Reconcile repairs phantom variant records

> **R40 — A registry entry may not claim a variant file that does not exist.** Reconcile drops
> variant records whose file is absent, for entries whose `status` is `ready`. Entries with status
> `processing` are left untouched: their recorded variants may legitimately not exist yet, and
> "repairing" one would delete records the running job is about to fulfil.
>
> This is repair, not prevention: instances that uploaded images while R38 was unenforced already
> hold entries pointing at deleted files, and those `srcset` URLs 404 on the public site. The repair
> happens on the next listing read, with no migration and no owner action.
>
> Reconcile does **not** regenerate the lost variants. The original is intact, so the image still
> renders; only the responsive alternatives are fewer. Regeneration is a different operation with a
> different cost profile, and triggering it implicitly from a read path is the class of surprise R38
> exists to remove.

---

## MODIFIED: R22 — name where the variant lifecycle is unprotected

R22 says only `raster: true` rows go through sharp and everything else reaches `status: 'ready'` with
an empty `variants` array. That stands. It now also records the fact R38 turns on: variant files are
written **outside** the media lock and registered afterwards, so between the first encode and
`markMediaVariantsReady` the filesystem holds real files the registry does not know about.

---

## Scenarios

- **S19 — Upload, then the list refreshes.** An image is uploaded; the admin client immediately
  re-fetches the media list, running reconcile while variant generation is still writing. Every
  variant the registry ends up recording **exists on disk**. *(Previously: the scan deleted the
  variants written so far, and the entry was then marked `ready` recording all of them — five of
  eight missing in the reproduction.)*
- **S20 — A genuine orphan.** A variant file with no registry entry and an `mtime` older than five
  minutes is deleted by the next scan, as before.
- **S21 — A registry already damaged.** An entry with `status: 'ready'` records a variant whose file
  is gone. The next listing read drops that record; the entry keeps its remaining variants and its
  original.
