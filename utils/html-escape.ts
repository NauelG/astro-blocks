/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/html-escape.ts
 *
 * The single canonical HTML-escaping pair for the whole codebase.
 * Pure, DOM-free string functions — safe in tests, browser client
 * controllers, server handlers (api/handlers.ts) and Astro frontmatter
 * (same cross-boundary contract as utils/image-value.ts).
 *
 *   - escapeHtml(text)  — value destined for element TEXT CONTENT
 *   - escapeAttr(value) — value destined for an HTML ATTRIBUTE VALUE
 *
 * Both escape the SAME five characters (& < > " '). escapeHtml over-escapes
 * the two quotes relative to the strict text-node minimum; this is intentional
 * and invisible once the browser decodes entities. Identical behavior, distinct
 * names: the name documents intent and lets the source-guard test enforce that
 * only escapeAttr is used inside ="...".
 *
 * Invariant: & is mapped in the SAME single pass as the other four characters.
 * A single-pass replace with a char map cannot double-encode (output is never
 * re-scanned), so the "escape & first" ordering hazard of chained .replace()
 * does not apply.
 */

/** Character -> HTML entity map for the five HTML-significant characters. */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Matches any single HTML-significant character. */
const HTML_SIGNIFICANT = /[&<>"']/g;

/**
 * Shared single-pass escaper. Coerces to string first so it is a safe drop-in
 * for the legacy escapers (escapePickerHtml wrapped its input in String()).
 */
function escape(value: string): string {
  return String(value).replace(HTML_SIGNIFICANT, (char) => HTML_ENTITIES[char] ?? char);
}

/**
 * Escape a user-controlled value for element TEXT CONTENT (between > and <).
 * Encodes & < > " '.
 */
export function escapeHtml(text: string): string {
  return escape(text);
}

/**
 * Escape a user-controlled value for an HTML ATTRIBUTE VALUE (inside ="..." or
 * ='...'). Encodes & < > " ' — the double-quote and apostrophe are the critical
 * characters that prevent attribute breakout.
 */
export function escapeAttr(value: string): string {
  return escape(value);
}
