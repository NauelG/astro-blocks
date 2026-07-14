<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0008 — JSON file store: atomic write + per-file mutex

- **Status:** Draft — proposed (triaged from engram memory, awaiting review)
- **Date:** 2026-06-13
- **Source:** engram observation #805

## Context

The CMS persists data as plain JSON files on disk (e.g. `data/media.json`), and the naive access pattern is a read-modify-write: load the file, mutate an in-memory structure, write it back. This is fine for a single request at a time, but breaks under concurrency in two distinct ways once a client can issue multiple simultaneous writes (e.g. uploading N files at once fires N concurrent `POST /cms/api/upload`).

The non-obvious failure modes: (1) plain `fs.writeFile` calls from concurrent writers can interleave at the byte level — if a shorter payload's write finishes after a longer payload's write started, trailing bytes from the longer write survive, producing a corrupt file that fails `JSON.parse` on the next read (observed in practice: trailing `} ]\n}` garbage after a validly-closed JSON document). (2) Even without byte-level corruption, N concurrent readers can each load the same base state, each apply one mutation, and then each write back — the last write wins and the other N-1 mutations silently vanish (lost updates). Neither failure is visible in a single-request test; both require genuine concurrent writers to reproduce, which is why a low-confidence reviewer finding on this exact race turned out to be real.

## Decision

We will make the JSON file store concurrency-safe with two independent, composable mechanisms in `api/data.ts`:

1. **Atomic write** (`writeJson`): every write serializes to a uniquely-named temp file (`${filePath}.<random-hex>.tmp`) and then `fs.rename`s it into place. `rename(2)` is atomic on POSIX, so a reader can never observe a half-written file, regardless of how many writers race on the same path. This benefits every store (pages, redirects, media, etc.) for free — it is not media-specific.
2. **Per-file mutex** (`withFileLock(key, fn)`): a promise-chain lock keyed by file path serializes read-modify-write sequences on the same file, so concurrent mutations queue instead of racing. `appendMediaEntry`, `removeMediaEntryByUrl`, and `reconcileMedia` all run their load+save under `withFileLock` keyed by a shared `mediaLockKey()`, and a parallel `withUsersLock` wrapper serializes mutating access to `users.json`.

Scope is kept intentionally tight: only `media.json` has a genuine concurrent-write path in the current API surface, so only the media functions (and, separately, users bootstrap/login) take the lock. `readJson`'s existing behavior of throwing on malformed JSON is preserved — the fix does not swallow parse errors, since that would mask real corruption instead of preventing it.

## Consequences

- Easier: any future store that gains a concurrent-write path can reuse `writeJson` and `withFileLock` without re-deriving this reasoning; `appendMediaEntry`/`removeMediaEntryByUrl` give call sites an atomic, already-locked API instead of hand-rolled load/mutate/save.
- Harder / watch for: `withFileLock` is an in-memory, per-process mutex — it does not protect against multiple server processes/instances writing the same file concurrently (would need a cross-process lock, e.g. file-based locking or a real datastore, if the deployment topology changes). The lock is also non-reentrant: a code path that already holds a given lock must not re-acquire it (documented explicitly for `withUsersLock`/`saveUsers` to avoid deadlock).
- `generateId()` (`Math.random` + timestamp) still has a theoretical collision risk; this was evaluated and left unchanged as negligible — it is a separate concern from the RMW race this ADR addresses.
- Confirmed by a TDD red/green proof: a naive non-locking `appendMediaEntry` lost 9 of 10 concurrent entries before the fix; regression coverage exists in `tests/media-concurrency.test.js` (lost-updates and interleaved append+delete+reconcile cases).

## Evidence (current repo)

- `api/data.ts:283-291` (`readJson`) — throws on any error other than `ENOENT`; parse errors are not swallowed.
- `api/data.ts:293-301` (`writeJson`) — writes to `${filePath}.<crypto.randomBytes(6).toString('hex')>.tmp` then `fs.rename`s into place; comment explicitly documents the atomicity rationale.
- `api/data.ts:303-314` (`withFileLock`) — `Map<string, Promise<unknown>>`-backed promise-chain mutex; `prev.then(fn, fn)` runs `fn` after the previous op settles either way.
- `api/data.ts:316-326` (`withUsersLock`) — exported seam over `withFileLock` keyed by `getDataPath('users.json')`, with an explicit non-reentrancy warning in the comment.
- `api/data.ts:650-733` (`mediaLockKey`, `appendMediaEntry`, `removeMediaEntryByUrl`, `reconcileMedia`) — all wrap their load+save in `withFileLock(mediaLockKey(), ...)`.
- `api/handlers/media.ts:184, 231, 253` — `handleUpload`/delete/reconcile call `data.appendMediaEntry`, `data.removeMediaEntryByUrl`, `data.reconcileMedia` respectively, i.e. go through the locked seam rather than touching the file directly.
