<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Migrate to Astro 7

One vertical slice. The classic red/green inversion does not apply here — the failing "test" is a
**build**, not an assertion. T1 bumps the dependency and makes the playground build fail; T2–T4 make
it pass. Everything below was already executed once on the `spike/astro7-probe` worktree, so the
failures are known rather than anticipated.

Tests import from `../dist/…`, so every verify step is `npm run build && npm test`.

> **The unit suite cannot see this change.** It never compiles a `.astro` template. During the probe,
> `build`, `typecheck` and all 1285 tests passed **with a template that did not compile**. The gate
> that means something is `npm run build:playground`; the gate that means most is e2e. Do not read a
> green unit run as progress on this change.

## T1 — Version contract (red)

- [x] **File:** `package.json`
  - `peerDependencies.astro`: `^6.0.0` → `^7.0.0`. Single major, no union (ADR-0029 R1).
  - `engines.node`: `>=18.0.0` → `>=22.12.0`. Copied from `astro@7`'s own `engines`, **not** rounded
    to `>=22.0.0` — Astro 7 refuses to start on 22.0–22.11 (ADR-0029 R2).
  - `devDependencies`: `astro` → `^7.1.1`, `@astrojs/node` → `^11.0.2` (lands #91 and #93).
  - Then `npm install` so `package-lock.json` moves with it. Do **not** hand-edit the lock — the
    3.8.0 release nearly shipped with `package.json` and the lock disagreeing.
- [x] **File:** `playgrounds/basic/package.json` — `astro`: `^6.0.5` → `^7.0.0`, `@astrojs/node`:
  `^10.0.5` → `^11.0.0`, then `npm install` again.

  > **Corrected during execution.** This bullet was originally in T3, and T1 claimed the playground
  > would fail on `experimental.cache` without it. It does not: the playground resolves its **own**
  > `astro` from `playgrounds/basic/node_modules` (observed: 6.4.8 after the root moved to 7.1.1), so
  > it is insulated from the root bump and builds green on Astro 6. The version contract is not
  > actually changed until this pin moves, so it belongs here.

- **Verify:** `npm run build && npm test && npm run typecheck` — all green (they cannot see the
  problem). `npm run build:playground` — **fails**, first on the `experimental.cache` config, then
  on `ContentList.astro`. That failure sequence is the point of this task.

## T2 — Cache wiring (green)

- [x] **File:** `src/plugin/index.ts`
  - `:527` — `(config as { experimental?: { cache?: { provider?: unknown } } }).experimental?.cache?.provider`
    → `(config as { cache?: { provider?: unknown } }).cache?.provider`.
  - **No `??` fallback to the experimental path.** `peerDependencies` is `^7.0.0`, so no supported
    consumer can reach it; a dead branch that looks like support is worse than none (`AGENTS.md`
    *Compatibilidad*, ADR-0029 R1).
  - `:632` — warning text: `requires Astro experimental.cache.provider` → `requires Astro
    cache.provider`. It stays a **warning**: the integration still does not configure a provider.
  - Do **not** touch `src/api/backup.ts` — `context.cache.invalidate({ path, tags })` is unchanged in
    Astro 7.
- **Verify:** `npm run build && npm test && npm run typecheck` green. `npm run build:playground` gets
  past the config error and now fails only on the template.

## T3 — Playground (green)

- [x] **File:** `playgrounds/basic/astro.config.mjs` — move `cache` out of `experimental` to
  top-level. The `memoryCache` import from `astro/config` is unchanged.
- [x] **File:** `playgrounds/basic/package.json` — `astro`: `^6.0.5` → `^7.0.0`, `@astrojs/node`:
  `^10.0.5` → `^11.0.0`. The playground pins its own copies; bumping the root does not reach them,
  and without this it silently stays on Astro 6.
- [x] **File:** `playgrounds/basic/src/components/ContentList.astro:26,37` — escape the literal
  angle brackets: `array<string>` → `array&lt;string&gt;`, `array<object>` → `array&lt;object&gt;`.
  Astro 7's Rust compiler parses `<string>` as an unclosed JSX tag. The markup was always invalid;
  only the new compiler says so. **Escape only these two** — do not sweep other templates
  speculatively.
- [x] Do **not** edit `src/**/*.astro`. All 21 shipped templates compile clean on the Rust compiler,
  verified by building. If T3's build says otherwise, that is a real finding — record it here rather
  than fixing it silently.
- **Verify:** `npm run build:playground` — **passes**. This is the task that actually proves the
  migration.

## T4 — Consumer surface

- [x] **File:** `README.md`
  - Four `experimental.cache` samples → top-level `cache`: `:172`, `:365-371`, `:573`, `:688`. The
    prose at `:365` ("does **not** configure Astro's cache provider for you") stays true and stays.
  - Node badge `:22` → `>=22.12`; requirements table `:115` → `22.12+`.
  - Add the **compatibility table** (ADR-0029 R6) — `4.x` ↔ Astro 7.x ↔ Node ≥22.12, `3.x` ↔ Astro
    6.x ↔ Node ≥18.
  - Add a short **3.x → 4.x migration note**: move `cache` / `routeRules` out of `experimental`,
    raise Node, and warn that Astro 7's compiler rejects invalid HTML **in the consumer's own
    templates**. Without that last line it reads as our regression when their build breaks.
  - README stays 100% consumer-facing (`AGENTS.md` *Documentación*) — no probe notes, no worktree.
- [x] **File:** `AGENTS.consumer.md` — *Node.js version requirement* → 22.12.0; *Required Astro
  version (peerDependency)* → Astro 7.0+. Release is blocked while these disagree with
  `package.json`.
- **Verify:** grep for `experimental` in `README.md` returns only the unrelated maturity/feature-flag
  mentions (`:80`, `:82`), not config samples. No `>=18` / `Node 18` left in either file.

## T5 — Full verification

- [x] `npm run build && npm test && npm run typecheck` — 1285/1285.
- [x] `npm run build:playground` — passes.
- [x] `npm run features:validate`.
- [x] `npm run e2e` — **the gate not yet run.** It is the only one that drives the admin in a
  browser against Astro 7, and the compiler failure proved that template-level breakage is invisible
  everywhere else. If it fails, stop and report before touching anything.

  > **Corrected during execution.** This step originally said `npm run test:e2e`, which does not
  > exist — the script is `e2e`. Result: **11/11 passed** against Astro 7.

- [x] Confirm no `[astro-blocks] ... requires Astro cache.provider` warning appears in
  `npm run build:playground`. The playground *does* configure a provider, so a warning here would
  mean T2's new read misses it — this is the check that proves the read, not just that it compiles.
  (The manual `dev:playground` walkthrough originally planned here is subsumed by e2e, which drives
  `/cms` in a real browser.)
- [x] Remove the probe worktree: `git worktree remove …/scratchpad/astro7 --force` and
  `git branch -D spike/astro7-probe`.

## T6 — Commit

- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `feat(deps)!: require Astro 7 and Node 22.12`
- Body: what the issue expected (find or drop the cache API) versus what was true (route caching
  graduated; the read is one line), and what it missed — the Rust compiler rejecting invalid HTML,
  the playground's own pinned deps, and the Node floor. Reference #55, #91, #93, ADR-0029. State
  that the unit suite passed throughout and proved nothing.
- The `!` marks the breaking change; `BREAKING CHANGE:` footer naming both breaks (peer `^7.0.0`,
  Node `>=22.12.0`).
- No version bump, no `CHANGELOG` entry — those happen only when the human asks to close
  (`AGENTS.md` *Versionado*). At close this is **`4.0.0`** with `### Changed` / `### Removed`; the
  entry must lead with the Node floor, since that is what will break most installs.
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.
