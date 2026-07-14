<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`docs/CONTEXT.md`** — this repo keeps its context file under `docs/`, **not** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in.
- **`docs/DESIGN.md`** — the admin panel's design system; mandatory for any admin UI work.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── docs/
│   ├── CONTEXT.md          ← mental model, glossary, conventions, gotchas
│   ├── DESIGN.md           ← admin panel design system
│   ├── DECISIONS.md        ← decision index
│   └── adr/                ← architectural decisions (Nygard format, immutable)
│       ├── 0001-….md
│       └── …
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `docs/CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (token-in-header auth) — but worth reopening because…_
