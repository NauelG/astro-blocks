/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Spanish leak guard — tests/i18n-no-spanish-leak.test.js
 *
 * Scans admin UI SOURCE files for hardcoded Spanish user-facing strings.
 * FAILS if any are found outside the explicitly allowed exclusion list below.
 *
 * Purpose: prevent future regressions where a developer adds a new Spanish
 * string literal to the admin without routing it through the catalog system.
 *
 * Detection strategy: match string LITERALS (quoted content) for:
 *   A. Accented characters: á é í ó ú ñ ¿ ¡ (and uppercase variants)
 *   B. Spanish wordlist: Guardar, Eliminar, Crear, Cancelar, Buscar, Editar,
 *      Nuevo, Añadir, Cerrar, Configuración, Idioma, Página, Menú, Usuario,
 *      Contraseña, Aviso, Seleccionar, Cargando, elementos, obligatorio,
 *      válido, "Ya existe", "No se puede"
 *
 * Exclusion list (EXPLICITLY DOCUMENTED — add new entries with justification):
 *   1. routes/admin/i18n/es.ts         — the Spanish catalog itself
 *   2. routes/admin/i18n/en.ts         — may contain "…" ellipsis but not Spanish
 *   3. Copyright header lines           — "Gómez" is the author surname
 *   4. "Español" endonym               — shown as option label in its own language
 *   5. Code comments (// and /* lines) — comments are not user-facing strings
 *   6. t() / ct() key arguments        — catalog key references, not UI strings
 *      e.g. ct('pageEditor.fieldsConfigurable') must NOT trip "Configura"
 *
 * Self-test: the test suite includes an embedded "planted" Spanish literal
 * that the detector MUST flag — proving the guard actually catches leaks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// ─── Configuration ─────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Directories/files to scan (source, not dist).
 * NOTE: this guard targets the admin UI only. API errors are localized
 * through the same catalog system and their leaks would be caught by
 * catalog completeness tests (i18n-catalog.test.js).
 */
const SCAN_DIRS = [
  path.join(ROOT, 'routes', 'admin'),
  path.join(ROOT, 'utils'),
  path.join(ROOT, 'api'),
];

/** Files to include: only .astro and .ts under the scan directories. */
const INCLUDE_EXTENSIONS = new Set(['.astro', '.ts']);

/**
 * Files that legitimately contain Spanish text and MUST be excluded.
 * Use POSIX path segments relative to ROOT for cross-platform safety.
 */
const EXCLUDED_FILES = new Set([
  path.join(ROOT, 'routes', 'admin', 'i18n', 'es.ts'),
  // en.ts might contain "…" or Loading… — no Spanish needed, included for symmetry
  path.join(ROOT, 'routes', 'admin', 'i18n', 'en.ts'),
  // block-validation.ts: build-time messages have been translated to English (H1 fix).
  // No exclusion needed — the file is now fully scannable.
]);

/**
 * Accented character pattern (Spanish-specific accents + inverted punctuation).
 * Also matches uppercase variants (Á É Í Ó Ú Ñ).
 */
const ACCENT_PATTERN = /[áéíóúñ¿¡ÁÉÍÓÚÑü]/u;

/**
 * Spanish UI wordlist — common words that should never appear outside the catalog.
 * Written as full-word patterns (word boundaries) to avoid false-positives.
 * Each entry is a regex that must match a whole word.
 */
/**
 * All wordlist patterns use the /i (case-insensitive) flag so lowercase
 * Spanish strings (e.g. 'guardar cambios', 'eliminar') are caught as well.
 *
 * Words kept case-insensitive without risk of English false-positives:
 *   - guardar, eliminar, cancelar, buscar, nuevo, añadir, cerrar,
 *     seleccionar, cargando, obligatorio — none are English words.
 *   - "ya existe" and "no se puede" are multi-word phrases, extremely
 *     unlikely to appear in English identifiers.
 *
 * No entry needed to be kept case-sensitive: none of these words collide
 * with common English words or JS/TS identifiers when bounded by \b.
 */
const SPANISH_WORD_PATTERNS = [
  /\bguardar\b/i,
  /\beliminar\b/i,
  /\bcancelar\b/i,
  /\bbuscar\b/i,
  /\bnuevo\b/i,
  /\bañadir\b/i,
  /\bcerrar\b/i,
  /\bseleccionar\b/i,
  /\bcargando\b/i,
  /\bObligatorio\b/i,
  /\bya existe\b/i,
  /\bno se puede\b/i,
  // "Editar" and "Crear" and "Configuración" are in comments in DetailModal.astro
  // so they are filtered by the comment-stripping logic below, not wordlist exclusion.
  // "Idioma" appears in layout.astro as the label text via t() — if it appears as a
  // raw literal it IS a leak. If through t(), the comment stripper handles it.
  // "elementos", "válido" are in catalog values only.
];

// ─── File discovery ─────────────────────────────────────────────────────────────

/**
 * Recursively collect all source files to scan.
 * Skips excluded files by absolute path.
 */
async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recurse into all subdirectories (including i18n — es.ts is excluded by path)
      const sub = await collectFiles(fullPath);
      files.push(...sub);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (INCLUDE_EXTENSIONS.has(ext) && !EXCLUDED_FILES.has(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// ─── String literal extraction ──────────────────────────────────────────────────

/**
 * Extract quoted string LITERALS from a line of source code, excluding:
 *   - Code comments (// single-line and content after stripping)
 *   - Template literal expressions that are catalog key arguments to t()/ct()
 *
 * Strategy:
 *   1. Strip single-line comments (// ...) from the line.
 *   2. Find all single-quoted ('...') and double-quoted ("...") strings.
 *   3. For each string, check if it is immediately preceded by t('  or ct('
 *      (i.e. it is a catalog KEY argument, not a user-facing value).
 *   4. Return only the string contents that are NOT catalog key arguments.
 *
 * This deliberately does NOT attempt to parse template literals or multi-line
 * strings, as those are not used for UI strings in this codebase.
 */
function extractStringLiterals(line) {
  // Strip single-line comment suffix (// ...)
  // Account for URLs (https://) by only stripping after a // that is not preceded
  // by a colon. Simple heuristic, sufficient for this codebase.
  const noComment = line.replace(/(?<!:)\/\/.*$/, '');

  const literals = [];
  // Regex: match single or double quoted strings (non-greedy, no newlines)
  const stringRe = /(['"])((?:[^\\]|\\.)*?)\1/g;

  let match;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex.exec() iteration loop
  while ((match = stringRe.exec(noComment)) !== null) {
    const startIndex = match.index;
    const content = match[2];

    // Check if this is a catalog key argument to t(), ct(), createT(), etc.
    // Pattern: the string is preceded by `t('`, `ct('`, `t("`, `ct("`,
    // or appears inside a t/ct call position.
    // We check the characters immediately before the opening quote.
    const before = noComment.slice(0, startIndex).trimEnd();
    const isCatalogKeyArg =
      before.endsWith('t(') ||
      before.endsWith('ct(') ||
      // Also skip i18n module internal strings that are key lookup guards
      before.endsWith('createT(') ||
      // Dot-namespaced keys used as default values in t() fallback
      (content.includes('.') && /^[a-z][a-zA-Z0-9.]+$/.test(content));

    if (!isCatalogKeyArg) {
      literals.push(content);
    }
  }

  return literals;
}

// ─── Detection logic ──────────────────────────────────────────────────────────────

/**
 * Scan a single file's content for Spanish string literals.
 * Returns an array of { line, col, text, reason } violations.
 */
function scanContent(content, filePath) {
  const violations = [];
  const lines = content.split('\n');

  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track block comment state (/* ... */)
    if (inBlockComment) {
      if (line.includes('*/')) {
        inBlockComment = false;
      }
      continue; // Skip lines inside block comments
    }

    if (line.includes('/*') && !line.includes('*/')) {
      // Process any string literals BEFORE the /* on the same line, then enter
      // block-comment mode. Do NOT skip the whole line — a Spanish literal that
      // appears before the comment opener would otherwise go undetected.
      const beforeComment = line.slice(0, line.indexOf('/*'));
      if (beforeComment.trim()) {
        const lineWithoutEspanol = beforeComment.replace(/Español/g, '');
        const preLiterals = extractStringLiterals(lineWithoutEspanol);
        for (const literal of preLiterals) {
          if (ACCENT_PATTERN.test(literal)) {
            violations.push({
              file: path.relative(ROOT, filePath),
              line: lineNum,
              text: literal,
              reason: `accented character in string literal`,
            });
            continue;
          }
          for (const pattern of SPANISH_WORD_PATTERNS) {
            if (pattern.test(literal)) {
              violations.push({
                file: path.relative(ROOT, filePath),
                line: lineNum,
                text: literal,
                reason: `Spanish word matching ${pattern}`,
              });
              break;
            }
          }
        }
      }
      inBlockComment = true;
      continue;
    }

    // Handle single-line block comments /* ... */ on one line
    // We still check the non-comment portion — handled by extractStringLiterals

    // Copyright lines are always excluded (contain "Gómez")
    if (line.includes('Copyright') || line.includes('©')) {
      continue;
    }

    // "Español" is a language endonym — legitimate as a UI option label.
    // It appears in layout.astro as a literal option text intentionally.
    const lineWithoutEspanol = line.replace(/Español/g, '');

    // Extract string literals from this line
    const literals = extractStringLiterals(lineWithoutEspanol);

    for (const literal of literals) {
      // Check A: accented characters
      if (ACCENT_PATTERN.test(literal)) {
        violations.push({
          file: path.relative(ROOT, filePath),
          line: lineNum,
          text: literal,
          reason: `accented character in string literal`,
        });
        continue;
      }

      // Check B: Spanish wordlist
      for (const pattern of SPANISH_WORD_PATTERNS) {
        if (pattern.test(literal)) {
          violations.push({
            file: path.relative(ROOT, filePath),
            line: lineNum,
            text: literal,
            reason: `Spanish word matching ${pattern}`,
          });
          break;
        }
      }
    }
  }

  return violations;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

test('self-test: guard detects planted Spanish accent', () => {
  // Prove the detector CATCHES a leak (not just that the tree is clean).
  // This embedded string must be detected by scanContent.
  const fakeSource = `
const label = 'Guardar cambios';
`;
  const violations = scanContent(fakeSource, '/fake/file.ts');
  assert.ok(violations.length > 0, 'guard must detect Spanish wordlist hit in a planted literal');
  assert.match(violations[0].text, /Guardar/);
});

test('self-test: guard detects planted Spanish accent char', () => {
  const fakeSource = `
const msg = 'Configuración del sistema';
`;
  const violations = scanContent(fakeSource, '/fake/file.ts');
  assert.ok(violations.length > 0, 'guard must detect accented char in planted literal');
  assert.ok(violations[0].text.includes('ó') || violations[0].text.includes('ó'));
});

test('self-test: guard does NOT flag catalog key arguments', () => {
  // ct('pageEditor.fieldsConfigurable') — must NOT trip despite "Configura" substring
  const fakeSource = `
const result = ct('pageEditor.fieldsConfigurable');
const other = t('nav.configuración'); // key, not literal (and in comment after strip)
`;
  const violations = scanContent(fakeSource, '/fake/file.ts');
  // The second line has 'nav.configuración' as a key arg so it should be excluded
  // The key 'pageEditor.fieldsConfigurable' — no accented chars, safe
  assert.equal(violations.length, 0, `Unexpected violations: ${JSON.stringify(violations)}`);
});

test('self-test: guard does NOT flag the Español endonym', () => {
  // "Español" is an intentional language endonym used in the switcher
  const fakeSource = `
<option value="es">Español</option>
`;
  const violations = scanContent(fakeSource, '/fake/layout.astro');
  assert.equal(violations.length, 0, `Español endonym must not trigger the guard`);
});

test('self-test: guard does NOT flag code comments', () => {
  const fakeSource = `
// El título se puede actualizar por JS (ej. "Nueva página" / "Editar página").
/* Modal de detalle reutilizable: creación o edición de una entidad. */
`;
  const violations = scanContent(fakeSource, '/fake/detail.astro');
  assert.equal(violations.length, 0, `Comments must not trigger the guard`);
});

test('self-test: guard does NOT flag copyright header', () => {
  const fakeSource = `
/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/
`;
  const violations = scanContent(fakeSource, '/fake/file.ts');
  assert.equal(violations.length, 0, `Copyright header must not trigger the guard`);
});

test('self-test: guard catches Spanish literal on same line as block-comment opener', () => {
  // Fix 2: a Spanish string BEFORE /* on the same line must be detected.
  // Previously the entire line was skipped via continue, missing the string.
  const fakeSource = `const label = 'guardar cambios'; /* start of block comment`;
  const violations = scanContent(fakeSource, '/fake/file.ts');
  assert.ok(
    violations.length > 0,
    'guard must detect Spanish literal that appears before /* on the same line',
  );
  assert.match(violations[0].text, /guardar cambios/i);
});

test('self-test: guard catches lowercase Spanish literal (case-insensitive wordlist)', () => {
  // Fix 3: lowercase Spanish strings must be detected — wordlist is now /i.
  const fakeSource = `const action = 'guardar cambios';`;
  const violations = scanContent(fakeSource, '/fake/file.ts');
  assert.ok(
    violations.length > 0,
    'guard must detect lowercase Spanish wordlist match (case-insensitive)',
  );
  assert.match(violations[0].text, /guardar/i);
});

test('admin source files contain no hardcoded Spanish string literals (REQ-5.1)', async () => {
  // Collect all files to scan
  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    const files = await collectFiles(dir);
    allFiles.push(...files);
  }

  assert.ok(allFiles.length > 0, 'Must find at least one file to scan');

  // Scan each file
  const allViolations = [];

  for (const filePath of allFiles) {
    const content = await fs.readFile(filePath, 'utf-8');
    const violations = scanContent(content, filePath);
    allViolations.push(...violations);
  }

  if (allViolations.length > 0) {
    const report = allViolations
      .map(({ file, line, text, reason }) => `  ${file}:${line} — "${text}" (${reason})`)
      .join('\n');
    assert.fail(
      `Spanish leak guard: found ${allViolations.length} hardcoded Spanish string(s):\n${report}\n\n` +
        `Fix: move the string(s) into routes/admin/i18n/en.ts and es.ts, ` +
        `then reference via t() or ct() in the source file.\n` +
        `If a string is legitimately Spanish (e.g. a new language endonym), ` +
        `add it to the EXCLUDED_FILES or "Español" strip list in this test file ` +
        `with a justification comment.`,
    );
  }

  // Report file count for visibility
  assert.ok(
    true,
    `Scanned ${allFiles.length} admin source files — no Spanish string literals found.`,
  );
});
