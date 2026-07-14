<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0011 — Single canonical context-aware HTML escaper

- **Status:** Draft — proposed (triaged from engram memory, awaiting review)
- **Date:** 2026-07-07
- **Source:** engram observations #1980, #1984

## Context

The admin client code had accumulated three divergent HTML-escaping implementations across `routes/admin/client/*.ts`: a local chained escaper (`escapePickerHtml`, 5-char `& < > " '`, `&` escaped first), a DOM-based escaper in `common.ts` (`document.createElement('div'); div.textContent = value; return div.innerHTML`), and ad-hoc call sites. Consolidating them into one canonical module is only safe if each call site is repointed to the *correct* one of two context-aware functions (text-content vs. attribute-value), because HTML escaping requirements differ by context — an attribute value must escape quotes to prevent attribute breakout; text content between tags does not strictly need to.

The non-obvious part, and the reason this ADR exists rather than being folded silently into a refactor: an earlier pass (memories #1980/#1973) asserted the `common.ts` DOM-based `escapeHtml` was "byte-identical" to the new canonical `escapeHtml`. That claim was independently re-verified and found FALSE. The DOM serializer encodes `& < >` and converts spaces to `&nbsp;`, but does **not** encode `"` or `'` — while the canonical escaper is a 5-character map (`& < > " '`) that does not touch spaces at all. The two are render/security-equivalent (the extra quote-encoding is harmless over-escaping that browsers decode back to the same characters; the dropped `&nbsp;` normalization renders as the same visible character), but they are not byte-identical outputs. Conflating "behaves the same when rendered" with "produces the same string" would have made an incorrect claim load-bearing for a correctness argument (e.g. a byte-identity regression guard), which is exactly the wrong test to write for this migration class.

## Decision

We will maintain exactly one canonical, DOM-free, context-aware HTML-escaping pair in `utils/html-escape.ts` — `escapeHtml(text)` for text-content positions and `escapeAttr(value)` for attribute-value positions, both built on the same single-pass 5-character map (`& < > " '`) — and repoint every admin client call site to it, classified by actual HTML context rather than by prior escaper identity.

Because the two legacy escapers have different equivalence guarantees to the canonical function, we treat them as two distinct migration classes with different verification strength:
- Call sites that used the local chained `escapePickerHtml` are truly byte-identical to the canonical functions once split by context (text → `escapeHtml`, attribute → `escapeAttr`); a byte-identity guard test is valid for these.
- Call sites that used the `common.ts` DOM-based `escapeHtml` are render/security-equivalent, NOT byte-identical, to the canonical `escapeHtml`; tests for these must assert rendering/security equivalence, not byte equality.

Once every call site was repointed and the `common.ts` DOM escaper had zero remaining importers, it and `escapePickerHtml` were deleted rather than kept alongside the canonical module.

## Consequences

- Easier: there is exactly one place (`utils/html-escape.ts`) to reason about or fix HTML-escaping behavior for the admin client; new code has one obvious, documented choice (`escapeHtml` vs `escapeAttr`) instead of three implementations with unclear provenance.
- Harder / watch for: because the DOM-escaper-derived call sites are equivalent but not byte-identical, any future characterization test asserting exact string output on those specific sites would be testing the wrong invariant — equivalence tests for that class should assert rendered/security behavior, not string equality. This distinction is easy to lose track of after the fact once both migration classes look identical in the diff.
- The correction itself (obs #1984) is a useful reminder that a "byte-identical" claim in a prior memory should be re-verified against the actual legacy implementation before being relied on for a subsequent migration step — the DOM-serializer nature of `common.ts`'s escaper was not obvious from its name alone.
- See ADR-0007 and ADR-0008 for other cases in this codebase where the same principle applies: verify the actual mechanism before accepting a plausible-sounding characterization of it.

## Evidence (current repo)

- `utils/html-escape.ts` — exports `escapeHtml(text)` and `escapeAttr(value)` (confirmed both present), built on a shared single-pass `escapeString` over the `HTML_ENTITIES` map for `& < > " '`; header comment documents the text-vs-attribute intent split explicitly.
- `routes/admin/client/block-form.ts`, `configs-editor.ts`, `redirects-editor.ts`, `page-editor.ts`, `media.ts`, `menus-editor.ts` — all import from `utils/html-escape.ts` (confirmed via grep for `from.*html-escape` across `routes/admin/client/*.ts`).
- `routes/admin/client/common.ts` — no longer defines or references `escapeHtml`/`escape` at all; the DOM-based escaper described in the source memory has been removed from this file (consistent with the source's own account of sub-slice 2e deleting it once `block-form.ts`, its only importer, was repointed away in 2d).
- Repo-wide grep for `escapePickerHtml` — the only remaining occurrence is a doc-comment in `utils/html-escape.ts` referencing the legacy name for context; there is no live `escapePickerHtml` function definition or call site left in the codebase.
