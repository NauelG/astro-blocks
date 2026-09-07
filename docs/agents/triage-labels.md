<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## `needs-info` and `ready-for-agent` are mutually exclusive

An issue carries **one** triage role at a time. While it has an open question it carries
`needs-info` **only**; `ready-for-agent` goes back on when the question is answered.

This is not bookkeeping. The frontier query — the thing that answers "what is next" — is
`ready-for-agent` with no open blocker (see the backlog priority chain in
`issue-tracker.md`, and ADR-0040 for why the order lives in edges rather than labels). An
issue carrying both labels **passes that query while being unworkable**: it looks ready and
is not, and nothing in the graph looks wrong. The failure is silent, which is exactly what
makes it expensive — a whole backlog can be unexecutable while every query keeps answering.

**When answering an open question, do both in the same pass:** post the decision as a comment
and remove `needs-info`. A decision that lives only in a comment leaves the issue looking
blocked; a label removed without a recorded decision leaves the next agent guessing.

## Orthogonal labels

This repo also uses category labels that are **not** part of the triage state machine and
coexist with the states above: `refactor`, `security`, `tooling`, plus the GitHub defaults
(`bug`, `enhancement`, `documentation`, …). Triage never adds or removes them.

`P0`–`P3` are orthogonal too, but they are not an execution order. They bucket **how much a
thing matters**, which is a human judgement; four issues labelled `P1` still don't say which
one to pick up first. The executable order is the `blocked_by` chain (ADR-0040). Priority
labels inform how a maintainer wires that chain; they never override it and Triage never
reorders it.
