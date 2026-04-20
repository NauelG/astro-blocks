---
name: npm-release
description: Covers the tag-triggered npm release workflow for astro-blocks. Use when asked to "cut a release", "publish npm", "npm publish", "dist-tag", "changelog entry", "extract-changelog-entry", "version bump", "alpha release", "semver", "tag release", or "provenance".
license: MIT
metadata:
  authors: "astro-blocks"
  version: "0.1.0"
---

# npm-release

## Overview

This skill covers the bespoke tag-triggered release workflow for the `@astroblocks/astro-blocks`
package. Releases are driven by pushing a Git tag: the `release-tag.yml` GitHub Actions workflow
validates the tag format, checks it matches `package.json`, extracts the changelog entry via
`scripts/extract-changelog-entry.mjs`, runs tests, publishes to npm with provenance, and creates
a GitHub Release. This skill is the single source of truth for how to author a valid changelog
entry, choose the correct tag format, and confirm dist-tag placement after publish.

---

## Release Types

| Type | Tag format | npm dist-tag |
|------|-----------|--------------|
| Stable | `vX.Y.Z` | `latest` only |
| Pre-release | `vX.Y.Z-alpha.N` | `latest` **and** `alpha` |

**Rules:**
- The `v` prefix is **mandatory** — the tag regex is `^v[0-9]+\.[0-9]+\.[0-9]+(-alpha\.[0-9]+)?$` (workflow line 46).
- The tag version MUST match `package.json#version` exactly (without the `v` prefix). Mismatch → workflow fails.
- Pre-releases get both `latest` and `alpha` dist-tags (see workflow `publish_npm` job, lines 116–138).
- Never publish a stable version with an `-alpha.N` suffix.

---

## Changelog Contract

The `scripts/extract-changelog-entry.mjs` script parses `CHANGELOG.md` to extract the release
title and body. Getting this wrong silently aborts the release job.

### Header format (line 40–43 of the script)

```
## [X.Y.Z] - YYYY-MM-DD
```

- Square brackets around the version are **required**.
- The date separator ` - ` (space-hyphen-space) is **required**.
- The regex is: `^## \[{version}\] - \d{4}-\d{2}-\d{2}\s*$`
- The section ends at the next `## [` header or EOF (script line 57–58).

### `### Title` sub-heading (script lines 68–98)

**This is mandatory.** The extractor looks for a line that matches `/^### Title\s*$/` (case-sensitive, trimmed). If it is missing the script throws:

```
CHANGELOG entry X.Y.Z is missing required '### Title' heading.
```

If the heading exists but has no content after it, the script throws:

```
CHANGELOG entry X.Y.Z has '### Title' but no title content.
```

The title text is all lines between `### Title` and the next `###` or `##` heading, joined with a space and trimmed (script lines 91–94). This becomes the GitHub Release title.

**The `### Title` block must come first in the entry**, before `### Added`, `### Changed`, etc.
Everything else (all non-Title lines) becomes the release body.

### Minimal valid CHANGELOG entry

```markdown
## [1.2.0] - 2026-05-01

### Title

Short, descriptive release title here

### Added

- New feature description.

### Fixed

- Bug fix description.
```

### Common subsection names

`### Added`, `### Changed`, `### Fixed`, `### Removed`, `### Deprecated`, `### Security` —
standard Keep a Changelog conventions. Order is convention; only `### Title` is machine-required.

---

## Dist-Tag Strategy

The workflow (`publish_npm` job) always publishes with `--tag latest --provenance` (line 116), then
applies `alpha` as a second dist-tag if `IS_PRERELEASE=true` (lines 131–138):

```
stable  (IS_PRERELEASE=false):  latest ✓   alpha ✗
alpha   (IS_PRERELEASE=true):   latest ✓   alpha ✓
```

To verify placement after a release:

```sh
npm view @astroblocks/astro-blocks dist-tags
```

---

## Provenance Requirement

`npm publish --provenance` is **mandatory** and handled by the workflow — the `id-token: write`
permission (workflow line 13) enables npm provenance attestation. Never publish this package
manually without `--provenance`. Publishing without it produces an unattested release that cannot
be verified by consumers.

---

## BUSL-1.1 Release Notes Caveats

The package license is **Business Source License 1.1**. Release notes (GitHub Release body, npm
description, changelog entries) MUST NOT contain language that implies:

- The package is open-source.
- The package is free to use commercially without a license.
- The package will remain BUSL-1.1 forever (there is a Change Date after which Apache-2.0 applies).

Safe phrasing: "available under BUSL-1.1". Unsafe: "open-source", "free for everyone", "MIT
licensed".

---

## Pre-Release Checklist (inline)

Work through this checklist before pushing a tag. All items must pass.

- [ ] **Version bump** — update `package.json#version` to the target version (e.g. `1.2.0` or `1.2.0-alpha.1`). Commit: `chore(release): bump version to X.Y.Z[-alpha.N]`.
- [ ] **Changelog entry** — add `## [X.Y.Z] - YYYY-MM-DD` block at the top of `CHANGELOG.md`, with a `### Title` sub-heading and at least one content sub-section. Verify the heading format exactly matches the parser contract above.
- [ ] **Build passes** — run `npm run build` locally and confirm it exits 0. The workflow runs build implicitly via typecheck; a local build catches obvious compile errors before tagging.
- [ ] **Tag created** — `git tag vX.Y.Z[-alpha.N]` (the `v` prefix is required).
- [ ] **Tag pushed** — `git push origin vX.Y.Z[-alpha.N]`. Monitor the `Release Tag` workflow in GitHub Actions.
- [ ] **Workflow passes** — confirm `validate_release` and `publish_npm` jobs both succeed.
- [ ] **Dist-tag confirmed** — run `npm view @astroblocks/astro-blocks dist-tags` and verify `latest` (and `alpha` for pre-releases) point to the new version.

---

## Common Failure Modes

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| `CHANGELOG entry not found for version X.Y.Z` | Missing `## [X.Y.Z]` header, or brackets/date separator wrong | Correct header to `## [X.Y.Z] - YYYY-MM-DD` |
| `missing required '### Title' heading` | No `### Title` block in the entry | Add `### Title` + one line of title content |
| `has '### Title' but no title content` | `### Title` exists but is empty | Add a non-empty title line after `### Title` |
| `Tag '$TAG' does not match expected format` | Tag missing `v` prefix or bad semver | Use `vX.Y.Z` or `vX.Y.Z-alpha.N` |
| `Tag version does not match package.json version` | Tag and `package.json#version` are out of sync | Update `package.json` version before tagging |

---

## Compact Rules

- Tag format is `vX.Y.Z` (stable) or `vX.Y.Z-alpha.N` (pre-release); `v` prefix is mandatory.
- Tag version MUST equal `package.json#version`; mismatch fails the workflow before publishing.
- Every CHANGELOG entry needs `## [X.Y.Z] - YYYY-MM-DD` header — brackets and ` - ` separator are required.
- Every CHANGELOG entry MUST have a `### Title` sub-heading with non-empty content; missing it aborts the release.
- Publish always uses `--provenance`; never publish this package without it.
- Pre-releases get both `latest` and `alpha` dist-tags; stable releases get `latest` only.
- Release notes MUST NOT imply open-source or commercial-free terms; package is BUSL-1.1 licensed.
- **Consumer AGENTS.consumer.md sync (MANDATORY)**: Any PR that changes public API (`package.json#exports`), integration config options, block schema field types (`defineBlockSchema`), auth flow, admin routes, or environment variables MUST update `AGENTS.consumer.md` in the same PR. Reviewer must confirm. Release is blocked if public surface changed but `AGENTS.consumer.md` was not touched.
