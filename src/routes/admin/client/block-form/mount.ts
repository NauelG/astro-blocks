/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * mount.ts — mountBlockForm, the single-block field renderer entry point.
 *
 * Interface contract:
 *   mountBlockForm(options) → { destroy() }
 *
 *   options.container   — HTMLElement where fields will be rendered
 *   options.schemaItems — Record<string, PropDef> from the block schema
 *   options.values      — mutable values object (mutated in place on change)
 *   options.onChange    — called whenever any field value changes
 *   options.inlineErrors— Map<errorKey, message> — read once on (re)mount; call remount to reflect changes
 *   options.fieldPrefix — string prefix for generated field IDs (default: 'gb-field')
 *
 * Sortable (for array fields) is initialized inside mountBlockForm and
 * destroyed on destroy(). Sortable lifecycle does NOT leave this module.
 *
 * What this module does NOT do:
 *   - Block-list management (add/remove/reorder blocks)
 *   - Block-level validation orchestration
 *   - Dialog open/close (owned by picker-dialog.ts)
 *   - Fetch / save operations
 *
 * Security note: user-controlled string values reach this module's innerHTML
 * sink pre-escaped by field-renderers.ts, which uses the canonical
 * escapeHtml/escapeAttr pair from utils/html-escape.ts (see that module).
 */

import Sortable, { type SortableEvent } from 'sortablejs';
import type { FileFieldValue, PrimitivePropDef, PropDef } from '../../../../types/index.js';
import { isObjectArrayItemDef } from '../../../../utils/block-validation.js';
import { parseImageValue } from '../../../../utils/image-value.js';
import { checkArrayLimitReached } from './array-limits.js';
import type { ArrayLimitInfo } from './array-limits.js';
import { defaultArrayItemValue, errorKey, parseFieldValue } from './field-helpers.js';
import {
  seedAltInput,
  seedCaptionInput,
  updateFileFieldDom,
  updateImageFieldDom,
} from './field-dom-sync.js';
import { renderArrayField, renderPrimitiveField } from './field-renderers.js';
import { openPickerDialog } from './picker-dialog.js';

// Field-level change context passed as second arg to onChange.
// Callers that don't need it (e.g. global-blocks-editor) may ignore the argument.
export interface FieldChangeInfo {
  propName: string;
  itemIndex?: number;
  fieldName?: string;
}

export interface BlockFormOptions {
  container: HTMLElement;
  schemaItems: Record<string, PropDef>;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>, change?: FieldChangeInfo) => void;
  inlineErrors?: Map<string, string>;
  fieldPrefix?: string;
  /** Restore previously saved open-array-item state across re-mounts. */
  initialOpenArrayItems?: Map<string, number | null>;
  /**
   * Called when an add or delete operation is blocked because the array has
   * reached its maxItems or minItems limit. Optional — if omitted the handler
   * silently returns (original behaviour).
   */
  onArrayLimitReached?: (info: ArrayLimitInfo) => void;
}

export interface BlockFormHandle {
  destroy(): void;
  /** Snapshot of which array item (by propName) is currently expanded. */
  getOpenArrayItems(): Map<string, number | null>;
}

// "File missing" icon — shown when a preview src fails to load (404 / legacy raw path).
const imageMissingIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="m2 2 20 20"/><path d="M10.41 10.41a2 2 0 1 1-2.83-2.83"/><path d="M21 15.5 16.92 11.4a2 2 0 0 0-2.83 0L8 17.5"/></svg>';

/**
 * Mount a single-block form into `container`.
 * Renders all fields from `schemaItems`, wires up value sync + array sortable.
 * Returns a handle with `destroy()` to clean up sortables and event listeners.
 */
export function mountBlockForm(options: BlockFormOptions): BlockFormHandle {
  const {
    container,
    schemaItems,
    values,
    onChange,
    inlineErrors = new Map(),
    fieldPrefix = 'gb-field',
    initialOpenArrayItems,
    onArrayLimitReached,
  } = options;

  const sortables: Sortable[] = [];
  const openArrayItemByKey: Map<string, number | null> = initialOpenArrayItems
    ? new Map(initialOpenArrayItems)
    : new Map();

  function getError(propName: string, itemIndex?: number, fieldName?: string): string {
    const key = errorKey(propName, itemIndex, fieldName);
    const exact = inlineErrors.get(key);
    if (exact) return exact;
    if (fieldName !== undefined) {
      const itemLevel = inlineErrors.get(errorKey(propName, itemIndex));
      if (itemLevel) return itemLevel;
    }
    return '';
  }

  function getArrayValue(propName: string): unknown[] {
    const v = values[propName];
    if (Array.isArray(v)) return v;
    const next: unknown[] = [];
    values[propName] = next;
    return next;
  }

  function render(): void {
    sortables.forEach((s) => {
      s.destroy();
    });
    sortables.length = 0;

    let html = '<div class="cms-stack cms-block-item-fields">';
    for (const [propName, def] of Object.entries(schemaItems)) {
      const value = values[propName];
      if (def.type === 'array') {
        html += renderArrayField(
          propName,
          def,
          value,
          fieldPrefix,
          openArrayItemByKey.get(propName) ?? null,
          getError,
        );
      } else {
        html += renderPrimitiveField(
          propName,
          def as PrimitivePropDef,
          value ?? '',
          fieldPrefix,
          getError(propName),
        );
      }
    }
    html += '</div>';
    // All values passed to escapeHtml() (text content) or escapeAttr() (attribute values)
    // before insertion — consistent with admin UI pattern
    container.innerHTML = html;
    bindEvents();
  }

  function bindEvents(): void {
    // Primitive field inputs (not inside arrays)
    container
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        '[data-prop]:not([data-array-primitive])',
      )
      .forEach((input) => {
        const sync = (): void => {
          const propName = input.dataset.prop;
          if (!propName) return;
          values[propName] = parseFieldValue(input);
          onChange(values, { propName });
        };
        input.addEventListener('input', sync);
        input.addEventListener('change', sync);
      });

    // Array primitive / object field inputs
    container
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        '[data-array-primitive="true"]',
      )
      .forEach((input) => {
        const sync = (): void => {
          const propName = input.dataset.arrayProp;
          const itemIndex = Number.parseInt(input.dataset.arrayItem || '', 10);
          const fieldName = input.dataset.arrayField;
          if (!propName || Number.isNaN(itemIndex)) return;
          const arr = getArrayValue(propName);
          while (arr.length <= itemIndex) arr.push('');
          if (fieldName) {
            const current = arr[itemIndex];
            const obj =
              current && typeof current === 'object' && !Array.isArray(current)
                ? { ...(current as Record<string, unknown>) }
                : {};
            obj[fieldName] = parseFieldValue(input);
            arr[itemIndex] = obj;
          } else {
            arr[itemIndex] = parseFieldValue(input);
          }
          onChange(values, { propName, itemIndex, fieldName: fieldName || undefined });
        };
        input.addEventListener('input', sync);
        input.addEventListener('change', sync);
      });

    // Array add buttons
    container.querySelectorAll<HTMLButtonElement>('[data-array-add="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        if (!propName) return;
        const def = schemaItems[propName];
        if (!def || def.type !== 'array') return;
        const arr = getArrayValue(propName);
        const limitInfo = checkArrayLimitReached(arr.length, def);
        if (limitInfo) {
          if (onArrayLimitReached) onArrayLimitReached({ prop: propName, ...limitInfo });
          return;
        }
        arr.push(defaultArrayItemValue(def));
        if (isObjectArrayItemDef(def.item)) openArrayItemByKey.set(propName, arr.length - 1);
        onChange(values, { propName });
        render();
      });
    });

    // Array delete buttons
    container.querySelectorAll<HTMLButtonElement>('[data-array-delete="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        const itemIndex = Number.parseInt(btn.dataset.arrayItem || '', 10);
        if (!propName || Number.isNaN(itemIndex)) return;
        const def = schemaItems[propName];
        if (!def || def.type !== 'array') return;
        const arr = getArrayValue(propName);
        const limitInfo = checkArrayLimitReached(arr.length, def);
        if (limitInfo?.limit === 'min') {
          if (onArrayLimitReached) onArrayLimitReached({ prop: propName, ...limitInfo });
          return;
        }
        arr.splice(itemIndex, 1);
        const current = openArrayItemByKey.get(propName);
        if (current !== undefined && current !== null) {
          if (current === itemIndex) openArrayItemByKey.set(propName, null);
          if (current > itemIndex) openArrayItemByKey.set(propName, current - 1);
        }
        onChange(values, { propName, itemIndex });
        render();
      });
    });

    // Array object item toggle
    container.querySelectorAll<HTMLButtonElement>('[data-array-toggle="true"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const propName = btn.dataset.arrayProp;
        const itemIndex = Number.parseInt(btn.dataset.arrayItem || '', 10);
        if (!propName || Number.isNaN(itemIndex)) return;
        const current = openArrayItemByKey.get(propName);
        openArrayItemByKey.set(propName, current === itemIndex ? null : itemIndex);
        render();
      });
    });

    // Image field — alt override input: wires changes to update only the alt
    // field in the hidden JSON, leaving url/width/height unchanged.
    container.querySelectorAll<HTMLInputElement>('[data-image-alt-for]').forEach((altInput) => {
      const sync = (): void => {
        const inputId = altInput.dataset.imageAltFor;
        if (!inputId) return;
        const hiddenInput = container.querySelector<HTMLInputElement>(`#${CSS.escape(inputId)}`);
        if (!hiddenInput) return;
        const current = parseImageValue(hiddenInput.value);
        current.alt = altInput.value;
        hiddenInput.value = JSON.stringify(current);
        hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      };
      altInput.addEventListener('input', sync);
      altInput.addEventListener('change', sync);
    });

    // Image field — caption input: wires changes to update only the caption
    // field in the hidden JSON, leaving url/alt/width/height unchanged.
    container
      .querySelectorAll<HTMLInputElement>('[data-image-caption-for]')
      .forEach((captionInput) => {
        const sync = (): void => {
          const inputId = captionInput.dataset.imageCaptionFor;
          if (!inputId) return;
          const hiddenInput = container.querySelector<HTMLInputElement>(`#${CSS.escape(inputId)}`);
          if (!hiddenInput) return;
          const current = parseImageValue(hiddenInput.value);
          current.caption = captionInput.value;
          hiddenInput.value = JSON.stringify(current);
          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        };
        captionInput.addEventListener('input', sync);
        captionInput.addEventListener('change', sync);
      });

    // Image field — "Choose image" button opens the picker dialog
    container.querySelectorAll<HTMLButtonElement>('[data-picker-for]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inputId = btn.dataset.pickerFor;
        if (!inputId) return;
        openPickerDialog(btn, inputId, 'image', []).catch(() => {
          /* no-op */
        });
      });
    });

    // Image field — "Clear" button resets value and restores the empty state in place
    container.querySelectorAll<HTMLButtonElement>('[data-picker-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inputId = btn.dataset.pickerClear;
        if (!inputId) return;
        const hiddenInput = container.querySelector<HTMLInputElement>(`#${CSS.escape(inputId)}`);
        if (hiddenInput) {
          // Set hidden input to empty JSON sentinel; clear alt and caption inputs
          hiddenInput.value = JSON.stringify({ url: '', alt: '', caption: '' });
          updateImageFieldDom(hiddenInput, '');
          seedAltInput(hiddenInput, '');
          seedCaptionInput(hiddenInput, '');
          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    // File field — "Choose file" button opens the picker dialog in file mode
    container.querySelectorAll<HTMLButtonElement>('[data-file-picker-for]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inputId = btn.dataset.filePickerFor;
        if (!inputId) return;
        // Recover effectiveAccept from the data-file-accept attribute (set at render time)
        let effectiveAccept: string[] = [];
        try {
          const raw = btn.dataset.fileAccept ?? '[]';
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) effectiveAccept = parsed as string[];
        } catch {
          /* ignore */
        }
        openPickerDialog(btn, inputId, 'file', effectiveAccept).catch(() => {
          /* no-op */
        });
      });
    });

    // File field — "Clear" button resets value to empty
    container.querySelectorAll<HTMLButtonElement>('[data-file-picker-clear]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inputId = btn.dataset.filePickerClear;
        if (!inputId) return;
        const hiddenInput = container.querySelector<HTMLInputElement>(`#${CSS.escape(inputId)}`);
        if (hiddenInput) {
          const emptyValue: FileFieldValue = { url: '' };
          hiddenInput.value = JSON.stringify(emptyValue);
          updateFileFieldDom(hiddenInput, emptyValue);
          hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
          hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    });

    // Image field — graceful fallback for a failed preview (404 / legacy raw path).
    // Delegated capture-phase 'error' listener (img error events do not bubble):
    // swaps the broken <img> for a "file missing" state so the user never sees
    // the browser's broken-image glyph. No inline JS in HTML attributes.
    container.addEventListener(
      'error',
      (e) => {
        const target = e.target as HTMLElement | null;
        if (!target || !(target instanceof HTMLImageElement)) return;
        if (!target.matches('[data-image-thumb]')) return;
        const wrap = target.closest<HTMLElement>('[data-image-preview]');
        if (!wrap) return;
        wrap.innerHTML = `<span class="cms-image-field-placeholder cms-image-field-placeholder--missing" role="img" aria-label="File missing">${imageMissingIconSvg}</span>`;
      },
      true,
    );

    // Array sortable for reordering items within each array field
    container.querySelectorAll<HTMLElement>('[data-array-list="true"]').forEach((listEl) => {
      if (listEl.dataset.arraySortable === 'false') return;
      const propName = listEl.dataset.arrayProp;
      if (!propName) return;
      const arr = getArrayValue(propName);
      if (arr.length < 2) return;
      const sortable = Sortable.create(listEl, {
        handle: '.cms-array-item-drag',
        ghostClass: 'cms-dragging',
        onEnd(event: SortableEvent) {
          if (
            event.oldIndex === undefined ||
            event.newIndex === undefined ||
            event.oldIndex === event.newIndex
          )
            return;
          const row = arr[event.oldIndex];
          arr.splice(event.oldIndex, 1);
          arr.splice(event.newIndex, 0, row);
          const openRow = openArrayItemByKey.get(propName);
          if (openRow !== undefined && openRow !== null) {
            if (openRow === event.oldIndex) openArrayItemByKey.set(propName, event.newIndex);
            else if (event.oldIndex < openRow && event.newIndex >= openRow)
              openArrayItemByKey.set(propName, openRow - 1);
            else if (event.oldIndex > openRow && event.newIndex <= openRow)
              openArrayItemByKey.set(propName, openRow + 1);
          }
          onChange(values, { propName });
          render();
        },
      });
      sortables.push(sortable);
    });
  }

  // Re-render on locale change (updates locale hints in labels)
  const localeChangeHandler = (): void => {
    render();
  };
  window.addEventListener('cms:content-locale-change', localeChangeHandler);

  render();

  return {
    destroy(): void {
      sortables.forEach((s) => {
        s.destroy();
      });
      sortables.length = 0;
      window.removeEventListener('cms:content-locale-change', localeChangeHandler);
      container.innerHTML = '';
    },
    getOpenArrayItems(): Map<string, number | null> {
      return new Map(openArrayItemByKey);
    },
  };
}
