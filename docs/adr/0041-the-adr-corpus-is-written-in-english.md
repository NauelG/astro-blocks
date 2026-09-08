<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0041 — The ADR corpus is written in English, and translating one does not break its immutability

- **Status:** Accepted — 2026-09-08
- **Date:** 2026-09-08
- **Deciders:** Nauel Gómez
- **Source:** #178

## Context

The corpus drifted across three independent axes, and no rule was ever written down.

| Axis | State before this decision | Switch point |
| --- | --- | --- |
| Body language | 29 English (0001–0029), 11 Spanish (0030–0040) | `0030` |
| Filename slug | English through 0031, Spanish from 0032 | `0032` |
| Section headings | 25 use `Contexto/Decisión/Consecuencias`, 15 use `Context/Decision/Consequences` plus an `Evidence (current repo)` section | scattered |

The two switch points do not coincide: `0030` and `0031` carry an English filename over a Spanish
body. The heading axis is not aligned with either, and `Evidence (current repo)` appears in fifteen
files while `AGENTS.md` documents only three sections.

The failure mode is cumulative rather than acute. No ADR is unreadable today. But every new ADR is
written by copying whichever neighbour the author opened first, so an unstated rule keeps
manufacturing new inconsistency at no cost to anyone. Filenames are the surface people scan, which
is where the drift is most visible and least excusable.

Issue #178 argued for Spanish on the grounds that it is where the corpus converged and that
choosing English would make "19 existing files the exception instead of 13". Measurement does not
support that: by body language the split is 29/11, so English is the majority by a wide margin and
Spanish is the recent minority. The premise of the original recommendation was wrong.

English also matches what the repo already does everywhere else that is not an ADR — code,
comments, tests, commit messages (`AGENTS.md` mandates English commits without exception), and the
`## Contexto`-vs-`## Context` split is the only place the project speaks two languages about the
same artifact.

A second question blocks any retrofit. `AGENTS.md` states that an ADR is **immutable**: if a
decision changes, a new ADR supersedes the old one. Read literally, that forbids touching the
eleven Spanish bodies at all, and an agent asked to translate them would be violating the repo's
own constitution with no way to tell that the exception was intended.

## Decision

**English is the canonical language of the ADR corpus** — filename slug, title, section headings,
header keys, and body prose.

The canonical shape is:

- Filename `docs/adr/NNNN-english-slug.md`, four digits, single series.
- Title `# NNNN — <decision>`.
- Header keys `- **Status:**`, `- **Date:**` (both parsed by `scripts/adr-index.mjs`), plus
  `- **Deciders:**` and `- **Source:**`.
- Sections `## Context` / `## Decision` / `## Consequences`.

**Immutability protects the decision, not the prose that carries it.** Translating an ADR, renaming
its file, or normalising its headings preserves the decision unchanged and is therefore permitted
without superseding it. What immutability forbids is unchanged: altering what was decided, or why.
That still requires a new ADR and a `Superseded by` status on the old one.

`## Evidence (current repo)` is **retired**. It records the state of the code at authoring time,
which is exactly the ephemeral context `AGENTS.md` routes to "discard" — it ages into a false
statement about a repo that has moved on. The fifteen files carrying it drop the section; anything
in it that is genuinely load-bearing for the decision moves into `## Context`.

## Consequences

- The retrofit is mechanical and bounded: 9 filenames, 11 bodies (1014 lines), 25 heading sets, 15
  `Evidence` sections, and 2 hand-written cross-references (`0037` cites `0036`;
  `docs/specs/media-uploads.md` cites `0038`). Tracked as #178.
- `docs/DECISIONS.md` needs no manual edit. `scripts/adr-index.mjs` matches
  `/^(\d{4})-[a-z0-9-]+\.md$/` and reads only the title and the `Status`/`Date` lines, so renaming
  is transparent to it; `npm run adr:index` regenerates the table and `npm run adr:check` gates it
  in CI.
- Git history becomes the only record of the original Spanish prose. That is an accepted cost: the
  decisions themselves are preserved verbatim in meaning, and no ADR is being reversed.
- `AGENTS.md` § *Enrutado de artefactos* is updated to describe the English format. The rest of
  `AGENTS.md` stays in Spanish — this decision governs the ADR corpus, not the repo's working
  documents, which the human reads and writes directly.
- Future ADRs have a rule to copy instead of a neighbour to imitate, which is the actual fix. The
  format half of it could later be enforced by a sibling of `scripts/validate-features.mjs`; that
  is deliberately not part of this decision.
