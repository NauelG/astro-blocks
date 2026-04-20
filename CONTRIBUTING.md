# Contributing to @astroblocks/astro-blocks

Thank you for contributing! This document covers practical workflows for contributors.

For the full contributor guide — architecture overview, directory structure, TDD discipline, and agent context — read [`AGENTS.md`](./AGENTS.md).

---

## Development Setup

1. Clone the repository and install dependencies:

   ```sh
   git clone https://github.com/NauelG/astro-blocks.git
   cd astro-blocks
   npm install
   ```

2. Build the package:

   ```sh
   npm run build
   ```

3. (Optional) Set up the playground for manual testing:

   ```sh
   npm run prepare:playground
   npm run dev:playground
   ```

---

## Running Tests

```sh
npm test
```

This runs `npm run build` followed by `node --test tests/*.test.js`. All test files in `tests/` are included automatically.

---

## Building

```sh
npm run build
```

The build script (`scripts/build.mjs`) runs tsc, copies static assets (`.astro` routes, styles, images, meta), and adds the `#!/usr/bin/env node` shebang to `dist/plugin/cli/index.js`.

---

## Updating consumer AI context

`AGENTS.consumer.md` is a **consumer-facing** AI context file that ships inside the npm tarball. It is read by AI assistants working in projects that install this package.

Because it is part of the public surface, it must stay in sync with the package API. This is a mandatory PR checklist item — not optional.

### When to update AGENTS.consumer.md

Update `AGENTS.consumer.md` **in the same PR** as any of the following changes:

### What changes require an update

| Trigger | Section in AGENTS.consumer.md most likely to need updating |
|---------|-------------------------------------------------------------|
| Public API (`package.json#exports`) — new, renamed, or removed export path | `## Import Map (all public export paths)` |
| Integration config options (`AstroBlocksOptions`) — new, changed, or removed option | `## Integration Options Reference` |
| Block schema field types (`defineBlockSchema` / `PropType`) — new type, changed behaviour | `## Block Development` → field types table |
| Auth flow changes — new env vars, JWT behaviour, session handling | `## Authentication (admin UI)`, `## Environment Variables Reference` |
| Admin route additions, removals, or renames (`/cms/**`) | `## CMS Admin Routes (plugin-managed, read-only for consumers)` |
| Environment variable additions or deprecations | `## Environment Variables Reference (complete list)` |

### How to verify

After updating `AGENTS.consumer.md`, run the structural test to confirm all required headings and export paths are present:

```sh
npm test
```

The test file `tests/consumer-agents-md.test.js` will fail if:
- A required heading is missing
- A `package.json#exports` key is not mentioned in `AGENTS.consumer.md`
- A `package.json#bin` entry is not mentioned in `AGENTS.consumer.md`

### PR checklist item

Include this in your PR description whenever any of the five trigger categories above applies:

```
- [ ] AGENTS.consumer.md updated to reflect public API/option/route/env var changes
```

---

## Changing the npm-release Skill

The npm-release skill lives in `.claude/skills/npm-release/SKILL.md` and is also mirrored at `.agents/skills/npm-release/SKILL.md` (the two files are kept in sync manually — they are NOT symlinks).

When you modify the compact rules in one file, update the other file with the same change. The `.atl/skill-registry.md` also contains a `### npm-release` compact rules block that must be updated to match.

---

## Release Workflow (summary — see .claude/skills/npm-release/SKILL.md)

Releases are tag-triggered via GitHub Actions. The full workflow is documented in `.claude/skills/npm-release/SKILL.md`. Do not publish to npm manually.

For internal contributor details on architecture, TDD patterns, and agent workflows, see [`AGENTS.md`](./AGENTS.md).

---

## License

BUSL-1.1 — see [`LICENSE`](./LICENSE) for terms.
