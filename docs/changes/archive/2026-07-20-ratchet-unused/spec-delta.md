<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Ratchet the "unused" rules to error

**No change to `docs/specs/`.** This alters what the tooling refuses to accept, not what the product
does. A consumer's installed package behaves identically; the diff is dead code removed and three
lint rules promoted.

**No ADR.** ADR-0013 established the Biome CI gate, the `format --write` over `check --write` rule,
and the fact that warnings are deliberately non-blocking "to keep #41 landable". This change begins
retiring that last provision for three rules — which is the follow-up ADR-0013 anticipated, not a new
decision. Writing ADR-0032 per rule promoted would produce a series of near-identical documents.

**Nothing for `docs/DESIGN.md` either.** The rules are about dead bindings in TypeScript and test
code, not about the panel's appearance.

## What does need to exist somewhere

Two facts, and both belong on the issue rather than in the repo:

**The measured inventory.** #65's description lists top offenders that are stale (`useLiteralKeys` at
"~17"; it is 89, and at *info* severity, not warning). Anyone picking up the next slice needs the
real numbers, and they live where the work is tracked.

**How to measure them.** `biome check` defaults to `--max-diagnostics=20` and truncates **silently** —
it reported 20 of 46 during #95's triage. And parsing the decorated terminal output conflates
warnings with infos, which is how the wrong figures reached that issue twice. `--reporter=json` is
the answer and has always been available. That note saves the next person the same two mistakes.

## Not recorded, deliberately

The per-rule progress table. #65 already tracks the count, and duplicating it in `docs/` creates a
second number to keep in sync — the exact failure mode that put a stale `~77` in ADR-0013 and let me
quote it as current.
