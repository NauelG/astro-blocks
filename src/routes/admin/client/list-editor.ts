/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * list-editor.ts — the shared controller for the admin list pages (#117, ADR-0035).
 *
 * `createListEditor` owns everything that was copy-pasted per editor: fetch+auth, the render+escape
 * loop, count/empty toggling, edit/delete binding, the delete-confirm, search filtering, and the
 * opt-in `cms:content-locale-change` re-fetch. The per-editor detail modal + form + validate stay in
 * the editor; `onEdit(row)` is the seam.
 *
 * `renderRows` is a PURE function (no `document`, no `fetch`), exported so escaping and structure are
 * node-testable — the coverage the old per-editor `renderTable` closures could only reach through
 * Playwright. It lives in this file, next to the `.innerHTML =` sink it feeds, on purpose: ADR-0022's
 * source guard verifies escaping by a lexical scan of the file that holds the sink, so the escaper
 * use and the sink must be co-located. Splitting the renderer into its own module would move the
 * escaper away from the sink and defeat that guard — the same reason media-tile.ts:26 refused a
 * `set:html` the guard cannot see.
 *
 * The cell model makes escaping structural: a column's cell is a typed descriptor — { text } →
 * escapeHtml, { attr } → escapeAttr, { html: RawHtml } → verbatim — and `RawHtml` is produced ONLY by
 * `raw()`. A plain string cannot reach the sink unescaped (it is a compile error). `raw()` is the
 * single, named, greppable place trusted markup enters: the two icons, and badges whose dynamic text
 * is escaped INSIDE the raw(...).
 */

import { escapeAttr, escapeHtml } from '../../../utils/html-escape.js';
import { authHeaders, fetchJson, fetchOk, showAlert, showConfirm, showToast } from './common.js';

// ─── The pure renderer (node-testable) ───────────────────────────────────────

declare const RAW_BRAND: unique symbol;

/** HTML the caller vouches for. The only value renderRows emits without escaping. */
export type RawHtml = string & { readonly [RAW_BRAND]: true };

/** Brand a trusted string as raw HTML. The audited choke point — grep `raw(` to enumerate every use. */
export function raw(trusted: string): RawHtml {
  return trusted as RawHtml;
}

export type Cell = { text: string } | { attr: string } | { html: RawHtml };

export interface ColumnDef<Row> {
  /** Static class for the data <td>, e.g. 'cms-table-cell-monospace'. */
  cellClass?: string;
  cell: (row: Row) => Cell;
}

export interface RenderLabels {
  editLabel: string;
  deleteLabel: string;
}

const PENCIL_SVG = raw(
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
);
const TRASH_SVG = raw(
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
);

function renderCell(cell: Cell, cellClass?: string): string {
  const cls = cellClass ? ` class="${escapeAttr(cellClass)}"` : '';
  if ('text' in cell) return `<td${cls}>${escapeHtml(cell.text)}</td>`;
  if ('attr' in cell) return `<td${cls}>${escapeAttr(cell.attr)}</td>`;
  // RawHtml — the only unescaped path, and it is a compile-time-branded type.
  return `<td${cls}>${cell.html}</td>`;
}

/**
 * Render the tbody rows. Pure: same inputs → same string. The leading and trailing action cells
 * (edit / delete) carry generic classes (`cms-list-edit` / `cms-list-delete`) so the controller
 * binds them with no per-entity class name. `columns` describes only the data cells; the `.astro`
 * owns the `<thead>`.
 */
export function renderRows<Row>(
  rows: Row[],
  columns: ColumnDef<Row>[],
  rowId: (row: Row) => string,
  labels: RenderLabels,
): string {
  const editLabel = escapeAttr(labels.editLabel);
  const deleteLabel = escapeAttr(labels.deleteLabel);

  return rows
    .map((row) => {
      const id = escapeAttr(rowId(row));
      const edit =
        `<td class="cms-table-actions">` +
        `<button type="button" class="cms-table-btn-edit cms-list-edit" data-id="${id}" aria-label="${editLabel}">${PENCIL_SVG}</button>` +
        `</td>`;
      const del =
        `<td class="cms-table-actions-delete">` +
        `<button type="button" class="cms-table-btn-delete cms-list-delete" data-id="${id}" aria-label="${deleteLabel}">${TRASH_SVG}</button>` +
        `</td>`;
      const cells = columns.map((c) => renderCell(c.cell(row), c.cellClass)).join('');
      return `<tr data-id="${id}">${edit}${cells}${del}</tr>`;
    })
    .join('');
}

// ─── The controller (effectful) ──────────────────────────────────────────────

export interface ListEditorOptions<Row> {
  /** REST collection, e.g. '/cms/api/configs'. */
  endpoint: string;
  /** Key of the array in the GET response, e.g. 'configs' / 'redirects'. */
  responseKey: string;
  tbody: HTMLTableSectionElement;
  rowId: (row: Row) => string;
  columns: ColumnDef<Row>[];
  editLabel: string;
  deleteLabel: string;
  /** Optional pre-render transform, e.g. configs' sort-by-key. Redirects omits it. */
  transform?: (rows: Row[]) => Row[];
  /** Opens the per-editor detail modal for the row. */
  onEdit: (row: Row) => void | Promise<void>;
  /** The delete-confirm copy — the one real difference between the twins ({key} vs {from,to}). */
  confirmDelete: (row: Row) => { message: string; confirmLabel: string };
  deletedToast: string;
  countLabel: (count: number) => string;
  countEl?: HTMLElement | null;
  emptyEl?: HTMLElement | null;
  searchEl?: HTMLInputElement | null;
  /** Search predicate; applied only when both searchEl and filter are present. */
  filter?: (row: Row, query: string) => boolean;
  /** Wire the content-locale re-fetch. Redirects: true; configs: false. */
  localeAware?: boolean;
}

export interface ListEditor<Row> {
  refresh(): Promise<void>;
  getState(): Row[];
}

export function createListEditor<Row>(options: ListEditorOptions<Row>): ListEditor<Row> {
  let state: Row[] = [];

  function visible(): Row[] {
    const query = options.searchEl?.value.trim().toLowerCase() || '';
    if (!query || !options.filter) return state;
    const predicate = options.filter;
    return state.filter((row) => predicate(row, query));
  }

  function bind(): void {
    options.tbody.querySelectorAll<HTMLElement>('.cms-list-edit').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.id || '';
        if (!id) return;
        const row = state.find((entry) => options.rowId(entry) === id);
        if (!row) return;
        Promise.resolve(options.onEdit(row)).catch((error) =>
          showAlert(error instanceof Error ? error.message : String(error)),
        );
      });
    });

    options.tbody.querySelectorAll<HTMLElement>('.cms-list-delete').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = button.dataset.id || '';
        if (!id) return;
        const row = state.find((entry) => options.rowId(entry) === id);
        if (!row) return;

        const { message, confirmLabel } = options.confirmDelete(row);
        const confirmed = await showConfirm(message, confirmLabel);
        if (!confirmed) return;

        try {
          await fetchOk(`${options.endpoint}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: authHeaders(false),
          });
          showToast(options.deletedToast, 'success');
          await refresh();
        } catch (error) {
          await showAlert(error instanceof Error ? error.message : String(error));
        }
      });
    });
  }

  function render(): void {
    const list = visible();
    options.tbody.innerHTML = renderRows(list, options.columns, options.rowId, {
      editLabel: options.editLabel,
      deleteLabel: options.deleteLabel,
    });
    if (options.countEl) options.countEl.textContent = options.countLabel(list.length);
    options.emptyEl?.classList.toggle('cms-hidden', list.length > 0);
    bind();
  }

  async function refresh(): Promise<void> {
    const data = await fetchJson<Record<string, unknown>>(options.endpoint, {
      headers: authHeaders(false),
    });
    const rows = data[options.responseKey];
    const list = Array.isArray(rows) ? (rows as Row[]) : [];
    state = options.transform ? options.transform(list) : list;
    render();
  }

  options.searchEl?.addEventListener('input', render);

  if (options.localeAware) {
    window.addEventListener('cms:content-locale-change', () => {
      refresh().catch(() => {});
    });
  }

  return {
    refresh,
    getState: () => state,
  };
}
