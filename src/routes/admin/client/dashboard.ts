/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * dashboard.ts — the dashboard's numbers and recent activity, fetched from the API.
 *
 * index.astro used to compute all of this in its frontmatter, which meant the counts and the five
 * most recently updated pages travelled in HTML served to anyone: the panel's session token lives in
 * a header and sessionStorage, neither of which reaches the server on a page navigation, so that
 * HTML cannot be gated (ADR-0037). The page now ships a shell and this module fills it.
 *
 * No new endpoint: the four existing, already-authenticated ones answer everything the dashboard
 * needs. `fetchJson` THROWS on a non-ok response — deliberately, over `fetchMedia`'s safe default:
 * a dashboard silently rendering zeroes because its token was rejected is exactly the failure that
 * hid broken screenshot tokens for months.
 */

import { escapeHtml } from '../../../utils/html-escape.js';
import { slugToPath } from '../../../utils/slug.js';
import { ct } from '../i18n/client.js';
import { authHeaders, fetchJson, showToast } from './common.js';
import { fetchMedia } from './media-fetch.js';

/**
 * What these endpoints actually return is the DEFAULT-LOCALE VIEW, not the on-disk shape: title,
 * slug, status and indexable arrive as resolved scalars, not LocalizedValueMaps. Typing this against
 * `PagesData` would be wrong in a way tsc cannot catch, since the fields exist under both shapes.
 * Mirrors CmsPage in page-editor.ts, narrowed to what the dashboard reads.
 */
interface DashboardPage {
  title?: string;
  slug?: string | string[];
  status?: string;
  indexable?: boolean;
  updatedAt?: string;
}

const RECENT_LIMIT = 5;

function setText(id: string, value: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

/**
 * The five most recently updated pages, newest first. Ported unchanged from index.astro's
 * frontmatter so the ordering cannot drift from what the dashboard used to show.
 */
function recentPages(pages: DashboardPage[]): DashboardPage[] {
  return [...pages]
    .sort((a, b) => {
      const da = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const db = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return db - da;
    })
    .slice(0, RECENT_LIMIT);
}

/**
 * Render the recent-activity rows.
 *
 * Titles and slugs are owner-authored content, so every interpolation goes through the canonical
 * escaper (ADR-0011, ADR-0022). This module holds the `innerHTML` sink, which is why it imports the
 * escaper directly — the guard checks exactly that.
 */
function renderRecent(pages: DashboardPage[]): void {
  const tbody = document.getElementById('cms-dash-recent-tbody');
  const table = document.getElementById('cms-dash-recent-table');
  const empty = document.getElementById('cms-dash-recent-empty');
  if (!tbody || !table || !empty) return;

  if (pages.length === 0) {
    table.classList.add('cms-hidden');
    empty.classList.remove('cms-hidden');
    tbody.innerHTML = '';
    return;
  }

  empty.classList.add('cms-hidden');
  table.classList.remove('cms-hidden');

  tbody.innerHTML = pages
    .map((page) => {
      const title = escapeHtml(String(page.title || ct('dashboard.noTitle')));
      const slug = escapeHtml(slugToPath(page.slug));
      const isPublished = page.status === 'published';
      const badgeClass = isPublished ? 'cms-badge-success' : 'cms-badge-neutral';
      const badgeText = escapeHtml(ct(isPublished ? 'status.published' : 'status.draft'));
      return (
        '<tr>' +
        `<td class="cms-dashboard-recent-title">${title}</td>` +
        `<td class="cms-table-cell-monospace cms-dashboard-recent-slug">${slug}</td>` +
        `<td class="cms-dashboard-recent-status"><span class="cms-badge ${badgeClass}">${badgeText}</span></td>` +
        '</tr>'
      );
    })
    .join('');
}

export function initDashboard(): void {
  void (async () => {
    try {
      const headers = authHeaders(false);
      const [pagesData, menusData, languagesData, media] = await Promise.all([
        fetchJson<{ pages?: DashboardPage[] }>('/cms/api/pages', { headers }),
        fetchJson<{ menus?: unknown[] }>('/cms/api/menus', { headers }),
        fetchJson<{ languages?: { enabled?: boolean }[] }>('/cms/api/languages', { headers }),
        // Only the envelope's `total` is wanted — ask for one entry, not the library (ADR-0036).
        fetchMedia({ limit: 1 }),
      ]);

      const pages = pagesData.pages || [];
      const languages = languagesData.languages || [];

      // The same derivations index.astro did, moved across so the numbers cannot drift. The API
      // returns the default-locale view, so status/indexable are already resolved scalars here.
      const published = pages.filter((page) => page.status === 'published').length;
      const drafts = pages.filter((page) => page.status === 'draft').length;
      const indexable = pages.filter((page) => page.indexable !== false).length;

      setText('cms-dash-published', String(published));
      setText('cms-dash-drafts', String(drafts));
      setText('cms-dash-menus', String((menusData.menus || []).length));
      setText(
        'cms-dash-languages',
        String(languages.filter((language) => language.enabled !== false).length),
      );
      // The registry's total, not a directory listing. index.astro counted files in the ROOT of the
      // uploads directory, but uploads live under uploads/YYYY/MM — so it always reported 0.
      setText('cms-dash-files', String(media.total));
      setText('cms-dash-indexables', ct('dashboard.indexables', { count: String(indexable) }));

      const recent = recentPages(pages);
      setText(
        'cms-dash-last-edit',
        recent[0]
          ? ct('dashboard.lastEdit', { title: String(recent[0].title || ct('dashboard.noTitle')) })
          : ct('dashboard.noRecentActivity'),
      );
      renderRecent(recent);
    } catch (error) {
      showToast(
        error instanceof Error && error.message ? error.message : ct('errors.loadDashboardFailed'),
        'error',
        ct('dashboard.title'),
      );
    }
  })();
}
