<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [4.0.7] - 2026-07-21

### Title

File-field validation errors are now translated

### Fixed

- **A validation error on a file field showed a raw internal key instead of a message.** When a block's file field failed validation — the value was not a file object, or a file had no URL — the admin editor displayed the literal text `blockValidation.fieldMustBeFile` (or `…fieldFileNeedsUrl`) instead of a readable sentence, in both English and Spanish. Two message keys had drifted out of the translation catalogs while remaining in the validator. Both are now present and translated, so file-field errors read like every other validation message. (#40)

### Changed

- **Internal: the admin translation catalogs and the block-validation messages are now checked by the compiler.** Catalog parity between English and Spanish, and the single source for validation-message text, were previously kept aligned by hand and by a comment — which is how the bug above shipped unnoticed. They are now enforced at build time, so this class of drift cannot recur silently. No consumer-visible behaviour change beyond the fix above. (#40)

## [4.0.6] - 2026-07-21

### Title

The upload picker and the server agree on the allowed file types

### Fixed

- **The admin upload picker could offer file types the server would reject.** The allowed-file-type list was decoded in three places — the upload endpoint and two admin surfaces (the media page and the block-form file picker) — and the three did not agree. The two admin surfaces required a non-empty list and, for anything they considered invalid, quietly fell back to the full default catalog; the server did not. So a project that configured `allowedFileTypes` narrowly (or to an empty list, which rejects everything) could see the picker advertise types the server then refused on upload. All three now share a single decoder, so what the picker offers cannot drift from what the server accepts, and a malformed entry is rejected rather than passed through to the picker uncoerced. The `accept` attribute remains a picker hint only — the server has always been the enforcement point. (#116)

### Changed

- **Internal: the build-time "bake" is now a single module.** The mechanism that carries configuration and runtime registries into the server bundle (double-encoding on write, guarded decoding on read) was previously reimplemented at every reader — the source of several past resolution bugs. It now lives in one place. No consumer-visible behaviour change beyond the allowlist fix above. (#116)

## [4.0.5] - 2026-07-20

### Title

Corrected documentation: importing users signs everyone out

### Fixed

- **The bundled documentation described session behaviour backwards.** `AGENTS.consumer.md` stated that importing the Users unit invalidated only the importing browser and that "other active sessions remain valid because sessions are stateless JWTs". The opposite is true, and has been since `3.7.0`: importing the Users unit **revokes every session on the instance**, and every token issued beforehand stops being accepted. Anyone who planned around other devices staying signed in was in for a surprise, and anyone reasoning about incident response had the guarantee inverted. (#149)

  The stale premise is corrected in both bundled documents: sessions are **not** stateless. Every request re-validates the token against the user store, which is exactly what makes deleting a user, changing a password or restoring the user store take effect immediately rather than whenever the token happens to expire.

  The README's Import / Export section, which never mentioned sessions at all, now says plainly that importing Users signs everyone out and that the other four units do not affect sessions.

  Documentation only — no behaviour changed. This release exists so the corrected `AGENTS.consumer.md`, which ships inside the package and is what AI coding assistants read, reaches consumers rather than waiting for the next functional change.

## [4.0.4] - 2026-07-20

### Title

Repeated failed logins are slowed down

### Fixed

- **The admin login had no defense against password guessing.** Nothing limited how many attempts an unauthenticated caller could make against the owner account: password hashing made each guess expensive, but nothing bounded the number of guesses. Repeated failures for the same email now wait progressively longer — the first few attempts are answered immediately, then the delay doubles up to a few seconds — which takes a sustained attacker from thousands of guesses per minute to roughly seven. A correct password clears the delay instantly, and it is forgotten entirely after fifteen minutes of no attempts, so an owner who mistypes their password is never locked out or made to wait on their next visit. (#125)

  Two details worth knowing when planning a deployment. The delay is tracked **in memory per server process**, so it does not survive a restart and is not shared between instances — a rate limit at your reverse proxy or edge is still the layer that bounds request volume, and this is defense in depth beneath it. And it is keyed by **email address only, never by client IP**: behind a proxy the address the application sees belongs to the proxy, and the forwarded-for header is set by the caller, so neither is a value this package can trust. See the new *Login throttling* section in the README.

  A throttled attempt is deliberately indistinguishable from any other failed login — same response, same status — and the delay builds the same way for email addresses that have no account, so the protection never reveals which addresses are registered.

## [4.0.3] - 2026-07-20

### Title

The interface-language selector opens again

### Fixed

- **The UI-language selector inside the profile menu did not open.** Clicking it did nothing and reported no error. Introduced in `4.0.2`: the fix that stopped select dropdowns being clipped inside modals repositioned every dropdown against the viewport, and the profile menu animates with a CSS transform — which silently changes what "against the viewport" means for anything inside it. The panel was opening around a thousand pixels off the right edge of the screen. Dropdown panels are now positioned by measuring where they actually land rather than by assuming, so the calculation holds inside any container. Only the admin panel's own selectors were affected; a site's public language switcher never was. (#146)

## [4.0.2] - 2026-07-20

### Title

Select dropdowns are no longer cut off inside modals

### Fixed

- **The select dropdown escapes the modal that was clipping it.** Opening a select inside a modal — creating a redirect, editing a user — cut the options panel off at the edge of the modal body, added a scrollbar and made the dialog taller than its content. The panel was positioned absolutely, so the nearest scrolling ancestor both clipped it and counted it towards its own scrollable height. It is now positioned against the viewport and measured from its trigger, so no ancestor can clip it. If it does not fit below the field it opens upwards, and if it fits on neither side it shortens rather than covering the field being edited. (#138)

## [4.0.1] - 2026-07-20

### Title

A concurrent write can no longer discard a session revocation

### Fixed

- **Every mutation of `users.json` is now serialized behind a single seam.** Four code paths wrote the user store and two of them took no lock — and because each write persists the **whole list**, two overlapping requests overwrote each other across every record, not just the one they meant to change. What that could silently discard included the `tokenVersion` increment, which **is** a session revocation: an operator changed a compromised password, the API answered `200` and the admin reported success, while the token they believed they had killed stayed valid for the rest of its 7-day lifetime — with no error and no log line. User creation, deletion and role changes could be lost the same way. The last-owner guards and the email-uniqueness check are now re-validated against the freshly re-read list rather than a stale one, so they hold under concurrency too. Password hashing moved out of the critical section, so the two paths that already held the lock now hold it for less time than before. (#135, ADR-0030)

## [4.0.0] - 2026-07-19

### Title

Astro 7 and Node 22.12 are now required

### Changed

- **Node.js 22.12 or newer is now required** (was 18). This will break more installs than anything else in this release. The floor is copied from Astro 7's own `engines` rather than rounded down: Astro 7 refuses to start on Node 22.0–22.11, so declaring anything lower would be a guarantee the package cannot honour.
- **Astro 7 is now required** — `peerDependencies` is `astro ^7.0.0`. Exactly one Astro major is supported at a time and there is no compatibility branch for Astro 6, so the `3.x` line is the last that supports it. AstroBlocks versions its own contract: the major tracks **our** breaking changes, not Astro's, so the numbers do not line up and are not meant to. The README carries a compatibility table, and `peerDependencies` remains the authoritative, machine-checked statement. (ADR-0029)
- **Route caching moved out of `experimental`.** Astro 7 graduated the feature, so consumers must change `experimental.cache` to top-level `cache` (and `experimental.routeRules` to `routeRules`). Nothing else about the API changed, and `memoryCache()` still ships. AstroBlocks reads the provider only to warn when `publicRendering: "server"` is combined with caching enabled and no provider configured — it still never installs one.

### Fixed

- **Admin icon and label spacing no longer depends on HTML whitespace.** Astro 7 compresses HTML with JSX rules, which strips the whitespace between inline elements. The sidebar navigation and the import/export checkboxes were using that whitespace as their only spacing, so icons and labels rendered glued together. Both now declare an explicit flex gap, verified by measuring every admin element's geometry under both compression settings: 142 elements whose position depended on whitespace, now zero. (#55)

### Upgrading

Beyond raising Astro and Node and moving the `cache` config, expect **Astro 7 to reject invalid HTML in your own templates**. It replaces the Go compiler with a Rust one that validates markup strictly, so a literal `<` in body text — `<p>Tags (array<string>)</p>` — now fails the build as an unclosed tag. That is your markup to fix, not an AstroBlocks regression. See the README's *Upgrading from 3.x to 4.x* section and Astro's [v7 upgrade guide](https://docs.astro.build/en/guides/upgrade-to/v7/).

## [3.8.0] - 2026-07-19

### Title

Restoring a backup no longer revives revoked sessions

### Fixed

- **A restore can no longer rewind `tokenVersion`.** Restoring a backup replaced `users.json` wholesale, so the archive's session generations overwrote the store's and the counter moved **backwards**. Every token minted at those generations was re-armed for the rest of its 7-day lifetime — including one a password change had already revoked: change a compromised password, restore a backup taken before it, and the stolen token works again. The password rollback is visible and is what "restore" means; the session resurrection is not. Restored records are now written at one generation **above the high-water mark** of the current store and the archive combined, so no pre-restore token can match — including one held by a user deleted after the backup and resurrected by it, whom a per-record comparison cannot reach. (#134, ADR-0028)
- **The restore write is serialized.** The authenticated import path held no lock while replacing `users.json`. It now acquires the users lock for any run that can write the file; imports that cannot touch users keep their previous latency. (#134)

### Changed

- **Restoring the `users` unit now signs every user out.** Restore is treated as a session-revocation event rather than a data operation, so every session on the instance ends — every time, including when nothing was compromised. This is deliberate: one rule that cannot be subtly wrong, over a narrower rule that leaves a resurrected account's old tokens valid. The administrator performing the restore was already returned to the login screen; other users now are too. (ADR-0028)

## [3.7.3] - 2026-07-17

### Title

Upgraded installations can log in again

### Fixed

- **`tokenVersion` is normalized at the store boundary.** An installation upgraded to 3.7.0–3.7.2 whose users predate that release could not log in **at all**: those records carry no `tokenVersion`, so `createToken` signed `{ tokenVersion: undefined }`, `JSON.stringify` dropped the claim, and `getAuth` rejected the very token login had just issued — a `200` response carrying a dead token, with no useful error. `loadUsers`, the sole reader of `users.json`, now coerces every record's `tokenVersion` to a positive integer: absent (pre-3.7.0) and malformed values read as `1` instead of locking the account out permanently. The default lives in one place now, so no caller can forget it. Read-only — nothing is rewritten and no migration runs. (#124, ADR-0027)

## [3.7.2] - 2026-07-15

### Title

Variant jobs no longer leak into the repo root

### Fixed

- **Fire-and-forget variant jobs are drained before test teardown.** `handleUpload`/`handleReplaceUpload` spawn variant generation un-awaited; a job that resolved the store path after a test unset `ASTRO_BLOCKS_PROJECT_ROOT` wrote `data/media.json` into the package root (#96). Jobs are now registered and awaitable via `drainVariantJobs`, drained in test teardown, and a `check-root-data-leak` guard chained into `npm test` fails the suite if a package-root `data/` ever appears.

## [3.7.1] - 2026-07-15

### Title

Restore can no longer clobber a concurrent upload

### Fixed

- **Restore routes its media write through the media mutex.** The import/restore path overwrote `media.json` via an unlocked write while holding only the users lock — a different key — leaving a lost-update window against a concurrent upload's locked append (ADR-0008). The raw whole-registry write is now module-private, and restore uses a new locked `replaceMedia` seam, so no wholesale write can bypass the media mutex. (#100)

## [3.7.0] - 2026-07-15

### Title

Sessions can finally be revoked

### Added

- **Session revocation via `tokenVersion`.** Each user record carries a session generation that the
  JWT echoes; bumping it invalidates every live token for that user. A **password change** now signs
  the user out everywhere. (ADR-0027, #124)

### Changed

- **Authentication is now stateful.** `getAuth` re-loads the user from the store on every request
  and treats it as the single source of truth for identity. The JWT carries only `sub` +
  `tokenVersion`; `email` and `role` are read fresh, so a stale claim can no longer drive an
  authorization decision.
- **Every active session is invalidated on upgrade.** Tokens issued before this release carry no
  `tokenVersion` claim and are rejected — all users must log in again once. There is no migration.

### Security

- **Fixed a fail-open authorization hole (#124).** A deleted or demoted user previously kept full
  API access until their token expired (up to 7 days), and a stale `role: 'owner'` claim still
  passed the owner gate. Deletion and demotion now take effect on the next request.

## [3.6.4] - 2026-07-15

### Title

The admin panel and README stop calling every file an image

### Changed

- **Admin media copy speaks of files and assets, not images.** The library, counters, dropzone,
  search and the block picker now name uploads by what they are: the upload widgets say _file_ (the
  disk action), the library grid and counters say _asset_ (ES _recurso_). Image-specific surfaces —
  alt text, dimensions and responsive variants — keep saying _image_ by design.
- **The media section lead names the real categories.** It listed a raster-only format list
  (`JPG, PNG, WebP, SVG, GIF`) that has been stale since 3.6.0; it now reads "images, video, audio and
  documents".
- **README media section reframed around any file.** The `Media` section opens on uploading any file,
  with responsive images and non-image file props as peer subsections rather than the whole story.

### Fixed

- **The block picker no longer titles itself "Choose image" for every file type.** Opening it for a
  PDF, video or audio prop showed a modal headed "Choose image"; it now titles itself by prop type
  (image props keep "Choose image", file props read "Choose media").
- **The `file` field is now localized.** Its controls ("Choose file", "Replace", "Clear") shipped
  hardcoded in English, so a Spanish panel showed them untranslated; they now resolve through the i18n
  catalog. The image field's in-place labels had the same latent gap and are fixed too.
- **Spanish media messages agree in gender with a file, not an image.** Upload/delete/replace toasts
  read _subido_/_eliminado_/_reemplazado_ now that the unit is a masculine _recurso_/_archivo_.

## [3.6.3] - 2026-07-15

### Title

Redirect targets can no longer point off-site

### Fixed

- **Stored open redirect via backslash (security).** The redirect path validator did not block
  backslashes, and browsers normalize `\` to `/` — so a redirect target of `/\evil.com` was stored
  and served as a protocol-relative redirect to `evil.com`, hitting unauthenticated public
  visitors. The validator now rejects any path containing `\` or starting with `//` (external URLs
  in disguise) with the existing "must be internal" error, on both the source and target fields.
  Already-stored malicious entries are dropped at read time, so no data migration is needed.
  Note: a leading `//` (previously silently collapsed to `/`) is now a validation error —
  redirect targets are internal-only, and off-origin shapes are rejected, never rewritten.

## [3.6.2] - 2026-07-15

### Title

A slimmer admin bundle, a modular block editor

### Changed

- **The admin JS bundle no longer embeds CSS.** The media picker's styles (~163 lines) used to ship
  inside the block editor's JavaScript and were injected via `innerHTML` when the picker opened.
  They now live in the global admin stylesheet with the rest of the panel's CSS. The picker looks
  and behaves exactly the same.
- **The block editor's internals are modularized.** `block-form.ts` (1654 lines, five concerns) is
  now a pure re-export facade over seven focused modules (`client/block-form/`): mount/wiring,
  picker dialog, field renderers, in-place DOM sync, array limits, file-accept computation and
  shared helpers. The public API and import path are unchanged — no action needed for consumers.
- **Source guards cover the new layout.** The canonical-escaper and upload-error guards now scan the
  whole `block-form/` directory instead of one pinned file, and the admin HTML rendering spec (R3)
  explicitly covers client subdirectories.

## [3.6.1] - 2026-07-14

### Title

Block schemas resolve on a deployed server

### Fixed

- **The admin could not edit blocks on a deployed server.** The plugin generates two files into the
  gitignored `.astro-blocks/` directory: the global-blocks registry and the **block schema map**. The
  registry is baked into the bundle at build time; the schema map was not — it was read from disk at
  request time. That directory is a build artifact and is **absent on a deployed server**, so block
  validation and the admin block picker failed there, while public rendering kept working through the
  bundled alias. Saving a page returned `500`; the "add block" button was dead. The schema map is now
  baked alongside the registry, and `.astro-blocks/` is no longer needed at request time at all.
- **A failed registry lookup no longer masquerades as an empty one.** When the global-blocks registry
  could not be resolved, it silently defaulted to an empty list — indistinguishable from *"this
  project declares no global blocks"*. It now fails visibly.
- **The admin says what went wrong.** When block schemas cannot be loaded, the page editor reports it
  instead of silently disabling *Add block*, and the global-block editor reports the load failure
  instead of *"schema not found"* — a message that pointed at a schema that was perfectly fine.

### Changed

- **An unresolvable schema map is now a hard failure on every admin API path, reads included.** It
  previously failed loudly on writes but degraded quietly on reads, serving pages projected without a
  schema — from a server that would reject the very next save. Deleting a language proceeded outright.
  Reads now return `500` and destructive operations refuse to run. This only manifests on a
  deployment that was already broken; a healthy one is unaffected. See ADR-0025.

## [3.6.0] - 2026-07-14

### Title

Video and audio uploads, on a supported-file-type catalog

### Fixed

- **`allowedFileTypes` never reached the server.** The plugin passed the allowlist to the runtime
  through a `vite.define` bridge that emitted an array literal, while the server guarded with
  `typeof raw === 'string'` before parsing — so the guard rejected it and silently fell back to the
  shipped defaults. **Any `allowedFileTypes` configuration was ignored, in every released version.**
  This is what caused `type: 'file'` to reject an MP4 with `415 Unsupported Media Type` even with
  `video/mp4` in the allowlist: the upload was refused by the allowlist gate, which never saw your
  config.
- **AVIF variants were served as `application/octet-stream`.** The responsive-image pipeline writes
  `.avif` variants, and the serving route had no `.avif` entry in its extension map. They are now
  served as `image/avif`.
- **Uploads are authorised before the request body is read.** The size limit used to be checked
  *after* the whole file had been buffered into memory, so a `413` rejected what the server had
  already swallowed.

### Added

- **Video and audio uploads.** `video/mp4`, `video/webm` and `audio/mpeg` are supported file types.
  They are **not enabled by default** — add them to `allowedFileTypes` to opt in.
- **HTTP Range support on `/uploads/*`.** Responses advertise `Accept-Ranges`, answer a satisfiable
  `Range` with `206 Partial Content`, and an unsatisfiable one with `416`. Without this, Safari
  refuses to play a video at all — it requests the first two bytes of a media source and discards any
  source that does not answer. Files are now streamed from disk rather than read whole into memory,
  for every file type.
- **`customFileTypes`** — register a file type the catalog does not cover:
  `customFileTypes: [{ mime: 'application/zip', ext: '.zip', category: 'document' }]`. You supply the
  MIME, the extension and the category and nothing else: every registered type is served as
  `application/octet-stream` with `Content-Disposition: attachment`, always. The security denylist
  still applies, and a registration may not borrow a builtin's extension.
- **`maxUploadBytes`** — per-category upload ceilings (image 5 MB, document 10 MB, audio 20 MB, video
  200 MB by default). `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` remains a global runtime limit; the most
  specific setting wins.

### Changed

- **`allowedFileTypes` now selects from a catalog of supported types.** The extension a file is stored
  under is derived from its validated MIME type — a security requirement — so AstroBlocks can only
  accept types it has an extension for. **A MIME type with no catalog row now fails the build**,
  naming it and listing what is supported, instead of being silently ignored and rejecting every
  upload of that type at runtime with a `415`.
- Video, audio and document uploads are **streamed to disk** instead of buffered in memory. Images
  still buffer, because the image pipeline needs the bytes resident.
- `fileCategory` on a media entry widens to `'image' | 'video' | 'audio' | 'document'`, and the media
  library and block picker render a category icon for each. Existing entries are unaffected.
- Video and audio are **passthrough**: no dimensions, duration, poster frame or transcoding, and no
  new native dependency.

## [3.5.4] - 2026-07-14

### Title

Enforce the canonical HTML escaper across every admin page

### Security

- **Fixed a stored cross-site-scripting vulnerability in the Languages and Users admin pages, and
  three more sinks in the admin layout.** Both pages built table rows by concatenating API data —
  language codes and labels, user emails and ids — straight into `innerHTML` with no escaping, in
  both text and attribute positions. The audit found three further unescaped sinks in the shared
  layout: the pre-login site name, the toast title, and — widest of all — the content-language
  selector, which renders language data on *every* admin page. A malicious value (plantable by an
  owner, or restored from an import archive) executed the next time an owner opened the panel. Every
  sink now passes API data through the canonical `escapeHtml` / `escapeAttr` pair before it reaches
  the DOM.

### Changed

- **Admin HTML-escaping is now enforced across the whole admin, not just `client/*.ts`.** The two
  offending pages kept their logic in inline `define:vars` scripts, which Astro forces `is:inline` —
  cutting them off from the canonical escaper and from Biome's linting. They were migrated to
  `client/languages-editor.ts` and `client/users-editor.ts` (the documented two-script i18n bridge),
  and a new repo-wide source guard (`tests/html-escape-guard.test.js`) walks every admin `.ts` and
  `.astro` file, failing CI if any dynamic HTML sink is built without the canonical escaper. The
  decision and its rationale are recorded in ADR-0022.

## [3.5.3] - 2026-07-07

### Title

Consolidate three divergent HTML-escape helpers into one canonical module

### Security

- **Removed a latent cross-site-scripting risk from divergent HTML escapers.** The admin UI
  carried three separate HTML-escape implementations with different character coverage: a
  two-character attribute escaper in the media library, a DOM-based text escaper in the shared
  client utilities, and a five-character escaper local to the block form. Divergent escapers are
  how attribute-breakout XSS slips in as code evolves. Every call site now routes through a
  single canonical `escapeHtml` / `escapeAttr` pair (`utils/html-escape.ts`) that encodes all
  five HTML-significant characters (`&`, `<`, `>`, `"`, `'`) in one pass, and the redundant local
  escapers have been deleted. Behavior-preserving hardening — no visible change to rendered
  output for well-formed content. Closes #39.

## [3.5.2] - 2026-07-07

### Title

Serialize first-user login against the bootstrap import to close a TOCTOU race

### Security

- **The unauthenticated bootstrap import can no longer silently overwrite a just-created
  owner account.** On a zero-user instance, a first-user login (`handleLogin`) and the
  one-time bootstrap import (`POST /cms/api/import/bootstrap`) could race: the login's user
  write could land between the import's in-lock re-check and its own user write (during
  archive extraction), letting the import overwrite the freshly created owner. First-user
  creation and the bootstrap user mutation now serialize on a single `users.json` lock via a
  narrow `withUsersLock` guard, so the two can no longer interleave. The window was narrow and
  the practical risk on a self-hosted single-owner CMS low, but it was a real correctness hole
  on a destructive unauthenticated path. Internal change only — no public API or configuration
  change for consumers.

## [3.5.1] - 2026-07-06

### Title

Harden CMS API authorization with a declarative route table

### Changed

- **Authorization is now correct by construction.** The CMS API's hand-rolled per-verb
  request dispatcher was replaced with a single declarative route table (`api/route-table.ts`,
  43 entries) and a central matcher that enforces each route's declared auth level
  (`public` / `user` / `owner`) before the handler runs. Previously, owner-only routes relied
  on each branch remembering to call the owner guard inline, and there was no router-level
  regression coverage — a future route could silently ship ungated. Now a route cannot be
  reached without an explicit, declared auth level, and router-level regression tests fail if
  any owner gate is dropped. Behavior is unchanged: identical status codes across all 43
  routes, and the six handler-internal owner guards are retained as defense-in-depth. Internal
  refactor only — no public API or configuration change for consumers.

## [3.5.0] - 2026-07-06

### Title

Fail fast when no SSR adapter is configured

### Added

- **SSR adapter guard.** The integration now verifies that an Astro SSR adapter is
  configured, since the CMS admin panel and its API routes render on demand
  (`prerender = false`). When none is present, `astro build` fails fast with an
  actionable `[astro-blocks]` error instead of a cryptic Astro error; `astro dev`,
  `preview` and `sync` warn instead of throwing so local workflows keep working. The
  check is adapter-agnostic (any of `@astrojs/node`, `@astrojs/vercel`, `@astrojs/netlify`,
  `@astrojs/cloudflare`, …) and is exposed as the `assertAdapterConfigured` named export.

## [3.4.2] - 2026-07-06

### Title

Dependency maintenance

### Changed

- Bumped runtime dependencies within their existing ranges: `@lucide/astro` to 1.23.0 and
  `sharp` to 0.35.3.
- Bumped development tooling: `@playwright/test` to 1.61.1 and the `@types/node` type
  definitions to 26.0.1.

## [3.4.1] - 2026-07-06

### Title

Fix attribute-breakout XSS in the admin editors

### Security

- **Admin editor attributes are now attribute-safe.** Several interpolations in the configs,
  menus, redirects and page editors escaped only `&`, `<` and `>` (text-context escaping) while
  rendering inside double-quoted HTML attributes. A value containing a double quote — for
  example a config description or a menu name/path entered in the admin UI — could break out of
  the attribute and inject markup. All attribute-context interpolations now use a dedicated
  attribute-safe escaper that also escapes `"` and `'`, backed by a single canonical escaper
  module. A regression guard test fails the build if the text-only escaper is ever used inside
  an attribute context again.

## [3.4.0] - 2026-07-02

### Title

Require ASTRO_BLOCKS_JWT_SECRET in production and fix the admin session-secret variable

### Security

- **Admin auth fails closed without a configured secret.** In a production build, if no JWT
  signing secret is configured the login endpoint now returns `503` and no session is issued,
  instead of silently falling back to a public built-in constant. Signing and verifying tokens
  with that constant allowed an owner session token to be forged. Development keeps the fallback
  with a loud warning so local iteration is unaffected. Production is detected via Astro's
  build-time `import.meta.env.PROD` (with `NODE_ENV=production` as a secondary signal), so the
  guard fires regardless of whether the host sets `NODE_ENV`.
- **Session secret is now read from `ASTRO_BLOCKS_JWT_SECRET`.** Earlier releases read only
  `CMS_JWT_SECRET` while the documentation specified `ASTRO_BLOCKS_JWT_SECRET`, so deployments
  that followed the docs were running on the built-in fallback. `CMS_JWT_SECRET` is still accepted
  as a deprecated legacy alias (with a warning) and will be removed in a future release.

### Changed

- **Action required for production:** set `ASTRO_BLOCKS_JWT_SECRET` to a strong random value.
  Without it, the admin login is disabled (returns `503`) in production builds.

### Documentation

- Corrected the admin authentication docs in `README.md` and `AGENTS.consumer.md`: the admin
  account is created on **first login** (there are no `ASTRO_BLOCKS_ADMIN_USER` /
  `ASTRO_BLOCKS_ADMIN_PASSWORD` variables — they were never read by the code), and the session
  token is returned in the login response and sent as an `Authorization: Bearer` header rather
  than an `httpOnly` cookie.

## [3.3.2] - 2026-07-02

### Title

Surface admin upload failures to the user

### Fixed

- **Admin upload feedback**: two admin upload call sites silently swallowed failed uploads (non-2xx responses or network errors) — the SEO image field and the block media picker. A failed upload now shows an error toast with the server-provided message, matching the media library's behavior. Reuses the existing `media.uploadError` / `media.uploadFailed` messages, so no new translations are required.

## [3.3.1] - 2026-07-02

### Title

Fix admin upload, cache invalidation, and global-block editing

### Fixed

- **Block editor uploads**: uploading an image or file from a block (or the SEO image field) failed because those pickers sent `multipart/form-data`, which the upload endpoint does not parse. All uploads now use the same raw-binary protocol as the media library, unified in a single shared helper.
- **Cache invalidation**: the "Invalidate cache" action returned a `403` behind reverse proxies. The bodyless POST now sends a non-form `Content-Type`, so Astro's origin-check middleware no longer rejects it.
- **Global-block editing**: opening or editing a global block returned a `404` on deployed sites (rendering was unaffected). The admin API previously resolved block declarations from the gitignored `.astro-blocks/runtime.mjs` build artifact at request time; the registry is now baked into the bundle at build, so it is always available.

### Added

- End-to-end coverage (Playwright) for block image/file uploads, cache invalidation, and global-block resolution — each guarding the exact regression it fixes.

## [3.3.0] - 2026-07-01

### Title

Import/Export — full site backup and restore

### Added

- **Owner-only export** (`GET /cms/api/export?units=…`): streams a `.zip` archive of the selected content units with a `manifest.json` containing the schema version and per-file SHA-256 checksums.
- **Owner-only import** (`POST /cms/api/import`): validates the zip structure against the manifest, then performs a REPLACE-ALL of the selected units. A pre-replace backup snapshot is created automatically; the previous 5 snapshots are retained under `data/_backups/<ISO>/`.
- **Bootstrap import** (`POST /cms/api/import/bootstrap`): unauthenticated endpoint — available ONLY when no user accounts exist — to seed a fresh instance from a zip file directly from the login screen.
- **Admin page `/cms/import-export`** (owner-only): unit selection checkboxes (export direction), manifest preview before import, destructive-action confirmation dialog, and automatic session close when the Users unit is imported.
- **Five selectable content units**: Users (including hashed passwords) · Pages · Media (registry + `public/uploads/` binaries) · Global Blocks · Configuration (site settings / configs / menus / redirects / languages).
- **`fflate` dependency**: used for zip compression and decompression during export and import.

### Security

- **Zip-bomb protection**: incoming compressed bodies are rejected when they exceed `ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES` (default 1 GB). Decompressed files are rejected individually above `ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES` (default 50 MB) and collectively above `ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES` (default 500 MB).
- **Path traversal guard**: all entries in an imported zip are validated to resolve within the expected target directory; entries with `..` components or absolute paths are rejected.
- **Manifest validation**: the import pipeline verifies SHA-256 checksums from `manifest.json` before writing any data.
- **Export and import are owner-only**: both endpoints require a valid JWT with the `owner` role. Bootstrap import is gated behind a hard server-side check that the user store is empty.

### Notes

- **New environment variables** (all optional, with defaults):
  - `ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES` (default `52428800` — 50 MB): maximum decompressed size per individual file during import.
  - `ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES` (default `524288000` — 500 MB): maximum total decompressed size of all files during import.
  - `ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES` (default `1073741824` — 1 GB): maximum compressed body size accepted by the import endpoints.
- **Backup retention**: pre-import snapshots are stored under `data/_backups/<ISO-timestamp>/` and auto-pruned to keep the 5 most recent.
- **Known v1 limitations** (tracked issues): session close on Users-unit import is current-browser-only because sessions are stateless JWTs (issue filed); the bootstrap endpoint has a residual TOCTOU window between the empty-user-store check and the write (issue #25); export buffers source files in memory before streaming the zip output (issue #28).

## [3.2.2] - 2026-06-30

### Title

Fix media uploads failing with a 403 behind a reverse proxy

### Fixed

- **Media uploads and replacements work again behind a reverse proxy.** Uploading or replacing an image in the admin media library returned `403 Cross-site POST form submissions are forbidden` in production deployments behind a reverse proxy or CDN. Root cause: the admin client sent uploads as `multipart/form-data`, a "form-like" content type that triggers Astro's built-in CSRF origin-check; behind a proxy the browser `Origin` does not match the server-computed `url.origin`, so the request was rejected before reaching the handler. Local development was unaffected because origin and host match there. Upload and replace now send the file as a raw binary body with its real MIME type as `Content-Type` and the original filename in a percent-encoded `x-cms-filename` header; the server reads the body via `request.arrayBuffer()`. CSRF protection is preserved — these endpoints authenticate via a JWT in the `Authorization` header (never an ambient cookie), and the custom header forces a CORS preflight a cross-origin attacker cannot satisfy.

## [3.2.1] - 2026-06-30

### Title

Fix settings page never saving its changes

### Fixed

- **Settings now save again.** The settings page silently issued a native `GET /cms/settings?...` instead of `PUT /cms/api/site`, so site settings (name, base URL, favicon, logo, theme colors) were never persisted. Root cause: the page's inline `<script define:vars={{ settingsI18n }}>` contained TypeScript. `define:vars` forces an `is:inline` script, which Astro does not transpile, so the raw TypeScript threw a `SyntaxError` in the browser. That killed the whole script before its `submit` handler could register, leaving the form to fall back to a native GET. The fault was introduced during the admin i18n migration, when the script gained `define:vars`; the TypeScript had been harmless before because Astro transpiled the plain `<script>`.

### Changed

- **Settings page logic moved to an external client module.** The color pickers, live theme preview, and save-on-submit behavior now live in `routes/admin/client/settings-editor.ts`, matching the other admin editors (`page-editor`, `configs-editor`, etc.). Astro transpiles external client modules, so TypeScript can no longer reach the browser unprocessed. No user-facing behavior change beyond the fix above.

## [3.2.0] - 2026-06-30

### Title

Non-image file uploads (PDF and document support)

### Added

- **Non-image file uploads:** the media library now accepts and serves allowlisted non-image files (PDF by default) alongside images. Non-image files are stored byte-for-byte in the same `public/uploads/YYYY/MM/` location as images; the backend never manipulates them (no `sharp`, no responsive variants).
- **`allowedFileTypes` plugin option:** a configurable allowlist of MIME types governing which files may be uploaded. Defaults to the existing image types plus `application/pdf`. A `DEFAULT_ALLOWED_FILE_TYPES` constant is exported so integrators can extend the defaults (`allowedFileTypes: [...DEFAULT_ALLOWED_FILE_TYPES, 'application/msword']`).
- **`file` block prop type:** `defineBlockSchema` now supports `{ type: 'file' }` with an optional per-component `accept: string[]` (a MIME subset of the global allowlist) and an optional `download?: boolean`. The admin media picker enforces the effective `accept ∩ allowedFileTypes` intersection, both in the file input and in the selectable library grid.
- **`fileDownloadUrl` helper:** exported from `@astroblocks/astro-blocks/getFileValue` for rendering download links. Combined with the serving route, a component controls download behaviour: documents are served inline by default, and `?download` forces `Content-Disposition: attachment`.
- **Accessible document tiles:** the admin media library renders non-image assets as accessible document tiles (`role="img"` with a descriptive label and a decorative icon) instead of broken image elements.
- **Playground demo:** a `DownloadButton` component in `playgrounds/basic` demonstrating the `file` prop type end to end.

### Changed

- **PDF is now accepted by default.** Previously any non-image upload (including PDF) was rejected with HTTP 415. With the default `allowedFileTypes`, `application/pdf` uploads now succeed. This is the only behavioural default change; image-only setups are otherwise unaffected. Integrators who require the prior behaviour can set `allowedFileTypes` to image types only.

### Security

- A hard server-side denylist of dangerous types (e.g. `.html`, `.js`, `.exe`, `.sh`, executable/script MIME families) is always enforced on both upload and replace, on the MIME type and the MIME-derived extension, and takes precedence over `allowedFileTypes` — the allowlist can never enable a dangerous type. SVG remains served as `Content-Disposition: attachment`. The `Content-Disposition` filename is sanitised as a defence-in-depth measure.

### Notes

- Available under BUSL-1.1. The `MediaEntry` registry gains an additive optional `fileCategory: 'image' | 'document'` field, derived in memory for pre-existing entries — no data migration is required.

## [3.1.1] - 2026-06-29

### Title

Project governance and contributor documentation

### Added

- Contributor intake: GitHub issue forms (bug report, feature request), an issue template config, and a pull request template.
- Community health files: `SECURITY.md` (vulnerability disclosure policy) and `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- `DECISIONS.md` — a discoverable Architecture Decision Record log documenting key project decisions.
- Repository hygiene: `.editorconfig`, `.gitattributes`, and Dependabot configuration for npm and GitHub Actions.
- Secret scanning: a gitleaks configuration and a graceful-degradation pre-commit hook, wired via the new `hooks:install` and `secrets` npm scripts.

### Notes

- These additions affect the repository and contributor workflow only. The published package tarball is unchanged from 3.1.0 (the new files are not part of `package.json#files`).

## [3.1.0] - 2026-06-17

### Title

Admin UI internationalisation (English and Spanish)

### Added

- **Admin UI language support (en / es):** the CMS admin panel now renders in English or Spanish. The active language is resolved server-side on every SSR request so the first paint is always correct — no flash. Resolution order: `cms-ui-locale` cookie override → `Accept-Language` header (primary-subtag matching, e.g. `es-MX → es`) → English fallback.
- **Dynamic `<html lang>` attribute:** the `<html>` element now reflects the SSR-resolved UI language on every page (`lang="en"` or `lang="es"`), satisfying WCAG 3.1.1.
- **Language switcher:** an accessible native `<select>` control in the profile dropdown allows the user to switch between English and Spanish. Selecting a language writes the `cms-ui-locale` cookie (`Path=/cms; SameSite=Lax; Max-Age=31536000`, not HttpOnly), mirrors to `localStorage`, and reloads the page so the next SSR render picks up the new preference. The switcher is keyboard-operable (Tab + Enter/Space), has a translated accessible name, and meets WCAG 2.2 minimum target size (SC 2.5.8).
- **Full catalog (~400 keys):** all admin UI strings across 12 route pages, 3 dialog components, and 9 client-side editors are extracted into flat dot-namespaced catalogs (`routes/admin/i18n/en.ts` and `routes/admin/i18n/es.ts`). Both catalogs must remain complete — missing or extra keys cause a TypeScript type error.
- **Localised API errors:** user-facing error and validation messages from `api/handlers.ts` are now returned in the active UI language. The API resolves the UI locale from the `cms-ui-locale` cookie on the incoming request (independent of the content-locale axis). The wire shape `{ error: string }` is unchanged — no client update required.
- **Client editors fully localised:** all `cmsToast`, `cmsAlert`, and `cmsConfirm` strings in the 9 browser-side editor modules now use `ct(key)` from `routes/admin/i18n/client.ts`, which reads the SSR-injected locale from the `window` bridge and renders in the correct language without a second detection or any flicker.
- **Spanish-leak guard (`tests/i18n-no-spanish-leak.test.js`):** a new automated test scans all admin source files for hardcoded Spanish string literals (accented characters + Spanish wordlist). It fails if any are found outside the Spanish catalog and explicitly exempted locations (`es.ts`, the copyright header, the language endonym "Español"). Self-tests prove the guard catches planted leaks.
- **Packaging tests (`tests/i18n-dist-packaging.test.js`):** assert that all 7 i18n module files ship in `dist/routes/admin/i18n/`, that `resolveUiLocale` defaults to English, and that the full catalog (≥ 300 keys) is accessible from the built dist.
- **Hard wall preserved:** `getActiveContentLocale`, `normalizeLocaleFromRequest`, the `x-cms-locale` header pipeline, and the content locale topbar selector are untouched. The UI locale cookie (`cms-ui-locale`) uses a key distinct from the content locale storage (`cms-content-locale`) to prevent any collision.

## [3.0.3] - 2026-06-15

### Title

Dependency maintenance

### Changed

- Updated bundled dependencies: `@lucide/astro` to 1.x, `sharp` to 0.35, `jose` to 6.2, `@picocss/pico` to 2.1, `simple-dropzone` to 0.8.3, and `sortablejs` to 1.15.7. No public API or behavior changes — admin icons and responsive image variants render identically. Verified against the full test suite.

### Added

- Internal test and tooling improvements only (no effect on the published runtime): handler integration tests, a Playwright e2e smoke suite, and a coverage badge.

## [3.0.2] - 2026-06-14

### Title

Documentation corrections

### Changed

- README now reflects the stable status and the published version. No functional or API changes from 3.0.1.

## [3.0.1] - 2026-06-14

### Title

Mark the project status as stable

### Changed

- Updated the project status to stable. No functional or API changes from 3.0.0.

## [3.0.0] - 2026-06-14

### Title

Media Management — a media library with responsive images, alt text, captions, and where-used tracking

### Added

- **Media library at `/cms/media`:** upload, browse, search, and manage images from a dedicated admin surface. Drag-and-drop or click to upload; each upload is registered in `data/media.json` as a `MediaEntry` (URL, dimensions, alt, caption defaults, variants, status). Files are stored under `public/uploads/YYYY/MM/`.
- **Upload validation:** uploads are checked for allowed MIME types (JPEG, PNG, WebP, SVG, GIF) and a maximum size before they are written. The size limit defaults to 5 MB and is configurable via the `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` environment variable (value in bytes).
- **Image field picker:** the `image` block field now opens the media library to pick an existing asset instead of pasting a raw URL. Picking an image carries its registry metadata (dimensions, default alt) into the block.
- **Responsive image variants:** raster uploads (JPEG, PNG, WebP) generate WebP and AVIF variants via `sharp` at 480/800/1200/1920 px breakpoints (never upscaling beyond the original width). Generation is asynchronous — the upload returns immediately with `status:'processing'`, transitioning to `'ready'` or `'failed'`. The original is always retained as the `<img>` fallback. SVGs are served as-is with no variants.
- **`<BlockImage>` component** (`@astroblocks/astro-blocks/components/BlockImage`): renders an image field value as a `<picture>` element with AVIF + WebP `<source>` sets and srcset when variants are ready, falling back to a plain `<img>` otherwise. Supports `sizes` and `priority` (eager + `fetchpriority=high` for LCP images). Always emits `alt` (WCAG 1.1.1) and emits `width`/`height` to prevent layout shift (CLS).
- **`getMediaVariants` helper** (`@astroblocks/astro-blocks/getMediaVariants`): reads variant data from `data/media.json` with mtime-keyed caching for advanced rendering. Returns `{ status: 'none', variants: [] }` when the registry is missing — never throws.
- **Alt text (WCAG):** alt text is editable inline in the library and stored per asset as a default. Blocks can override the default per usage. Alt is always rendered, even when empty.
- **Per-image caption:** an optional visible caption can be set per image usage. When present, `<BlockImage>` renders the image inside a `<figure>` with a `<figcaption>`. Distinct from alt (caption is human-facing on the page; alt is for assistive tech/SEO).
- **Width and height capture:** image dimensions are captured at upload time and emitted on render to reserve layout space and reduce CLS.
- **Server-side search, pagination, and metadata:** the media library supports server-side search and pagination, and surfaces per-asset metadata (dimensions, size, variant status) in the UI.
- **Where-used detection:** the library reports where each media asset is referenced across pages and blocks before destructive actions.
- **Same-MIME replace:** an existing asset can be replaced in place by a new file of the same MIME type, preserving its URL and references.
- See [docs/media.md](./docs/media.md) for the full media guide (editor workflow, `ImageFieldValue`/`MediaEntry` shapes, API endpoints, and limitations).

### Changed

- **`image` block field value (BREAKING):** the stored value of an `image` field changed from a plain URL `string` to an `ImageFieldValue` object — `{ url, alt?, caption?, width?, height? }`. This carries alt, caption, and dimensions alongside the URL so images can render accessibly and without layout shift.

  > **Migration:** render image fields with the new `<BlockImage>` component (it accepts both the object and a legacy string and coerces automatically), or destructure `.url` for a plain `<img src>`. Legacy bare-string values stored from earlier versions are coerced to `{ url }` on read — no manual data migration is required.

- **New dependency:** `sharp` is now a runtime dependency, used to generate responsive WebP/AVIF variants on upload.

## [2.0.0] - 2026-04-21

### Title

Global Blocks v2 — schema-driven, locale-aware global blocks with a shared admin field editor

### Added

- **`globalBlocks` config option:** declare slugs bound to a `BlockSchema` — `{ slug, schema, label? }` — in `astro.config.mjs`. The `schema` field is required and must be produced by `defineBlockSchema(..., import.meta.url)`. The plugin validates slug uniqueness, slug format, and `__componentPath` presence at build time; merges global schemas into the shared `componentMap`/`schemaMap`; and emits a thin `globalBlocksRegistry` export (`{ slug, schemaName, componentPath, label }[]`) to `.astro-blocks/runtime.mjs`.
- **`<GlobalBlock slug="...">` component:** renders exactly **one** component instance bound to the declared slug. Loads stored `props` from `data/global-blocks.json`, resolves the active locale from the URL path prefix (with `Astro.currentLocale` as an optional override for consumers that enable Astro's native `i18n`), projects `LocalizedValueMap` values to the requested locale via `localizeBlockPropsForRender`, and renders the schema-bound component. Unknown slug → silent `console.warn` in dev, empty output in production. Declared slug with no stored entry → renders with empty props (no error).
- **Locale-aware REST API:**
  - `GET /cms/api/global-blocks[?locale=xx]` — returns every declared slug with props projected to scalar for the requested locale (or the default locale when none is requested), plus `locale` and `defaultLocale` echo fields.
  - `GET /cms/api/global-blocks/:slug[?locale=xx]` — returns a single entry projected for the requested locale; `404` if the slug is not declared.
  - `PUT /cms/api/global-blocks/:slug` body `{ props, locale? }` — scalar props validated against the schema, then merged into the stored `LocalizedValueMap` for the given locale without disturbing other locales. `404` if the slug is not declared; `400` on missing/invalid `props` or schema violations. All endpoints require JWT auth. No POST/DELETE — slugs are static.
- **Admin UI at `/cms/global-blocks`:** lists declared slugs with resolved labels. Each Edit button opens a **single-block form modal** auto-generated from `schema.items`, using the same field renderers as the page block editor so every field type renders identically across admin surfaces (boolean checkboxes match the "indexable" checkbox in the page form, no size/padding drift). The editor sends scalar values plus the active content locale to the API, preserving non-active locales in storage. No add/remove/reorder UI — exactly one set of props per slug.
- **Shared `block-form.ts` module:** new internal module (`routes/admin/client/block-form.ts`) extracted from `page-editor.ts`. Exports `mountBlockForm()` for mounting a single-block field form into any container — used by both the page block editor and the global-blocks editor. Supports all field types: `string`, `text`, `number`, `boolean`, `select`, `image`, `url`, `array` (primitive and object, sortable). `onArrayLimitReached` callback lets callers route array min/max alerts into their own UI (the page editor wires this to `showAlert`).
- **Storage:** content persisted in `data/global-blocks.json` as `{ globalBlocks: { [slug]: { props, updatedAt? } } }`. Each slug stores one flat props object — not a block list. Localizable fields are stored as `LocalizedValueMap` (e.g. `{ es: 'Hola', en: 'Hello' }`) and projected to scalar per-locale at read time.

### Changed

- **`globalBlocks` config shape (BREAKING):** `{ slug, label }` → `{ slug, schema, label? }`. The `schema` field (a `BlockSchema` from `defineBlockSchema`) is now required.
- **Global block storage shape (BREAKING):** `{ blocks: BlockInstance[] }` → `{ props: Record<string, unknown> }` per slug. One props object per slug, not a list of block instances.
- **`PUT /cms/api/global-blocks/:slug` body (BREAKING):** was `{ blocks: BlockInstance[] }`, now `{ props: Record<string, unknown>, locale?: string }`.
- **`PUT /cms/api/global-blocks/:slug` — unregistered slug:** returns `404` (previously `400`). Consistent with REST semantics and `GET` behaviour.
- **`<GlobalBlock>` rendering:** now renders one component instance (not an iteration over `entry.blocks`). Schema and component are resolved via the `globalBlocksRegistry` emitted at build time.
- **Admin global-blocks editor:** replaced the block-list editor (add/remove/reorder/select-block-type flow) with a thin single-form controller using `mountBlockForm`.

### Breaking

> **Migration from 1.x:**
>
> **Config:** add a `schema` field (from `defineBlockSchema(..., import.meta.url)`) to each `globalBlocks` entry. The legacy `{ slug, label }` shape is rejected at build time.
>
> **Data:** legacy entries (`{ blocks: [...] }`) are tolerated on load and treated as `{ props: {} }`. The first successful `PUT` after upgrading overwrites the entry in the new shape. No manual migration script is required — legacy data is preserved until first save.
>
> **REST clients:** update PUT payloads from `{ blocks: [...] }` to `{ props: {...}, locale?: '...' }`. Send scalar values per locale; the server merges into the stored `LocalizedValueMap`.

## [1.0.0] - 2026-04-15

### Title

Cornerstone — First stable release

### Changed

- First stable release. Versioning moves to stable semver (1.n.m). No more alpha tags on npm.

## [0.14.0-alpha.4] - 2026-03-29

### Title

GitHub releases now forced as latest to mirror npm latest policy

### Changed

- **Release policy alignment:** el workflow de tags marca explícitamente cada GitHub Release como `latest`, igual que la publicación npm deja `latest` apuntando a la versión del tag.
- **Maintainer docs update:** `DEVELOPING.md` documenta que la release de GitHub se publica siempre como latest.

## [0.14.0-alpha.3] - 2026-03-29

### Title

Release workflow hotfix for GitHub release creation context

### Fixed

- **GitHub release job repository context:** el job `create_github_release` ahora define `GH_REPO` para que `gh release` resuelva correctamente el repositorio durante ejecución sin checkout local.

### Changed

- **Release verification iteration:** se mantiene el flujo de release por tag con una nueva versión de verificación para confirmar ejecución completa (validación, publish npm y creación de release).

## [0.14.0-alpha.2] - 2026-03-29

### Title

Automated tag-based releases with npm publish and GitHub Release generation

### Added

- **GitHub Actions workflows for CI and release:** nuevos workflows `.github/workflows/ci-main.yml` (validación en `main`) y `.github/workflows/release-tag.yml` (release al subir tag `v*`).
- **Release notes extraction utility:** nuevo script `scripts/extract-changelog-entry.mjs` para extraer `release_title` y `release_body` desde la entrada versionada del `CHANGELOG.md`.

### Changed

- **Release automation policy:** el flujo de cierre queda separado por evento: `push` a `main` solo valida (`features:validate`, `typecheck`, `test`) y `push` de tag valida metadata de release, publica npm y crea/actualiza la GitHub Release.
- **Mandatory release title in changelog entries:** a partir de esta versión, cada nueva entrada requiere `### Title` con contenido no vacío, usado como título de la release.
- **Environment-protected npm publish:** la publicación npm en el workflow de tags usa el environment `Production` y consume `NPM_TOKEN` como environment secret.
- **Maintainer documentation:** `AGENTS.md` y `DEVELOPING.md` se actualizan para reflejar el flujo automático de releases por tag y el nuevo requisito de `### Title`.

## [0.14.0-alpha.1] - 2026-03-29

### Added

- **Global config parameters module:** nuevo archivo `data/configs.json` con CRUD completo en `/cms/api/configs` para gestionar claves/valores string (`key`, `value`, `description`) desde el CMS.
- **Config parameters admin screen:** nueva pantalla `/cms/configs` con listado compacto, buscador, modal de crear/editar (`DetailModal`) y confirmación antes de eliminar.
- **Runtime helper for consumer code:** nuevo subpath export `@astroblocks/astro-blocks/getConfig` con `getConfig(key)` (lookup case-insensitive) y `getConfigMap()`.
- **Coverage for configs capability:** nuevos tests de handlers (`tests/configs-handlers.test.js`) y helper público (`tests/get-config.test.js`).

### Changed

- **Navigation and docs:** sidebar del admin actualizado con acceso a `Parámetros`; README y AGENTS actualizados para incluir `data/configs.json`, `/cms/configs`, `/cms/api/configs` y el helper `getConfig`.
- **Cache invalidation tags:** se añade `astro-blocks:configs` al set global de tags para invalidación consistente tras cambios de parámetros.
- **README screenshots:** capturas de `img/dashboard.jpg` y `img/page_editor.jpg` regeneradas con `npm run screenshots:readme`.
- **Internal features catalog:** `meta/features.json` incorpora la capacidad de parámetros globales para el sitio informativo.

### Fixed

- **Configs modal UX:** el botón `Cancelar` y el cierre por click en backdrop funcionan de forma consistente en `/cms/configs`.
- **Config key field browser compatibility:** se elimina la validación `pattern` nativa problemática en navegador y se mantiene validación en cliente/servidor.
- **Configs list privacy affordance:** el valor de cada parámetro se muestra enmascarado en el listado (visible solo al editar en modal).

## [0.13.0-alpha.2] - 2026-03-28

### Added

- **Feature manifest for the informational website:** nuevo catálogo interno `meta/features.json` con `schemaVersion`, `id` estable por feature y metadata de versión (`sinceVersion`, `updatedIn`), incluido en el artefacto distribuible como `dist/meta/features.json`.
- **Feature manifest validation tooling:** nuevos scripts `scripts/features-manifest.mjs` y `scripts/validate-features.mjs` con validaciones de estructura, ids únicos, categorías y estados permitidos, y versiones semver-like.
- **Feature manifest build/test coverage:** nuevo comando `npm run features:validate` y nuevo test `tests/features-manifest.test.js` para verificar que el build publica un manifiesto válido.

### Changed

- **Build pipeline:** `scripts/build.mjs` ahora valida el manifiesto de features antes de compilar y copia `meta/` a `dist/`.
- **Maintainer workflow:** se actualizan `DEVELOPING.md` y `AGENTS.md` para incluir revisión/actualización de `meta/features.json` como paso obligatorio en el cierre de versión.
- **Feature history metadata:** ajustes de `sinceVersion` y `updatedIn` en `meta/features.json` para reflejar hitos reales según `CHANGELOG.md`.

## [0.13.0-alpha.1] - 2026-03-28

### Added

- **Native array editing in the page builder:** soporte completo para props `array` dentro del editor de bloques con UX compacta para `array<primitive>` y `array<object>` (añadir, eliminar, reordenar, colapsar/expandir y resumen por fila).
- **Shared array validation path:** nueva validación compartida de bloques/arrays para cliente y backend (`minItems`, `maxItems`, `required` y validación de campos requeridos dentro de `array<object>`), con mensajes de error consistentes en guardado.
- **Playground coverage block for arrays:** nuevo bloque `ContentList` en `playgrounds/basic` con datos de ejemplo localizables para probar arrays primitivos y de objetos en el CMS.

### Changed

- **Schema contract and types:** el contrato tipado de bloques incorpora soporte explícito para `array` y `array<object>`; se añade validación estructural temprana del schema al resolver bloques para detectar definiciones inválidas antes del runtime.
- **Page editor implementation:** el cliente del editor de páginas incorpora estado UI específico por array (fila abierta, paths de error, límites `min/max`) y sincronización de cambios por path estable en `blocksList`.
- **README block schema docs:** se documenta el uso de arrays en schemas de bloque para facilitar adopción de la nueva capacidad.

### Fixed

- **FAQ row action alignment:** corrección de alineación visual en los botones de acción (expandir/eliminar) de filas `array<object>` en el editor de bloques, validada en desktop, tablet y móvil.

## [0.12.0-alpha.3] - 2026-03-27

### Changed

- **Admin default branding alignment:** default site values now use `/favicon.ico` and AstroBlocks brand accents (`#2C53B8` primary, `#0DB8DB` secondary) instead of generic gray fallbacks.
- **Admin head icons:** CMS layout now includes explicit favicon and Apple touch icon links using AstroBlocks assets for more consistent branding across devices.
- **Settings UX defaults:** settings form fallbacks/placeholders and live theme preview now use the same brand defaults, keeping persisted values and runtime preview behavior aligned.

## [0.12.0-alpha.2] - 2026-03-20

### Changed

- **Scoped package identity for npm publishing:** el paquete pasa a distribuirse como `@astroblocks/astro-blocks` (incluyendo `package.json`, lockfile, README y guías de mantenimiento), y el playground consumidor actualiza imports/subpaths al nuevo scope.
- **Release docs for local tarball validation:** se actualizan ejemplos de instalación/desinstalación y nombre de tarball para el paquete scopeado (`astroblocks-astro-blocks-<version>.tgz`).

### Fixed

- **Locale choice persistence on SSR home redirect:** la redirección automática de `/` ahora respeta la preferencia del usuario mediante cookie (`astroblocks-locale`) y evita forzar de nuevo el idioma del navegador durante navegación interna.
- **Coverage for locale redirect behavior:** nuevos tests en localización para preferencia por cookie, navegación same-origin y fallback controlado a `Accept-Language`.

## [0.12.0-alpha.1] - 2026-03-20

### Added

- **Redirects MVP (SSR):** nueva entidad `data/redirects.json`, CRUD completo en `/cms/api/redirects`, pantalla `/cms/redirects` en el admin y resolución pública de redirecciones exactas por path con códigos `301/302`, manteniendo el comportamiento i18n V2 por rutas explícitas.
- **Validación y tests de redirecciones:** utilidades compartidas para normalización/validación de rutas internas (sin URL externa, query ni fragmento), cobertura de tests para handlers y utilidades, e invalidación de caché global al mutar redirecciones.
- **Automatización de capturas del README:** nuevo comando `npm run screenshots:readme` con Playwright para regenerar y sobrescribir `img/dashboard.jpg` y `img/page_editor.jpg` desde el playground.

### Changed

- **Navegación y documentación del panel:** el sidebar incorpora acceso a `/cms/redirects`; README actualizado con `data/redirects.json`, ruta del panel y nota explícita de alcance SSR-only para redirecciones en alpha.
- **Checklist de cierre de versión:** se establece como criterio de release ejecutar `npm run screenshots:readme` cuando una iteración incluya cambios de UI.

## [0.11.0-alpha.3] - 2026-03-19

### Added

- **npm package metadata for Astro listing:** added `description`, `homepage`, `repository`, `bugs`, and `license` fields so AstroBlocks exposes complete metadata for npm consumers and Astro Integrations Library cards.
- **Discovery and categorization keywords:** added package `keywords` including `astro-integration`, `withastro`, and category-friendly tags (`seo`, `tooling`, `utils`) to improve discoverability and listing classification.

## [0.11.0-alpha.2] - 2026-03-19

### Changed

- **Admin visual normalization:** unified border radius and spacing in the CMS admin with a shared token contract (`--cms-radius-base`, `--cms-radius-pill`, `--cms-space-*`) to remove mixed sizing across shell, lists and builders.
- **Design system consistency:** normalized neutral borders and replaced inline spacing/border styles in admin templates and client-rendered markup with reusable classes in `cms-admin.css`.
- **Toolbar controls:** aligned list toolbar controls to the same visual height and sizing rules, including the custom select trigger used by filters.

### Fixed

- **Page editor block actions:** the delete action now matches the same dimensions as toggle and duplicate actions in block cards.

## [0.11.0-alpha.1] - 2026-03-19

### Added

- **Multi-language content model:** nuevo archivo `data/languages.json`, gestión de idiomas de contenido desde `/cms/languages` y soporte para documento único con campos localizables por locale en páginas, bloques y menús.
- **API y helpers públicos para i18n:** nuevo CRUD `/cms/api/languages`, helper `getLanguages()` para leer idiomas configurados desde el proyecto consumidor y helper `getI18nMeta()` para generar `html lang`, `hreflang`, `x-default` y metadatos Open Graph por idioma.
- **Cobertura de tests para i18n:** nuevos tests para localización, helpers públicos, localización estricta en plano público y props de bloques localizables.

### Changed

- **Contrato de bloques:** `PropDef` incorpora `localizable?: boolean` para marcar explícitamente qué campos string/text se traducen por locale.
- **Admin multi idioma:** topbar con selector de idioma de contenido, separación entre idioma de interfaz y de contenido, labels sutiles por locale en todos los campos localizables y edición localizada también en builders de bloques y menús.
- **Routing público:** MVP de rutas localizadas con estrategia `prefix-except-default` sobre path, manteniendo el contrato preparado para extenderse más adelante sin exponer aún subdominio o dominio.
- **Playground y README:** ejemplos actualizados para reflejar la nueva versión, incluyendo layout consumidor con `getI18nMeta()`, uso de `getLanguages()` y menús consumidos por locale.
- **Dashboard y shell del CMS:** el dashboard pasa a mostrar idiomas en lugar de usuarios y se refinan dropdowns, selector de locale y affordances del topbar para encajar mejor con el design system actual.

### Fixed

- **Sin fallback público implícito entre idiomas:** páginas, menús, sitemap, robots y alternates ya no reutilizan silenciosamente el `defaultLocale` cuando falta contenido en el locale solicitado.
- **Detección de idioma del navegador en SSR:** `/` usa `Accept-Language` para redirigir al locale no default cuando existe contenido publicado y ahora añade `Vary: Accept-Language` para evitar respuestas cacheadas incorrectamente.
- **Sincronización del locale activo en el admin:** correcciones en refresco, tablas, labels de formularios, builders y selector del topbar para que el idioma seleccionado se mantenga y se refleje de forma consistente.

## [0.10.0-alpha.1] - 2026-03-18

### Added

- **Block editor section in README:** nueva sección dedicada al editor de bloques como funcionalidad principal del producto, con captura actualizada del `page editor`.
- **Criterios de release y diseño en AGENTS:** reglas explícitas para topbar mínima, sidebar sobrio, toolbars secundarias, dashboard sin bloques redundantes, builders compactos, limpieza de CSS obsoleto y uso de versiones `alpha` con tags de git.

### Changed

- **Rediseño del admin:** shell, dashboard, listados, formularios, botones, topbar, sidebar y tablas se compactan y alinean hacia una dirección visual más SaaS/CMS, sin cambiar contratos públicos ni añadir dependencias.
- **Dashboard:** nueva composición operativa con resumen principal, métricas compactas, acciones rápidas, actividad reciente y card de sitio/branding; se elimina la card redundante de estado del workspace.
- **Listados y toolbars:** barras de búsqueda y filtros pasan a ser elementos secundarios y más discretos; tablas y acciones mantienen mayor densidad visual y mejor legibilidad.
- **Editor de páginas:** tarjetas de bloque y selector de bloques simplificados; se eliminan chips/pseudo-iconos irrelevantes y se refuerza el enfoque builder compacto.
- **Editor de menús:** builder rediseñado con items principales colapsables, submenús inline, apertura más robusta del detalle y menor ruido visual general.
- **Página de caché:** simplificada a una única card operativa con una sola acción principal y menos información redundante.
- **Assets y documentación pública:** `dashboard.png` y `page_editor.png` se convierten a `.jpg`, y la documentación pública pasa a referenciar los nuevos assets.

### Fixed

- **Dropdown de usuario:** correcciones de interacción, z-index, hover/focus y posicionamiento para que funcione de forma consistente en desktop y responsive.
- **Responsive de topbar:** menú hamburguesa visible, estructura móvil más limpia y menor desorden visual en pantallas estrechas.
- **Menú lateral:** restaurado `text-decoration: none` para evitar subrayado accidental en los enlaces de navegación.

## [0.9.0] - 2026-03-18

### Added

- **TypeScript build and typed distribution:** el paquete migra a TypeScript, compila a `dist/` con `tsc` y publica JS + declaraciones tipadas con subpath exports para `astro-blocks`, `astro-blocks/contract` y `astro-blocks/getMenu`.
- **DX de mantenimiento:** nuevo workspace con `playgrounds/basic`, validación local con `npm pack`, scripts dedicados para build, playground y empaquetado, y guía separada en `DEVELOPING.md` y `LOCAL_PACKAGE_TESTING.md`.
- **Render público SSR con cache experimental de Astro:** modo alpha por defecto con invalidación selectiva por path al editar páginas, invalidación global por tags al tocar menús/ajustes y endpoint `POST /cms/api/cache/invalidate`.

### Changed

- **Documentación:** README reescrito para consumidores, imports recomendados documentados y notas claras sobre `experimental.cache.provider`, `memoryCache()` y el comportamiento de la cache en `dev`.
- **Panel del CMS:** la acción de gestión de cache vive en `/cms/cache` y la pantalla interna pasa a `routes/admin/cache.astro`, alineando nombre, ruta y propósito.
- **Admin internals:** scripts inline grandes de páginas y menús extraídos a módulos cliente compartidos, con mejor separación de responsabilidades.

### Removed

- **Rebuild manual del sitio desde el CMS:** se elimina la acción que lanzaba builds del proyecto desde el panel; la pantalla de `/cms/cache` queda dedicada únicamente a invalidación de cache.

## [0.8.0] - 2026-03-16

### Added

- **Editor de bloques (modal de página):** modal casi a pantalla completa con dos columnas: izquierda (pestañas Información y SEO; tab SEO solo visible si la página es indexable), derecha (lista de bloques reordenable). Botón duplicar bloque (icono copia, color azul/índigo sutil) que inserta una copia debajo. Botón expandir con chevron en lugar de +/−. Botón eliminar con icono papelera. Lista de bloques y selector de tipo sin decoración de lista; ítems del selector con borde/sombra tipo card.
- **Pie del modal de página:** botones Guardar (siempre a la derecha), Publicar (verde sutil) y A borrador (ámbar sutil) según estado; campo Estado retirado del formulario. Nuevas páginas en borrador; Publicar/A borrador cambian estado al guardar.
- **API block-schemas en build:** el plugin genera `.astro-blocks/schema-map.mjs` (solo datos, sin imports .astro); el handler GET `/cms/api/block-schemas` carga ese archivo en lugar de `runtime.mjs` para que funcione tras `npm run build` en Node.
- **README:** apartado "Editor de bloques" con descripción del modal y captura `img/page_editor.jpg`. Eliminados `docs/plan-editor-bloques-schema.md` y `docs/plan-final-editor-bloques.md`.

### Changed

- **DetailModal:** prop opcional `large` para modal casi pantalla completa (usado en página). Columnas del modal de página con scroll independiente, divisor entre columnas, scrollbar fina y sutil.
- **Tabs Información/SEO:** estilos de tab sin borde/outline en focus; solo borde inferior en tab activo. Focus de inputs más sutil (ring 1px en lugar de 3px).
- **Hint no indexable:** margen ajustado para no solaparse con el checkbox; clase `cms-field-indexable` con margen inferior.

### Fixed

- **Editar página no funcionaba:** el script inline usaba sintaxis TypeScript `(window as any).Sortable`; sustituido por `window['Sortable']` para que el navegador no lanzara SyntaxError y se registraran los listeners.

---

## [0.7.0] - 2026-03-16

### Added

- **Dashboard rediseñado:** nueva estructura en dos columnas (`cms-dashboard-grid`) con fila de métricas compactas (total/publicadas/borradores/menús), bloque de páginas recientes con tabla inline y badge de estado, bloque de acciones rápidas y card con enlace externo al sitio web.
- **Estilos del dashboard (`cms-admin.css`):** nuevas clases `.cms-dashboard`, `.cms-dashboard-stats`, `.cms-dashboard-stat`, `.cms-dashboard-grid`, `.cms-dashboard-left/right`, `.cms-dashboard-block-header`, `.cms-dashboard-block-title`, `.cms-dashboard-block-link`, `.cms-dashboard-recent-table`, `.cms-dashboard-actions`, `.cms-dashboard-action-item`, `.cms-dashboard-site-link`, `.cms-dashboard-external-link`. Layout responsivo: dos columnas en escritorio, columna única reordenada en móvil.

### Changed

- **AGENTS.md §3:** sección "Estilos del panel" expandida con design system completo: 12 subsecciones (principios, reglas de color, `cms-admin.css`, sidebar/topbar, botones, formularios, cards, modales, tablas, dashboard, tips y qué NO hacer). Sustituye el párrafo monolítico anterior.

---

## [0.6.2] - 2026-03-15

### Added

- **Copyright y licencia BSL:** bloque de copyright al inicio de todos los archivos (código, estilos, .md). En .astro, el bloque va al inicio del frontmatter con `/* ... */` para no renderizarse. En .md se usa comentario HTML `<!-- ... -->`. Criterios en AGENTS.md §14: incluir el copy en archivos nuevos y actualizar el año en todos los bloques al cambiar de año.
- **Disclaimer en README:** texto sobre software source-available, uso permitido (proyectos personales, open-source, uso interno) y prohibición de ofrecer AstroBlocks como SaaS o servicio alojado.

---

## [0.6.1] - 2026-03-15

### Added

- **Diálogo de aviso (cmsAlert):** componente `AlertDialog.astro` con el mismo estilo que el de confirmación (overlay + panel centrado); expone `window.cmsAlert({ message, title?, okLabel? })`. Sustitución de todos los `alert()` del panel por cmsAlert (regenerar sitio, ajustes, páginas, menús).
- **Favicon del CMS:** el panel usa el logo de AstroBlocks como favicon (solo en rutas bajo `/cms`).

### Changed

- **AGENTS.md:** criterio de no utilizar nunca `alert()` ni `confirm()` nativos en el panel; usar siempre cmsConfirm y cmsAlert. Estructura del directorio con `AlertDialog.astro`. Criterio para tips informativos (estilo `.cms-menus-info-card`).

---

## [0.6.0] - 2026-03-15

### Added

- **Menús mejorados:** tabla de menús (nombre, selector) con editar y eliminar; modal de detalle con nombre, selector (validado: alfanumérico, guiones, guiones bajos), tabla de ítems con añadir/eliminar, reordenación con Sortable.js, submenús anidados (`children`) con la misma lógica. Validación de ruta obligatoria en cliente y API. API: GET/POST `/cms/api/menus`, PUT/DELETE `/cms/api/menus/:id`. Estructura en `data/menus.json`: `{ "menus": [ { id, name, selector, items } ] }`; ítems con `name`, `path` y opcionalmente `children`. `getMenu(selector)` devuelve ítems con `children` para navegación anidada.
- **Card informativa en página de menús:** texto explicativo con icono de bombilla sobre el uso del selector y `getMenu()` en el sitio (tipografía 8px, maquetación en párrafo).

### Changed

- **Menús:** se elimina la edición en JSON; formato antiguo de `menus.json` sin soporte (criterio de no compatibilidad hacia atrás en AGENTS.md).

---

## [0.5.2] - 2025-03-15

### Added

- **Ruta `/uploads/[...path]`:** endpoint que sirve los archivos de `public/uploads/` para que las imágenes subidas no devuelvan 404 al ser capturadas por la ruta dinámica `/[...slug]`. Inyectado antes del catch-all en el plugin.
- **README:** badge de estado alpha.

### Changed

- **AGENTS.md:** el bump de versión y la entrada en CHANGELOG no se hacen durante el desarrollo; solo al cerrar la versión cuando se pide hacer el commit. En ese momento se actualizan `package.json` y `CHANGELOG.md` y después se ejecuta el commit.

---

## [0.5.1] - 2025-03-15

### Added

- **Prefijo tipo token en subida de imágenes:** el nombre del archivo subido incluye un prefijo aleatorio (8 caracteres hex) para evitar colisiones (ej. `a1b2c3d4-foto.jpg`).
- **Campo imagen SEO con miniatura:** en el formulario de página, el campo imagen muestra una miniatura (80×80) en lugar de la ruta; botones "Subir imagen" / "Cambiar" y "Eliminar" para mantener el valor ordenado.
- **Eliminación de archivo al quitar imagen:** al pulsar "Eliminar" se borra el atributo `seo.image` y, si la URL es del CMS (`/uploads/...`), también se elimina el archivo en disco. Nuevo endpoint `DELETE /cms/api/upload` con body `{ url }`.

---

## [0.5.0] - 2025-03-15

### Added

- **Campos SEO predefinidos:** el formulario de página deja de usar un JSON libre y ofrece campos concretos: Título SEO, Descripción, URL canónica, Imagen (con botón "Subir imagen") y checkbox "Añadir nofollow". Los campos SEO se ocultan cuando la página no es indexable.
- **Indicador de indexable en la tabla de páginas:** columna "Indexable" con círculo verde (indexable) o rojo (no indexable). Estilos `.cms-indexable-dot`, `.cms-indexable-dot--yes`, `.cms-indexable-dot--no` en `cms-admin.css`.
- **Robots.txt:** se añaden líneas `Disallow` para cada página publicada y no indexable (excepto la home, para no bloquear todo el sitio). El sitemap sigue excluyendo páginas no indexables.

### Changed

- **Formulario de página:** reemplazo del textarea "SEO (JSON)" por los campos predefinidos anteriores. En PUT de página, el objeto `seo` enviado se hace merge con el existente para preservar claves extra que el layout pueda usar.
- **page.astro:** si `seo.image` es una URL relativa, se convierte a absoluta con `site.baseUrl` antes de pasarla al Layout (og:image / twitter:image).
- **README:** descripción de SEO ampliada (campos predefinidos, indexable, robots, recomendaciones para el layout: og:, twitter:, nofollow).

---

## [0.4.4] - 2025-03-15

### Added

- **Resolución de CSS con instalación por ruta:** aliases de Vite para `@picocss/pico` y `animate.css` que apuntan al `node_modules` del proyecto consumidor, de modo que el panel del CMS funcione cuando astro-blocks se instala por `file:` (ruta externa al proyecto Astro).

---

## [0.4.3] - 2025-03-15

### Changed

- **README:** badge de versión muestra la versión del proyecto (enlace a CHANGELOG) en lugar de la versión npm. AGENTS.md: convención de badge de versión y actualizar README al hacer bump.

---

## [0.4.2] - 2025-03-15

### Changed

- **README:** estilo moderno para repositorio público: cabecera con logo y badges (npm, Node, Astro), sección Características, tablas para requisitos/opciones/data, configuración rápida y secciones concisas.
- **AGENTS.md:** nueva sección 11 "README y versionado": convenciones para mantener el estilo del README (badges, tablas, estructura) y para actualizar la documentación cuando cambien opciones, rutas o data. Regla obligatoria: en cada cambio del paquete, hacer bump de versión en `package.json` y añadir entrada en `CHANGELOG.md`. Checklist de la sección 9 ampliada con esta regla.

---

## [0.4.1] - 2025-03-15

### Added

- **Logo en el panel:** logo de AstroBlocks (`img/blocks_logo.png`) en el footer del admin, muy pequeño (12px), servido con optimización de Astro (`astro:assets`).
- **Logo en README:** imagen del logo en la cabecera del README del paquete.

### Changed

- **Documentación:** AGENTS.md con estructura actualizada (carpeta `img/`, footer y logo en la descripción del panel; tipo `AstroBlocksOptions`). CHANGELOG con entrada 0.4.1.

---

## [0.4.0] - 2025-03-15

### Added

- **Footer del panel:** pie fijo en el layout del admin con el nombre "AstroBlocks" y el código de versión. El contenido hace scroll entre la topbar y el footer.

### Changed

- **Renombrado a AstroBlocks:** el paquete pasa de `astro-cms` a `astro-blocks`. Directorio del paquete: `lib/astro-blocks`. Alias de runtime: `astro-blocks-runtime`. Variable de entorno: `ASTRO_BLOCKS_PROJECT_ROOT`. Carpeta generada: `.astro-blocks`. Actualizar en proyectos: `package.json`, `astro.config.mjs`, imports (`astro-blocks`, `astro-blocks/contract`, `astro-blocks/getMenu`) y `.gitignore` (`.astro-blocks`).

---

## [0.3.0] - 2025-03-15

### Added

- **Usuarios:** pantalla `/cms/users` para gestionar usuarios (CRUD). Datos en `data/users.json`. API: `GET/POST /cms/api/users`, `PUT/DELETE /cms/api/users/:id`. Primer usuario se crea como propietario; solo propietarios pueden acceder al panel.
- **DetailModal:** componente reutilizable `routes/admin/components/DetailModal.astro` para crear/editar entidades en modal (mismo diseño que formularios). Usado en Páginas y Usuarios.
- **ConfirmDialog:** componente `routes/admin/components/ConfirmDialog.astro` para acciones destructivas. Diálogo centrado con overlay (mismo patrón que el modal de detalle). Expone `window.cmsConfirm(options)` que devuelve `Promise<boolean>`.
- **Eliminar en Páginas:** botón eliminar en la tabla de Páginas con confirmación vía `cmsConfirm` y `DELETE /cms/api/pages/:id`.

### Changed

- **Páginas:** creación y edición se hacen en modal en la misma pantalla de listado (`pages.astro`). Eliminadas las rutas dedicadas `pages-new.astro` y `pages-[id].astro`.
- **Tablas (diseño unificado):** primera columna solo botón editar (lápiz), última columna solo botón eliminar (papelera), alineado a la derecha. Tipografía de celdas a 0.75rem. Botones de acción 1.5rem con iconos 12px; `margin-bottom: 0` para alineación vertical.
- **Badges:** menos padding (0.125rem 0.375rem), `inline-flex` y `vertical-align: middle` para alineación en tablas.
- **Confirmación:** las acciones destructivas usan `cmsConfirm` en lugar de `confirm()` nativo.
- **Documentación:** README raíz del demo y `lib/astro-blocks/README.md` actualizados (Usuarios, diálogos de confirmación). AGENTS.md con ConfirmDialog en la estructura y patrón overlay/panel.

### Removed

- Rutas `routes/admin/pages-new.astro` y `routes/admin/pages-[id].astro`.

---

## [0.2.0] - 2025-03-15

### Added

- **Página Regenerar sitio** (`/cms/rebuild`): nueva entrada en el menú Configuración que lleva a una página con texto explicativo (regeneración de HTML, recursos, sitemap) y botón de confirmación que llama a `POST /cms/api/rebuild`. La acción ya no está en el formulario de edición de página.

### Changed

- **Formularios:** botones de acción siempre abajo a la derecha (no a ancho completo). En formularios con página previa (p. ej. editar página), el botón «Volver» queda abajo a la izquierda.
- **Alineación de botones:** misma altura y alineación para todos los botones (Volver, Guardar, etc.) mediante `height: 2rem`, `inline-flex` y `box-sizing: border-box`. Eliminado borde extra en el botón primario.
- **Diseño más compacto:** menos espaciado en formularios y páginas de detalle (márgenes de `.cms-field`, `.cms-form-actions`, padding de `.cms-card` y `.cms-main`), tipografía de labels e inputs reducida a 0.75rem.
- **Footer de formularios:** separación visual con `border-top` en la línea de botones; reducido el espacio bajo los botones (padding inferior de card y main) para un pie más compacto.
- **Documentación:** README y AGENTS.md actualizados con la estructura del panel (menú Configuración, ruta `/cms/rebuild`), convenciones de formularios y estilos.

### Removed

- Botón «Regenerar sitio» del formulario de edición de página (la acción se realiza desde Configuración → Regenerar sitio).

---

## [0.1.0] - (inicial)

- Panel de administración en `/cms` con Pico CSS, Animate.css, Lucide.
- Gestión de páginas, menús y ajustes del sitio; datos en JSON en `data/`.
- API bajo `/cms/api` (páginas, site, menús, upload, rebuild).
- White-label (colores primario/secundario en Ajustes).
- Autenticación por `CMS_SECRET` y cabecera `x-cms-secret`.
