<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0003 — Tag-driven release automation with npm provenance and dist-tag policy

- **Status:** Accepted
- **Date:** 2026-06-29
- **Decisores:** Nauel Gómez
- **Procedencia:** recorded in `docs/DECISIONS.md` when that log was created (v3.1.1) and
  relocated here verbatim.

## Contexto

npm packages require a reliable, auditable release process. Manual `npm publish` is error-prone;
the changelog extraction, tag validation, and provenance attestation need to be automated.

## Decisión

Releases are triggered by pushing a Git tag matching `vX.Y.Z` (stable) or `vX.Y.Z-alpha.N`
(pre-release). The `release-tag.yml` GitHub Actions workflow validates the tag format, checks it
matches `package.json#version`, extracts the changelog entry via
`scripts/extract-changelog-entry.mjs`, runs `npm test`, and publishes with `--provenance`. Stable
releases go to the `latest` dist-tag only; pre-releases go to both `latest` and `alpha`.

## Consecuencias

Tag-driven automation prevents version mismatches and ensures every published artifact has a
corresponding GitHub Release with the changelog body. Provenance attestation links the npm package
to the exact source commit. The `### Title` sub-heading requirement in CHANGELOG entries is
enforced by the extractor script — missing it aborts the release.

The same step also refuses a tag whose release the `README.md` version badge does not match, so a
hand-edited version bump that skips `scripts/sync-readme-version.mjs` cannot reach npm.

Evidence in the repo: `.github/workflows/release-tag.yml`, `scripts/extract-changelog-entry.mjs`,
`.agents/skills/npm-release/SKILL.md`.
