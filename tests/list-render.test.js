/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * The pure list renderer (#117, ADR-0035). renderRows is DOM-free and takes its inputs as arguments,
 * so escaping and structure are node-testable — the coverage the old closure-bound renderTable could
 * only get through Playwright. A plain string cannot reach the sink unescaped; `raw()` is the one
 * typed, intended hole.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { raw, renderRows } from '../dist/routes/admin/client/list-editor.js';

const LABELS = { editLabel: 'Edit', deleteLabel: 'Delete' };
const rowId = (r) => r.id;

// ─── escaping is structural ──────────────────────────────────────────────────

test('a <script> in a text cell is escaped inside its <td>', () => {
  const html = renderRows(
    [{ id: '1', name: '<script>alert(1)</script>' }],
    [{ cell: (r) => ({ text: r.name }) }],
    rowId,
    LABELS,
  );
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not survive');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'script must be html-escaped');
});

test('a rowId containing a quote is attr-escaped in data-id (no attribute breakout)', () => {
  const html = renderRows(
    [{ id: 'a"><img src=x onerror=alert(1)>' }],
    [{ cell: (r) => ({ text: r.id }) }],
    rowId,
    LABELS,
  );
  assert.ok(!html.includes('a"><img'), 'the raw quote+tag must not break out of data-id');
  assert.ok(html.includes('data-id="a&quot;'), 'the quote must be encoded in the attribute');
});

test('an { attr } cell is attr-escaped', () => {
  const html = renderRows(
    [{ id: '1', title: 'x" onmouseover="y' }],
    [{ cell: (r) => ({ attr: r.title }) }],
    rowId,
    LABELS,
  );
  assert.ok(!html.includes('x" onmouseover='), 'attr value must be encoded');
  assert.ok(html.includes('&quot;'), 'the quote must be encoded');
});

// ─── raw() is the one intended, typed hole ───────────────────────────────────

test('a { html: raw(...) } cell is emitted verbatim', () => {
  const html = renderRows(
    [{ id: '1' }],
    [{ cell: () => ({ html: raw('<span class="cms-badge">OK</span>') }) }],
    rowId,
    LABELS,
  );
  assert.ok(html.includes('<span class="cms-badge">OK</span>'), 'raw markup must pass through');
});

// ─── structure ───────────────────────────────────────────────────────────────

test('N rows produce N <tr> with the generic edit/delete action cells', () => {
  const html = renderRows(
    [
      { id: 'a', name: 'one' },
      { id: 'b', name: 'two' },
    ],
    [{ cell: (r) => ({ text: r.name }) }],
    rowId,
    LABELS,
  );
  assert.equal((html.match(/<tr /g) || []).length, 2, 'two rows → two <tr>');
  assert.equal((html.match(/cms-list-edit/g) || []).length, 2, 'an edit action per row');
  assert.equal((html.match(/cms-list-delete/g) || []).length, 2, 'a delete action per row');
  assert.ok(
    html.includes('data-id="a"') && html.includes('data-id="b"'),
    'each row carries its id',
  );
});

test('an empty row list renders the empty string', () => {
  assert.equal(renderRows([], [{ cell: (r) => ({ text: r.id }) }], rowId, LABELS), '');
});

test('cellClass is applied to the data <td>', () => {
  const html = renderRows(
    [{ id: '1', k: 'v' }],
    [{ cellClass: 'cms-table-cell-monospace', cell: (r) => ({ text: r.k }) }],
    rowId,
    LABELS,
  );
  assert.ok(html.includes('class="cms-table-cell-monospace"'), 'cellClass must reach the <td>');
});
