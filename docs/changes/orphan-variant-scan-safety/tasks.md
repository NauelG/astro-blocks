<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — The orphan scan may only delete what it can prove is an orphan

Three commits, ordered by severity. The reproduction and the age gate land first (T1–T3, commit
**A**) because that is the data loss; the narrowed critical section follows (T4–T6, commit **B**);
the repair of already-damaged registries last (T7–T9, commit **C**).

`npm test` runs `npm run build` first and tests import from `../dist/…`, so every verify step is
plain `npm test` unless noted.

> **Six plan-time findings folded in.**
>
> 1. **The orphan-scan deletion branch has no test.** The four `T7.1` tests in
>    `tests/media-handlers.test.js:789-915` cover pruned-entry variant cleanup and valid-variant
>    preservation. **None** creates an unregistered variant file and asserts it is deleted. The branch
>    that caused the corruption was never exercised — which is how a rule this wrong went unnoticed.
> 2. **The age gate must NOT cover pruned entries' variants.** `T7.1`'s first test writes variant
>    files with a fresh `mtime` and expects them gone. Those are deleted by the *pruned-entry* loop
>    (`api/data.ts:838-847`), driven by the registry, not by the orphan scan — they are provable
>    orphans by a different proof: their entry is gone. Gating them by age would break that test, and
>    would deserve to.
> 3. **`saveMedia` (`api/data.ts:730`) is unlocked** — a bare `writeJson`. The commit phase can call
>    it inside `withFileLock` with no deadlock. (Contrast `withUsersLock`, which is explicitly
>    non-reentrant.)
> 4. **`safeUnlink` already swallows everything but ENOENT**, so it is the right primitive for the
>    unlink phase now that it runs outside the lock and can race a concurrent delete.
> 5. **The reproduction needs fixtures from two files.** Reconcile tests live in
>    `media-handlers.test.js`; the 2000px PNG and `seedRasterUpload` live in
>    `variant-generator.test.js`. A new `tests/media-reconcile-safety.test.js` avoids duplicating
>    either into the other.
> 6. **`fs.utimes` back-dates mtime**, so the threshold is testable without a test that sleeps five
>    minutes.

---

## Commit A — the data loss

### T1 — Reproduce it (red)

- [ ] **File:** `tests/media-reconcile-safety.test.js` — new, BSL header. Port `withTempProject`, the
  `PNG_2000_BASE64` fixture and `seedRasterUpload` from `variant-generator.test.js`.

  **`RC-1`** — fire `generateAndPersistVariants(entry)` **without awaiting** (production shape: the
  upload handler does exactly this), wait ~120 ms, call `reconcileMedia()`, then await the job.
  Assert every variant the registry records exists on disk.

- **Verify:** `npm test` — `RC-1` fails, reporting variants recorded but missing. That failure *is*
  the bug; do not proceed until it reads that way.

### T2 — The age gate (green)

- [ ] **File:** `src/api/data.ts` — add `ORPHAN_MIN_AGE_MS = 5 * 60 * 1000` beside
  `VARIANT_FILE_REGEX` (`:801`), doc-commented per `design.md` §2: why absence from the registry is
  not proof, and why five minutes.
- [ ] In the orphan scan (`:860-897`), after the `validVariantUrls.has(fileUrl)` check, `fs.stat` the
  candidate and skip it when `now - stat.mtimeMs < ORPHAN_MIN_AGE_MS`. Sample `now` **once** before
  the walk, so a slow walk cannot judge later files against a moving line. A `stat` that throws is a
  `continue` — the file vanished between `readdir` and `stat`, so there is nothing to collect.
  - The gate applies **only here**. The pruned-entry loop (`:838-847`) is untouched — finding 2.
- [ ] **File:** `tests/media-reconcile-safety.test.js` —
  - **`RC-2`**: an unregistered variant file with a fresh `mtime` survives the scan.
  - **`RC-3`**: the same file, back-dated past the threshold with `fs.utimes`, is deleted. This is
    the first test the deletion branch has ever had (finding 1).
- **Verify:** `npm test && npm run typecheck && npx biome ci .` — `RC-1..3` green, and the four
  `T7.1` tests still pass untouched.

### T3 — Commit A

- [ ] `fix(media): stop the orphan scan from deleting variants that are still being written`

---

## Commit B — the contention

### T4 — Prove the loss the narrowing must not cause (red-ish)

- [ ] **File:** `tests/media-reconcile-safety.test.js` —
  **`RC-6`**: start `reconcileMedia()` and `appendMediaEntry(...)` concurrently
  (`Promise.all`, as `tests/media-concurrency.test.js:102` already does), then assert the appended
  entry survives.
- **Verify:** `npm test` — passes today, because the whole function is one critical section. It is
  written **before** T5 on purpose: it is the guard that catches the narrowing being done wrong, and
  a snapshot-writing implementation fails it.

### T5 — Narrow the critical section

- [ ] **File:** `src/api/data.ts` — restructure `reconcileMedia` into the three phases in
  `design.md` §1:
  - **inspect, unlocked**: `loadMedia`, the `fs.access` sweep → `survivors` / `prunedUrls`, the walk
    → `orphanPaths`.
  - **unlink, unlocked**: pruned entries' variant files, then `orphanPaths`, via `safeUnlink`.
  - **commit, locked**: re-read, drop entries whose `url ∈ prunedUrls`, save if changed.
  - The re-read gets a comment saying why it is not an optimisation: writing a set computed before
    the lock would discard an entry appended in between, which is the loss the lock exists to
    prevent (`api/data.ts:304-305`).
  - Return shape is unchanged (`MediaData`), so `handleGetMedia` is untouched.
- **Verify:** `npm test && npm run typecheck && npx biome ci .` — `RC-6` still green, `T7.1` green,
  `media-concurrency.test.js` green.

### T6 — Commit B

- [ ] `refactor(media): reconcile inspects without the media lock and commits a filter`

---

## Commit C — repairing what already broke

### T7 — The repair tests (red)

- [ ] **File:** `tests/media-reconcile-safety.test.js` —
  - **`RC-4`**: an entry with `status: 'ready'`, original present, recording a variant whose file is
    absent → after reconcile the record is gone and the entry survives with its remaining variants.
  - **`RC-5`**: the same shape with `status: 'processing'` → the record is **kept**. This is the test
    that stops the repair from eating an in-flight generation.
- **Verify:** `npm test` — both fail.

### T8 — The repair

- [ ] **File:** `src/api/data.ts` — in the inspect phase, for each surviving entry with
  `status === 'ready'` and a non-empty `variants`, collect the recorded URLs whose file is absent
  into `missingVariantUrls`. In the commit phase, filter those records out and mark `changed`.
  - Comment: why `ready` only, and why the repair does not regenerate (`design.md` §3).
- **Verify:** `npm test && npm run typecheck && npx biome ci .` — `RC-4`/`RC-5` green, nothing else
  regresses.

### T9 — Commit C

- [ ] `fix(media): drop registry records for variant files that no longer exist`

---

## Close

### T10 — Docs

- [ ] **File:** `docs/CONTEXT.md` §7 (gotchas) — variant files are written **outside** the media lock
  and registered afterwards, so the filesystem holds real files the registry does not know about.
  Anything that deletes by "not in the registry" must prove orphanhood another way. Link ADR-0038.

### T11 — Full verification

- [ ] `npm run typecheck && npm test && npx biome ci .` — the four-check gate.
- [ ] `npm run features:validate`.
- [ ] `npm run build:playground && npm run e2e` — `media-video.spec.ts` exercises a real upload
  through the browser, which is the path the corruption lives on.
- [ ] Confirm no incidental changes under `playgrounds/` or `data/`.

### Not in this change

- **The walk still runs on every listing read.** It no longer blocks writers — #164's original
  criteria — but the I/O per debounced keystroke remains. Moving the scan off the read path changes
  *when* orphans are collected: its own cycle, its own ADR.
- **Regenerating lost variants.** The original is intact, so images still render; only the responsive
  alternatives are fewer.
- **Version bump / `CHANGELOG`** — only when you ask to close. This one is a data-loss fix on the
  primary upload path, so it wants to ship promptly whatever the number.
