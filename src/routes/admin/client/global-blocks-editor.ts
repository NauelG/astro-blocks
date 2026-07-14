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
import { authHeaders, fetchJson, getActiveContentLocale, showToast } from './common.js';
import { ct } from '../i18n/client.js';
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

  /**
   * The server's message, which already names the real fault (ADR-0025 made the API fail
   * loudly with a localized error rather than degrade). Falling back to a generic string only
   * if something non-Error was thrown.
   */
  function failureMessage(error: unknown): string {
    return error instanceof Error && error.message
      ? error.message
      : ct('errors.loadBlockSchemasFailed');
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

    if (modalTitle) modalTitle.textContent = ct('globalBlocks.editTitle', { label });

    // Parallel fetch: stored entry (projected for active locale) + all block schemas.
    //
    // Neither is swallowed. Both endpoints now fail hard when a registry cannot be resolved
    // (ADR-0025), and eating that failure here would put the two lies it exists to prevent
    // back on the screen: an edit form with no fields, or — worse — "schema not found for X"
    // below, which sends the owner hunting for a misconfigured schema that is perfectly fine.
    // The schemas did not fail to CONTAIN this block; they failed to LOAD.
    let entryResponse: GlobalBlockResponse;
    let schemas: SchemaMap;
    try {
      [entryResponse, schemas] = await Promise.all([
        fetchJson<GlobalBlockResponse>(
          `/cms/api/global-blocks/${encodeURIComponent(slug)}${localeQuery()}`,
          { headers: authHeaders(false) },
        ),
        fetchJson<SchemaMap>('/cms/api/block-schemas', { headers: authHeaders(false) }),
      ]);
    } catch (error) {
      setError(failureMessage(error));
      dlg.showModal();
      return;
    }

    if (entryResponse?.locale) currentLocale = entryResponse.locale;

    const entry = entryResponse?.globalBlocks?.[slug];
    const rawProps =
      entry && typeof entry.props === 'object' && entry.props !== null ? entry.props : {};
    values = JSON.parse(JSON.stringify(rawProps));

    // Reachable only when the schemas DID load and genuinely have no row for this block —
    // a real consumer misconfiguration, which is what this message now exclusively means.
    const schema = schemas[schemaName];
    if (!schema?.items) {
      setError(ct('globalBlocks.schemaNotFound', { name: schemaName }));
      dlg.showModal();
      return;
    }

    formHandle = mountBlockForm({
      container,
      schemaItems: schema.items,
      values,
      onChange: () => {
        /* values is mutated in place */
      },
      inlineErrors,
      fieldPrefix: `gb-${slug}`,
    });

    dlg.showModal();
  }

  async function submitEdit(): Promise<void> {
    if (!currentSlug || !currentSchemaName) return;

    inlineErrors.clear();
    setError('');

    // Client-side validation is a courtesy preflight — the server validates too. Swallowing a
    // schema-load failure is safe HERE, and only here, because the write path is loud: the PUT
    // 500s with the real reason if the schema map cannot be resolved (ADR-0025). Skipping the
    // preflight defers to that truth instead of inventing a validation verdict without a schema.
    let schemas: SchemaMap = {};
    try {
      schemas = await fetchJson<SchemaMap>('/cms/api/block-schemas', {
        headers: authHeaders(false),
      });
    } catch {
      // Intentionally silent: submitEdit's own PUT reports it below.
    }
    const schemaForValidation = schemas[currentSchemaName];

    if (schemaForValidation?.items) {
      const issue = validateBlockPropsAgainstSchema(
        schemaForValidation.name || currentSchemaName,
        0,
        schemaForValidation.items as Parameters<typeof validateBlockPropsAgainstSchema>[2],
        values,
      );
      if (issue) {
        if (issue.propName) {
          inlineErrors.set(
            [
              issue.propName,
              issue.itemIndex !== undefined ? String(issue.itemIndex) : '',
              issue.fieldName || '',
            ].join('::'),
            issue.message,
          );
        }
        setError(issue.message);
        // Re-mount to show inline errors
        formHandle?.destroy();
        formHandle = mountBlockForm({
          container,
          schemaItems: schemaForValidation.items as Parameters<
            typeof mountBlockForm
          >[0]['schemaItems'],
          values,
          onChange: () => {
            /* values mutated in place */
          },
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
        showToast(ct('globalBlocks.saved'), 'success', ct('globalBlocks.savedTitle'));
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || ct('pageEditor.saveError'));
      }
    } catch {
      setError(ct('globalBlocks.networkError'));
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
