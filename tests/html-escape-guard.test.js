/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Repo-wide source guard for admin HTML escaping (issue #99, ADR-0022).
 *
 * Discovers its own scope by WALKING src/routes/admin/** for *.ts and *.astro —
 * never a hardcoded file list, because a hardcoded list (the old
 * html-escape-attr-guard.test.js) is how #99 stayed hidden.
 *
 * Three rules:
 *   R1 — escapeHtml() must NOT appear in an attribute-value position (="${escapeHtml(
 *        or ='${escapeHtml(). escapeAttr() is required there; it also encodes ".
 *   R2 — no admin .astro file may write a DYNAMIC HTML sink (innerHTML / outerHTML /
 *        insertAdjacentHTML built from anything other than a static string literal).
 *        Rendering belongs in client/*.ts, which Biome lints and tests can reach.
 *        Astro's `define:vars` forces `is:inline`, cutting the file off from the
 *        module system and thus from the canonical escaper (utils/html-escape.ts).
 *   R3 — any admin file with a DYNAMIC HTML sink MUST import + use the canonical
 *        escaper. This is the rule that catches #99's actual defect: no escaper at all.
 *
 * Why a lexer and not a plain regex: the admin client mixes quoting styles inside a
 * single expression, e.g.  '</div>' + `<div class="x${a ? '' : ' y'}">`  — the quotes
 * INSIDE a template literal make any quote-counting regex hallucinate string
 * boundaries. We strip comments, extract only <script> blocks from .astro, and mask
 * string CONTENTS (preserving delimiters + structure) before applying structural rules.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const ADMIN_DIR = join(ROOT, 'src', 'routes', 'admin');

/**
 * layout.astro still hosts ~600 lines of rendering logic in bundled <script> modules.
 * Its sinks ARE escaped (they can import the canonical pair — they are modules, not
 * is:inline), but the code has not moved to client/ yet.
 * DELETE THIS ENTRY when #106 lands. It exempts layout.astro from R2 ONLY — R1 and R3
 * still bind it, so its sinks must still use the canonical escaper.
 */
const R2_ALLOWLIST = new Set(['src/routes/admin/layout.astro']);

const SINK_HINT =
  'the two-script i18n bridge (see import-export.astro) + the canonical escaper in utils/html-escape.ts';

/** Recursively collect admin *.ts and *.astro source files. */
function collectAdminFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectAdminFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.astro')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip // line and block comments (comments cannot contain live string delimiters). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Extract the concatenated bodies of every <script>…</script> block from an .astro file. */
function extractScripts(src) {
  const blocks = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) blocks.push(m[1]);
  return blocks.join('\n;\n');
}

/**
 * Mask the CONTENTS of every string/template literal with 'X', preserving the
 * delimiters and all surrounding code structure. Inside a template literal, `${`
 * re-enters code (which may contain nested strings), so we track a small stack.
 * The result is safe to scan for structural tokens like `;`, `+`, `innerHTML`.
 */
function maskStrings(src) {
  let out = '';
  const stack = []; // e.g. ['`', '{'] — quote chars and template-expr braces
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const top = stack[stack.length - 1];
    const inString = top === "'" || top === '"' || top === '`';

    if (inString) {
      if (c === '\\') {
        out += 'XX'; // escaped char — mask both, never interpret the next char
        i++;
        continue;
      }
      if (c === top) {
        stack.pop();
        out += c; // closing delimiter kept
        continue;
      }
      if (top === '`' && c === '$' && src[i + 1] === '{') {
        stack.push('{'); // enter template expression (real code again)
        out += '${';
        i++;
        continue;
      }
      out += 'X'; // masked string content
      continue;
    }

    // In real code.
    if (c === "'" || c === '"' || c === '`') {
      stack.push(c);
      out += c;
      continue;
    }
    if (c === '{' && top === '{') {
      stack.push('{'); // nested brace inside a template expression
      out += c;
      continue;
    }
    if (c === '}' && top === '{') {
      stack.pop();
      out += c;
      continue;
    }
    out += c;
  }
  return out;
}

const SINK_RE = /\.(innerHTML|outerHTML)\s*(\+?=)|\.insertAdjacentHTML\s*\(/g;

/**
 * Given masked code, decide whether each sink write is DYNAMIC.
 * A sink is STATIC iff its right-hand side (up to the statement-ending ;) is a
 * single masked string literal and nothing else. Masking guarantees ; cannot hide
 * inside a string, so slicing on ; is reliable.
 */
function hasDynamicSink(masked) {
  const re = new RegExp(SINK_RE.source, 'g');
  for (let m = re.exec(masked); m !== null; m = re.exec(masked)) {
    if (m[0].includes('insertAdjacentHTML')) return true; // always builds markup dynamically
    const semi = masked.indexOf(';', re.lastIndex);
    const rhs = (
      semi === -1 ? masked.slice(re.lastIndex) : masked.slice(re.lastIndex, semi)
    ).trim();
    // Static iff exactly one quoted literal (contents masked to X…), nothing appended.
    const staticLiteral = /^(['"`])X*\1$/.test(rhs);
    if (!staticLiteral) return true;
  }
  return false;
}

const files = collectAdminFiles(ADMIN_DIR).sort();

for (const abs of files) {
  const rel = relative(ROOT, abs).split('\\').join('/');
  const raw = readFileSync(abs, 'utf8');
  const isAstro = rel.endsWith('.astro');
  const code = isAstro ? extractScripts(raw) : raw;
  const stripped = stripComments(code);
  const masked = maskStrings(stripped);

  test(`${rel} — R1: escapeHtml must not appear in an attribute-value position`, () => {
    assert.ok(
      !/="\$\{escapeHtml\(/.test(raw) && !/='\$\{escapeHtml\(/.test(raw),
      `${rel} uses escapeHtml() inside an HTML attribute value (="\${escapeHtml(). ` +
        'Use escapeAttr() — it also encodes double-quotes, preventing attribute breakout.',
    );
  });

  const dynamic = hasDynamicSink(masked);

  if (isAstro) {
    test(`${rel} — R2: .astro must not write a dynamic HTML sink`, () => {
      if (R2_ALLOWLIST.has(rel)) return; // time-boxed exception, see #106
      assert.ok(
        !dynamic,
        `${rel} builds an HTML sink (innerHTML/outerHTML/insertAdjacentHTML) from non-literal ` +
          `data inside a .astro file. Astro's define:vars forces is:inline, so this code cannot ` +
          `reach the canonical escaper and Biome cannot lint it. Move rendering to ` +
          `src/routes/admin/client/*.ts using ${SINK_HINT}.`,
      );
    });
  }

  test(`${rel} — R3: a dynamic HTML sink requires the canonical escaper`, () => {
    if (!dynamic) return;
    const usesCanonical = /\bescape(Html|Attr)\s*\(/.test(raw) && /html-escape/.test(raw);
    assert.ok(
      usesCanonical,
      `${rel} writes a dynamic HTML sink but does not import/use the canonical escaper ` +
        `(escapeHtml/escapeAttr from utils/html-escape.ts). Every API-sourced value reaching an ` +
        `HTML sink must be escaped by context: escapeHtml() for text, escapeAttr() for attributes.`,
    );
  });
}
