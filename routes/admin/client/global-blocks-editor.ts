/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * global-blocks-editor.ts — Thin single-form controller for the global-blocks admin page.
 *
 * v2 redesign: each declared global-block slug has exactly ONE set of props.
 * There is no block-list, no add/remove/reorder, no block-type selector.
 *
 * Flow:
 *   1. User clicks "Editar" → openEdit(slug, label, schemaName)
 *   2. Parallel fetch: GET /cms/api/global-blocks/:slug + GET /cms/api/block-schemas
 *   3. mountBlockForm() renders schema.items fields into #global-block-form-container
 *   4. User edits → values mutated in place
 *   5. submitEdit() validates client-side + PUT { props: values }
 */

import type { SchemaMap } from '../../../types/index.js';
import { validateBlockPropsAgainstSchema } from '../../../utils/block-validation.js';
import {
  authHeaders,
  fetchJson,
  getActiveContentLocale,
  showToast,
} from './common.js';
import { mountBlockForm, type BlockFormHandle } from './block-form.js';

interface GlobalBlockResponse {
  globalBlocks?: Record<string, { props?: Record<string, unknown>; updatedAt?: string }>;
  locale?: string;
  defaultLocale?: string;
}

export function initGlobalBlocksEditor(): void {
  const dialog = document.getElementById('global-block-detail-modal') as HTMLDialogElement | null;
  const modalTitle = dialog?.querySelector('[data-detail-modal-title]') as HTMLElement | null;
  const form = document.getElementById('global-block-detail-form') as HTMLFormElement | null;
  const cancelBtn = document.getElementById('global-block-cancel-btn') as HTMLButtonElement | null;
  const errorEl = document.getElementById('global-block-error') as HTMLElement | null;
  const formContainer = document.getElementById('global-block-form-container');

  if (!dialog || !formContainer) return;

  // After guard: both are non-null; captured as typed consts for async access
  const dlg = dialog as HTMLDialogElement;
  const container = formContainer as HTMLElement;

  let currentSlug = '';
  let currentSchemaName = '';
  let currentLocale = '';
  let values: Record<string, unknown> = {};
  const inlineErrors = new Map<string, string>();
  let formHandle: BlockFormHandle | null = null;

  function localeQuery(): string {
    const locale = getActiveContentLocale('es');
    return locale ? `?locale=${encodeURIComponent(locale)}` : '';
  }

  function setError(msg: string): void {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.classList.toggle('cms-hidden', !msg);
  }

  async function fetchSchemas(): Promise<SchemaMap> {
    try {
      return await fetchJson<SchemaMap>('/cms/api/block-schemas', { headers: authHeaders(false) });
    } catch {
      return {};
    }
  }

  async function openEdit(slug: string, label: string, schemaName: string): Promise<void> {
    currentSlug = slug;
    currentSchemaName = schemaName;
    currentLocale = getActiveContentLocale('es') || '';
    values = {};
    inlineErrors.clear();
    setError('');
    formHandle?.destroy();
    formHandle = null;

    if (modalTitle) modalTitle.textContent = `Editar: ${label}`;

    // Parallel fetch: stored entry (projected for active locale) + all block schemas
    const [entryResponse, schemas] = await Promise.all([
      fetchJson<GlobalBlockResponse>(
        `/cms/api/global-blocks/${encodeURIComponent(slug)}${localeQuery()}`,
        { headers: authHeaders(false) }
      ).catch(() => ({} as GlobalBlockResponse)),
      fetchSchemas(),
    ]);

    if (entryResponse?.locale) currentLocale = entryResponse.locale;

    const entry = entryResponse?.globalBlocks?.[slug];
    const rawProps = entry && typeof entry.props === 'object' && entry.props !== null
      ? entry.props
      : {};
    values = JSON.parse(JSON.stringify(rawProps));

    const schema = schemas[schemaName];
    if (!schema?.items) {
      setError(`No se encontró el esquema para "${schemaName}". Verificá la configuración.`);
      dlg.showModal();
      return;
    }

    formHandle = mountBlockForm({
      container,
      schemaItems: schema.items,
      values,
      onChange: () => { /* values is mutated in place */ },
      inlineErrors,
      fieldPrefix: `gb-${slug}`,
    });

    dlg.showModal();
  }

  async function submitEdit(): Promise<void> {
    if (!currentSlug || !currentSchemaName) return;

    inlineErrors.clear();
    setError('');

    // Client-side validation (best-effort; server validates too)
    const schemas = await fetchSchemas();
    const schemaForValidation = schemas[currentSchemaName];

    if (schemaForValidation?.items) {
      const issue = validateBlockPropsAgainstSchema(
        schemaForValidation.name || currentSchemaName,
        0,
        schemaForValidation.items as Parameters<typeof validateBlockPropsAgainstSchema>[2],
        values
      );
      if (issue) {
        if (issue.propName) {
          inlineErrors.set(
            [issue.propName, issue.itemIndex !== undefined ? String(issue.itemIndex) : '', issue.fieldName || ''].join('::'),
            issue.message
          );
        }
        setError(issue.message);
        // Re-mount to show inline errors
        formHandle?.destroy();
        formHandle = mountBlockForm({
          container,
          schemaItems: schemaForValidation.items as Parameters<typeof mountBlockForm>[0]['schemaItems'],
          values,
          onChange: () => { /* values mutated in place */ },
          inlineErrors,
          fieldPrefix: `gb-${currentSlug}`,
        });
        return;
      }
    }

    try {
      const res = await fetch(`/cms/api/global-blocks/${encodeURIComponent(currentSlug)}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          props: values,
          locale: currentLocale || getActiveContentLocale('es') || undefined,
        }),
      });

      if (res.ok) {
        formHandle?.destroy();
        formHandle = null;
        dlg.close();
        showToast('Bloque global guardado correctamente.', 'success', 'Bloques globales');
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error || `Error ${res.status} al guardar.`);
      }
    } catch {
      setError('Error de red al guardar. Revisá la conexión.');
    }
  }

  // Bind edit buttons
  document.querySelectorAll<HTMLButtonElement>('.cms-global-block-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slug = btn.dataset.slug || '';
      const label = btn.dataset.label || slug;
      const schemaName = btn.dataset.schemaName || '';
      void openEdit(slug, label, schemaName);
    });
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitEdit();
  });
  cancelBtn?.addEventListener('click', () => {
    formHandle?.destroy();
    formHandle = null;
    dlg.close();
  });
  dialog.addEventListener('cancel', () => {
    formHandle?.destroy();
    formHandle = null;
    dlg.close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dlg) {
      formHandle?.destroy();
      formHandle = null;
      dlg.close();
    }
  });
}
