<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — The orphan scan may only delete what it can prove is an orphan

One rule: **absence from the registry is not proof of orphanhood.** A variant file that is not
recorded may be an orphan, or it may be a file being written right now by a job that has not
registered yet. The scan cannot tell those apart from the registry alone, so it needs a second
signal. That signal is age.

## 1. Shape of `reconcileMedia` after the change

Today the whole function is one critical section (`api/data.ts:816-910`). It becomes three phases,
only the middle-to-last of which takes the lock:

```
── inspect (NO lock) ────────────────────────────────────────────────
   load media.json
   fs.access per entry           → survivors / prunedUrls
   walk public/uploads/**        → orphanPaths   (mtime-gated)
   for ready entries: which recorded variants are missing on disk

── mutate files (NO lock) ───────────────────────────────────────────
   unlink the pruned entries' variant files
   unlink orphanPaths

── commit (LOCK) ────────────────────────────────────────────────────
   re-read media.json
   drop entries whose url ∈ prunedUrls
   drop variant records ∈ missingVariantUrls, on `ready` entries only
   save if anything changed
```

**Why the re-read is the load-bearing part.** The current code computes `valid` and writes
`{ uploads: valid }`. Doing that after an unlocked inspection would clobber any upload that landed
in between — precisely the loss the lock exists to prevent (`api/data.ts:304-305`). So the commit
phase does not write a snapshot; it applies a **filter** to whatever the registry holds at that
moment. New entries survive because nothing removes them.

Unlinking outside the lock is safe for both sets: pruned entries' variants belong to entries whose
original is already gone, and `orphanPaths` passed the age gate.

## 2. The age gate

```ts
/**
 * How old a variant file must be before the scan may treat it as an orphan.
 *
 * generateAndPersistVariants writes variant files WITHOUT holding the media lock and registers them
 * only afterwards (utils/variant-generator.ts), so between the first `sharp().toFile()` and
 * markMediaVariantsReady there are real files that the registry does not know about. Deleting one is
 * data loss the owner never sees: the entry still ends up `ready`, recording variants whose files
 * are gone, and the srcset 404s on the public site.
 *
 * Five minutes is far longer than any plausible encode (four breakpoints × two formats, a large
 * image, a loaded server) and costs nothing: an orphan surviving five extra minutes harms no one.
 * (ADR-0038)
 */
const ORPHAN_MIN_AGE_MS = 5 * 60 * 1000;
```

Applied where the scan currently decides:

```ts
if (!VARIANT_FILE_REGEX.test(filename)) continue;
const fileUrl = `/uploads/${yearDir}/${monthDir}/${filename}`;
if (validVariantUrls.has(fileUrl)) continue;

// Not in the registry — but that alone does not make it an orphan (ADR-0038).
const filePath = path.join(monthPath, filename);
let stat: Awaited<ReturnType<typeof fs.stat>>;
try {
  stat = await fs.stat(filePath);
} catch {
  continue; // vanished between readdir and stat — nothing to collect
}
if (now - stat.mtimeMs < ORPHAN_MIN_AGE_MS) continue; // may be mid-write
orphanPaths.push(filePath);
```

`now` is sampled **once** at the start of the phase, so a slow walk cannot let a file cross the
threshold partway through and be judged against a moving line.

The `stat` is one extra syscall per *candidate* — a variant-named file not in the registry — not per
file in the tree. In a healthy instance that set is empty.

## 3. Repairing existing damage

The scan protects new uploads. It does nothing for registries already corrupted, and the bug has been
shipping, so those exist.

While inspecting, collect the recorded variant URLs whose files are absent:

```ts
// Only `ready` entries. A `processing` entry is mid-generation: its recorded variants may legitimately
// not exist yet, and "repairing" it would delete records the job is about to fulfil.
if (entry.status === 'ready' && entry.variants?.length) {
  for (const variant of entry.variants) {
    if (!(await exists(variantPath(variant.url)))) missingVariantUrls.add(variant.url);
  }
}
```

The commit phase drops those records. The result is a registry that only claims files that exist —
self-healing on the next listing read, with no migration and no owner action.

**What this deliberately does not do:** regenerate the lost variants. The originals are intact, so
the images still render at full size; only the responsive alternatives are fewer. Regeneration is a
different operation with its own cost profile, and doing it implicitly on a read path is exactly the
kind of surprise this change is removing.

## 4. Test plan

**The reproduction is the first test**, and it must fail before the fix. Modelled on
`tests/variant-generator.test.js`, which already has the 2000px PNG fixture and `seedRasterUpload`.

| id | scenario | asserts |
|---|---|---|
| `RC-1` | fire `generateAndPersistVariants` without awaiting, call `reconcileMedia()` mid-flight, then await the job | every variant the registry records exists on disk — the bug, verbatim |
| `RC-2` | a variant file with a fresh `mtime`, not in the registry | survives the scan |
| `RC-3` | a variant file back-dated past the threshold, not in the registry | is deleted |
| `RC-4` | a `ready` entry recording a variant whose file is absent | the record is dropped |
| `RC-5` | a `processing` entry recording a variant whose file is absent | the record is **kept** |
| `RC-6` | `appendMediaEntry` racing a `reconcileMedia` | the appended entry survives — the re-read doing its job |
| `RC-7` | an entry whose original file is missing | still pruned, with its variant files unlinked (existing behaviour, unchanged) |

`RC-6` is the one that would catch a regression in the commit phase, and the one a snapshot-write
implementation fails.

Back-dating in `RC-3` uses `fs.utimes`, not a real wait — a test that sleeps five minutes is a test
nobody runs.
