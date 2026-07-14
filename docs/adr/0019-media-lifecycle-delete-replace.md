<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0019 — Media lifecycle: warn-and-allow delete, same-MIME keep-URL replace

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-06-14
- **Source:** engram observation #857

> **Compliance note (2026-07-14).** Verified against the code. Warn-and-allow delete, the 415 on MIME
> mismatch, the keep-URL byte overwrite and `Cache-Control: no-cache` are all implemented and enforced.
> **Two gaps.** (1) The usage scan does not cover a legacy plain-string `seo.image`:
> `src/api/data.ts:497-508` guards on `typeof … === 'object'`, so such a page is never matched and the
> delete confirms "used in 0 places" — a warn-and-allow design makes the warning *the* safety
> mechanism, so a blind spot there is worse than no scan (**#103**). (2) Replace fires
> `void generateAndPersistVariants(...)` without awaiting (`src/api/handlers/media.ts:437`), so the
> promised `processing → ready` cycle is best-effort; there is no stuck-`processing` repair (**#96**).

## Context

Once media can be referenced from multiple places (block props across `pages.json`, `global-blocks.json`, and the separate `page.seo.image` string field), deleting or replacing a file risks silently breaking references elsewhere in the site. A hard block on delete ("cannot delete: still in use") is the safe-looking default, but it takes away the owner's agency in cases where the reference is stale or intentional, and it requires the scan to be perfectly complete or it becomes an annoying false sense of safety without full protection anyway.

Replacing a file's bytes in place (so all existing references keep working without a rewrite) only works safely if the new file has the same MIME type as the original — the on-disk extension is derived from the MIME type (see ADR-0018), so a MIME change would require a different filename/URL, defeating the purpose of a keep-URL replace.

## Decision

We will implement:

- **Where-used = warn-and-allow.** `handleGetMediaUsage` (`GET /cms/api/media/:id/usage`) returns usage count and locations on demand; the admin UI fetches this before a delete is confirmed and shows "used in N places," but the owner can still proceed with the delete regardless of the count. This is explicitly not a hard block.
- **Usage scan scope is complete**: block props inside `pages.json` and `global-blocks.json`, plus the separate `page.seo.image` string field, via a schema-free recursive walker (`utils/image-url-scan.ts`) that handles a direct `ImageFieldValue`, a localized-map wrapping one, an array of image fields, and legacy bare-string values.
- **Replace = keep-URL, same-MIME enforced.** `handleReplaceUpload` (`POST /cms/api/media/:id/replace`) rejects the new file with an error if its validated MIME type does not match the existing entry's `mimeType`; on success it overwrites the bytes at the same path/URL (so every existing reference keeps working with no rewrite), regenerates variants (`status` cycles `processing` → `ready`, see ADR-0017), and updates the entry's size/width/height while leaving `mimeType` unchanged.
- **Cache-Control on the uploads-serving route** (`routes/uploads-get.ts`) so that a keep-URL replace is actually visible to clients/CDNs instead of being served stale from cache.
- Deliberately out of scope: a "new URL" / content-rewrite style replace, changing format on replace, and hard-blocking delete.

## Consequences

- Easier: owners get visibility into blast radius before deleting, without being blocked by an imperfect or incomplete usage index; replacing a file (e.g., a corrected photo) does not require updating every page/block that references it.
- Harder / to watch: the same-MIME constraint on replace must be clearly communicated in the admin UI (a JPEG cannot be swapped for a PNG via replace — that requires delete + re-upload with a new URL, and all references would need manual updating). There is no locking around a replace racing a variant-generation job for the same entry; the `status: 'processing'` field is the mechanism relied upon to signal in-flight state, not a hard mutex. `loadPages`/`saveGlobalBlocks` have no mutex either — acceptable only because this feature never rewrites URLs in place (a future "new URL" replace would need to revisit this).

See ADR-0016 for the `ImageFieldValue` shapes the walker must recognize, ADR-0017 for the variant regeneration triggered by replace, and ADR-0018 for why the on-disk extension (and therefore the same-MIME constraint) is MIME-derived.

## Evidence (current repo)

- `api/handlers/media.ts` — `handleDeleteUpload()`: unlinks the original (and cascades variant deletion), then unconditionally prunes the registry entry — no usage check gates the delete itself, confirming "warn," not "block," is enforced client-side via the separate usage endpoint. `handleGetMediaUsage()`: looks up the entry by id, 404s if unknown, otherwise calls `data.findMediaUsages(entry.url)` and returns the result — no blocking logic. `handleReplaceUpload()`: looks up the entry, validates the new MIME via the same denylist/allowlist gate, then explicitly checks `if (mimeType !== entry.mimeType)` and returns a 415 `errors.replaceSameType` — confirms the same-MIME enforcement.
- `utils/image-url-scan.ts` — present; dedicated walker file exists as described.
- `routes/uploads-get.ts:45` — sets `'Cache-Control': 'no-cache'` on the response.
- `tests/media-usage.test.js`, `tests/media-replace.test.js`, `tests/image-url-scan.test.js` — present in `tests/`, consistent with this feature having test coverage.
- Not independently verified in this pass: that the walker's scan is *exhaustive* across every current block/prop shape in `pages.json`/`global-blocks.json` (verifying full schema coverage would require enumerating all block types, out of scope for this ADR check); the claim is taken from the source memory and the walker's existence/shape was confirmed, not its completeness.
