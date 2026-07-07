/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir, getDataPath, getUploadsDir } from '../utils/paths.js';
import { findUrlRefsInProps, type UsageRef } from '../utils/image-url-scan.js';
import {
  normalizeRedirectPath,
  normalizeRedirectStatusCode,
  validateRedirectPathInput,
} from '../utils/redirects.js';
import { pageToSlugParam, slugToPath } from '../utils/slug.js';
import {
  DEFAULT_CONTENT_LANGUAGES,
  getDefaultLanguageCode,
  getLocalizedValue,
  getLocalizedValueForLocale,
  normalizeLanguages,
  normalizeLocaleCode,
  setLocalizedValue,
} from '../utils/localization.js';
import type {
  ConfigEntry,
  ConfigsData,
  ContentLanguage,
  GlobalBlockEntry,
  GlobalBlocksData,
  LanguagesData,
  MediaData,
  MediaEntry,
  MediaVariant,
  Menu,
  MenuItem,
  MenuLocaleView,
  MenusData,
  Page,
  PageLocaleView,
  PageStatus,
  PagesData,
  RedirectRule,
  RedirectsData,
  SeoData,
  Site,
  UsersData,
} from '../types/index.js';

const DEFAULT_GLOBAL_BLOCKS: GlobalBlocksData = { globalBlocks: {} };
const DEFAULT_MEDIA: MediaData = { uploads: [] };
const DEFAULT_PAGES: PagesData = { pages: [] };
const DEFAULT_SITE: Site = {
  siteName: 'My Site',
  baseUrl: 'http://localhost:4321',
  favicon: '/favicon.ico',
  logo: '',
  primaryColor: '#2C53B8',
  secondaryColor: '#0DB8DB',
  seo: {
    defaultTitle: '',
    defaultDescription: '',
  },
  i18n: {
    routingStrategy: 'path-prefix',
  },
};
const DEFAULT_MENUS: MenusData = { menus: [] };
const DEFAULT_REDIRECTS: RedirectsData = { redirects: [] };
const DEFAULT_CONFIGS: ConfigsData = { configs: [] };
const DEFAULT_USERS: UsersData = { users: [] };
const DEFAULT_LANGUAGES: LanguagesData = {
  languages: DEFAULT_CONTENT_LANGUAGES.languages.map((language) => ({ ...language })),
};
const LEGACY_FALLBACK_LOCALE =
  normalizeLocaleCode(DEFAULT_CONTENT_LANGUAGES.languages[0]?.code || 'es') || 'es';

export const MENU_SELECTOR_REGEX = /^[a-zA-Z0-9_-]+$/;

function normalizeMenuItem(item: unknown): MenuItem {
  if (!item || typeof item !== 'object') return { name: '', path: '', children: [] };

  const raw = item as Partial<MenuItem>;
  const children = Array.isArray(raw.children) ? raw.children.map(normalizeMenuItem) : [];

  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    path: typeof raw.path === 'string' ? raw.path : '',
    ...(children.length > 0 ? { children } : {}),
  };
}

function normalizeMenuItemsByLocale(items: unknown): Record<string, MenuItem[]> {
  if (Array.isArray(items)) {
    // legacy safety: treat as default locale payload
    const defaultLocale = DEFAULT_CONTENT_LANGUAGES.languages[0].code;
    return { [defaultLocale]: items.map(normalizeMenuItem) };
  }

  if (!items || typeof items !== 'object') return {};

  const output: Record<string, MenuItem[]> = {};
  for (const [locale, value] of Object.entries(items as Record<string, unknown>)) {
    const normalizedLocale = normalizeLocaleCode(locale);
    if (!normalizedLocale || !Array.isArray(value)) continue;
    output[normalizedLocale] = value.map(normalizeMenuItem);
  }

  return output;
}

function normalizeMenu(menu: unknown, index: number): Menu {
  if (!menu || typeof menu !== 'object') {
    return { id: generateId(), name: '', selector: `menu-${index}`, items: {} };
  }

  const raw = menu as Partial<Menu>;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
    name: typeof raw.name === 'string' ? raw.name : '',
    selector: typeof raw.selector === 'string' ? raw.selector : `menu-${String(index)}`,
    items: normalizeMenuItemsByLocale(raw.items),
  };
}

function normalizeRedirect(entry: unknown): RedirectRule | null {
  if (!entry || typeof entry !== 'object') return null;

  const raw = entry as Partial<RedirectRule>;
  const fromRaw = typeof raw.from === 'string' ? raw.from : '';
  const toRaw = typeof raw.to === 'string' ? raw.to : '';

  if (validateRedirectPathInput(fromRaw, 'from')) return null;
  if (validateRedirectPathInput(toRaw, 'to')) return null;

  const from = normalizeRedirectPath(fromRaw);
  const to = normalizeRedirectPath(toRaw);
  if (!from || !to || from === to) return null;

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
    from,
    to,
    statusCode: normalizeRedirectStatusCode(raw.statusCode),
    enabled: raw.enabled !== false,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

function normalizeConfigEntry(entry: unknown): ConfigEntry | null {
  if (!entry || typeof entry !== 'object') return null;

  const raw = entry as Partial<ConfigEntry>;
  const key = typeof raw.key === 'string' ? raw.key.trim() : '';
  if (!key) return null;

  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  const value =
    typeof raw.value === 'string'
      ? raw.value
      : raw.value === undefined || raw.value === null
        ? ''
        : String(raw.value);

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
    key,
    value,
    ...(description ? { description } : {}),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

function ensurePageStatus(value: unknown): PageStatus {
  return value === 'published' || value === 'archived' || value === 'draft' ? value : 'draft';
}

function normalizeLocalizedMap<T>(
  input: unknown,
  normalizer: (value: unknown) => T | undefined,
): Record<string, T> {
  if (!input || typeof input !== 'object') return {};

  const output: Record<string, T> = {};
  for (const [locale, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedLocale = normalizeLocaleCode(locale);
    if (!normalizedLocale) continue;
    const normalizedValue = normalizer(value);
    if (normalizedValue !== undefined) output[normalizedLocale] = normalizedValue;
  }

  return output;
}

function withLegacyLocale(input: unknown): unknown {
  if (input === undefined) return undefined;
  if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  return { [LEGACY_FALLBACK_LOCALE]: input };
}

function normalizePage(page: unknown): Page | null {
  if (!page || typeof page !== 'object') return null;

  const raw = page as Partial<Page> & Record<string, unknown>;

  const title = normalizeLocalizedMap(withLegacyLocale(raw.title), (value) => {
    if (typeof value !== 'string') return undefined;
    return value;
  });

  const slug = normalizeLocalizedMap(withLegacyLocale(raw.slug), (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(String);
    return undefined;
  });

  const status = normalizeLocalizedMap(withLegacyLocale(raw.status), (value) =>
    ensurePageStatus(value),
  );
  const indexable = normalizeLocalizedMap(withLegacyLocale(raw.indexable), (value) =>
    value === undefined ? undefined : Boolean(value),
  );

  const seoRaw = raw.seo && typeof raw.seo === 'object' ? (raw.seo as Record<string, unknown>) : {};
  const seo = {
    title: normalizeLocalizedMap(withLegacyLocale(seoRaw.title), (value) =>
      typeof value === 'string' ? value : undefined,
    ),
    description: normalizeLocalizedMap(withLegacyLocale(seoRaw.description), (value) =>
      typeof value === 'string' ? value : undefined,
    ),
    canonical: normalizeLocalizedMap(withLegacyLocale(seoRaw.canonical), (value) =>
      typeof value === 'string' ? value : undefined,
    ),
    image: normalizeLocalizedMap(withLegacyLocale(seoRaw.image), (value) =>
      typeof value === 'string' ? value : undefined,
    ),
    nofollow: normalizeLocalizedMap(withLegacyLocale(seoRaw.nofollow), (value) =>
      value === undefined ? undefined : Boolean(value),
    ),
  };

  const publishedAt = normalizeLocalizedMap(withLegacyLocale(raw.publishedAt), (value) => {
    if (value === null) return null;
    if (typeof value === 'string') return value;
    return undefined;
  });

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
    title,
    slug,
    status,
    indexable,
    seo,
    blocks: Array.isArray(raw.blocks)
      ? raw.blocks.map((entry) => ({
          type: String((entry as { type?: unknown }).type || ''),
          props:
            (entry as { props?: Record<string, unknown> }).props &&
            typeof (entry as { props?: unknown }).props === 'object'
              ? ({ ...(entry as { props: Record<string, unknown> }).props } as Record<
                  string,
                  unknown
                >)
              : {},
        }))
      : [],
    publishedAt,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultValue;
    throw error;
  }
}

// Atomic write: serialize to a uniquely-named temp file, then rename into place.
// rename(2) is atomic on POSIX, so a reader never observes a half-written file
// even if multiple writers race on the same path.
async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

// Per-file in-memory mutex. Read-modify-write sequences on the same path run one
// at a time so concurrent appends/deletes/reconcile cannot lose updates.
const fileLocks = new Map<string, Promise<unknown>>();
function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // run fn after prev settles (success or failure)
  fileLocks.set(
    key,
    next.catch(() => {}),
  );
  return next;
}

export async function loadPages(): Promise<PagesData> {
  const data = await readJson(getDataPath('pages.json'), DEFAULT_PAGES);
  const pages = Array.isArray(data.pages)
    ? (data.pages.map(normalizePage).filter(Boolean) as Page[])
    : [];
  return { pages };
}

export async function savePages(pagesData: PagesData): Promise<void> {
  await writeJson(getDataPath('pages.json'), pagesData);
}

export async function loadSite(): Promise<Site> {
  const data = await readJson(getDataPath('site.json'), DEFAULT_SITE);
  return {
    ...DEFAULT_SITE,
    ...data,
    seo: { ...DEFAULT_SITE.seo, ...(data.seo || {}) },
    i18n: { ...DEFAULT_SITE.i18n, ...(data.i18n || {}) },
  };
}

export async function saveSite(siteData: Site): Promise<void> {
  await writeJson(getDataPath('site.json'), siteData);
}

export async function loadMenus(): Promise<MenusData> {
  const data = await readJson(getDataPath('menus.json'), DEFAULT_MENUS);
  if (!data || typeof data !== 'object' || !Array.isArray(data.menus)) return { menus: [] };

  return {
    menus: data.menus.map((menu, index) => normalizeMenu(menu, index)),
  };
}

export async function saveMenus(menusData: MenusData): Promise<void> {
  await writeJson(getDataPath('menus.json'), menusData);
}

export async function loadRedirects(): Promise<RedirectsData> {
  const data = await readJson(getDataPath('redirects.json'), DEFAULT_REDIRECTS);
  if (!data || typeof data !== 'object' || !Array.isArray(data.redirects)) return { redirects: [] };

  return {
    redirects: data.redirects.map(normalizeRedirect).filter(Boolean) as RedirectRule[],
  };
}

export async function saveRedirects(redirectsData: RedirectsData): Promise<void> {
  await writeJson(getDataPath('redirects.json'), redirectsData);
}

export async function loadConfigs(): Promise<ConfigsData> {
  const data = await readJson(getDataPath('configs.json'), DEFAULT_CONFIGS);
  if (!data || typeof data !== 'object' || !Array.isArray(data.configs)) return { configs: [] };

  return {
    configs: data.configs.map(normalizeConfigEntry).filter(Boolean) as ConfigEntry[],
  };
}

export async function saveConfigs(configsData: ConfigsData): Promise<void> {
  await writeJson(getDataPath('configs.json'), configsData);
}

export async function loadLanguages(): Promise<LanguagesData> {
  const data = await readJson(getDataPath('languages.json'), DEFAULT_LANGUAGES);
  return normalizeLanguages(data);
}

export async function saveLanguages(languagesData: LanguagesData): Promise<void> {
  await writeJson(getDataPath('languages.json'), normalizeLanguages(languagesData));
}

export async function loadUsers(): Promise<UsersData> {
  const data = await readJson(getDataPath('users.json'), DEFAULT_USERS);
  return Array.isArray(data.users) ? data : { ...DEFAULT_USERS, users: data.users ?? [] };
}

export async function saveUsers(usersData: UsersData): Promise<void> {
  await writeJson(getDataPath('users.json'), usersData);
}

export async function loadGlobalBlocks(): Promise<GlobalBlocksData> {
  const rawData = await readJson(getDataPath('global-blocks.json'), DEFAULT_GLOBAL_BLOCKS);
  if (!rawData || typeof rawData !== 'object' || typeof rawData.globalBlocks !== 'object') {
    return { globalBlocks: {} };
  }

  // Normalize entries: legacy v1 shape { blocks: [...] } → { props: {} }
  const normalised: Record<string, GlobalBlockEntry> = {};
  for (const [slug, entry] of Object.entries(rawData.globalBlocks as Record<string, unknown>)) {
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      if (e.props !== undefined) {
        // v2 shape — pass through
        normalised[slug] = {
          props: e.props as Record<string, unknown>,
          ...(e.updatedAt !== undefined ? { updatedAt: e.updatedAt as string } : {}),
        };
      } else if (e.blocks !== undefined) {
        // legacy v1 shape — treat as empty props
        normalised[slug] = {
          props: {},
          ...(e.updatedAt !== undefined ? { updatedAt: e.updatedAt as string } : {}),
        };
      } else {
        normalised[slug] = { props: {} };
      }
    } else {
      normalised[slug] = { props: {} };
    }
  }

  return { globalBlocks: normalised };
}

export async function saveGlobalBlock(slug: string, props: Record<string, unknown>): Promise<void> {
  const data = await loadGlobalBlocks();
  const entry: GlobalBlockEntry = {
    props,
    updatedAt: new Date().toISOString(),
  };
  data.globalBlocks[slug] = entry;
  await writeJson(getDataPath('global-blocks.json'), data);
}

export async function saveGlobalBlocks(data: GlobalBlocksData): Promise<void> {
  await writeJson(getDataPath('global-blocks.json'), data);
}

// Re-export UsageRef so callers can import it from data.ts without going to the util.
export type { UsageRef };

/**
 * Find all content locations (page blocks, page seo.image, global blocks) that
 * reference the given upload URL. Read-only — no file lock needed.
 *
 * Returns { count, usages } where count === usages.length (invariant).
 */
export async function findMediaUsages(
  targetUrl: string,
): Promise<{ count: number; usages: UsageRef[] }> {
  const usages: UsageRef[] = [];

  // ── Scan pages ────────────────────────────────────────────────────────────
  const { pages } = await loadPages();
  for (const page of pages) {
    // Derive a human-readable page label from the localized title map
    const titleValues = page.title ? Object.values(page.title) : [];
    const pageLabel = titleValues.find((v) => typeof v === 'string' && v.trim() !== '') ?? page.id;

    // Scan each block's props
    for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex++) {
      const block = page.blocks[blockIndex];
      const refs = findUrlRefsInProps(block.props, targetUrl);
      for (const ref of refs) {
        usages.push({
          source: 'page',
          id: page.id,
          label: String(pageLabel),
          blockIndex,
          propName: ref.propName,
        });
      }
    }

    // Scan seo.image — LocalizedSeoData.image is LocalizedValueMap<string>
    // i.e. { [locale]: string }. We deduplicate: at most one seo ref per page.
    if (page.seo?.image && typeof page.seo.image === 'object') {
      const seoImageMap = page.seo.image as Record<string, unknown>;
      const found = Object.values(seoImageMap).some((v) => v === targetUrl);
      if (found) {
        usages.push({
          source: 'seo',
          id: page.id,
          label: `SEO image of "${String(pageLabel)}"`,
          propName: 'seo.image',
        });
      }
    }
  }

  // ── Scan global blocks ────────────────────────────────────────────────────
  const { globalBlocks } = await loadGlobalBlocks();
  for (const [slug, gb] of Object.entries(globalBlocks)) {
    const refs = findUrlRefsInProps(gb.props, targetUrl);
    for (const ref of refs) {
      usages.push({
        source: 'globalBlock',
        id: slug,
        label: `Global block: ${slug}`,
        propName: ref.propName,
      });
    }
  }

  return { count: usages.length, usages };
}

/**
 * Update a MediaEntry in-place (by id) with new file byte metadata after a
 * replace operation. Runs under the media file lock (ADR-6).
 *
 * Sets status:'processing', variants:[], updates size/width/height.
 * Keeps id, url, filename, mimeType, createdAt unchanged.
 * Returns the updated entry, or null if the id is not found.
 */
export async function replaceMediaEntryBytes(
  id: string,
  patch: { size: number; width?: number; height?: number },
): Promise<{ entry: MediaEntry; oldVariants: MediaVariant[] } | null> {
  return withFileLock(mediaLockKey(), async () => {
    const m = await loadMedia();
    const index = m.uploads.findIndex((e) => e.id === id);
    if (index === -1) return null;
    const existing = m.uploads[index];
    // Capture the current variants UNDER THE LOCK so the returned set is
    // exactly what was live at mutation time. This closes the race where a
    // concurrent regen repopulates variants between a pre-lock snapshot and
    // the actual registry write.
    const oldVariants: MediaVariant[] = existing.variants ?? [];
    const updated: MediaEntry = {
      ...existing,
      size: patch.size,
      ...(patch.width !== undefined && { width: patch.width }),
      ...(patch.height !== undefined && { height: patch.height }),
      status: 'processing',
      variants: [],
    };
    m.uploads[index] = updated;
    await saveMedia(m);
    return { entry: updated, oldVariants };
  });
}

export async function loadMedia(): Promise<MediaData> {
  const raw = await readJson(getDataPath('media.json'), DEFAULT_MEDIA);
  const uploads = Array.isArray(raw.uploads)
    ? raw.uploads.reduce((acc: MediaEntry[], entry: unknown) => {
        if (
          entry !== null &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          typeof (entry as Record<string, unknown>).id === 'string' &&
          typeof (entry as Record<string, unknown>).url === 'string' &&
          typeof (entry as Record<string, unknown>).filename === 'string' &&
          typeof (entry as Record<string, unknown>).size === 'number' &&
          typeof (entry as Record<string, unknown>).mimeType === 'string' &&
          typeof (entry as Record<string, unknown>).createdAt === 'string'
        ) {
          const e = entry as Record<string, unknown>;
          const VALID_STATUSES = new Set(['processing', 'ready', 'failed']);
          const normalised: MediaEntry = {
            id: e.id as string,
            url: e.url as string,
            filename: e.filename as string,
            size: e.size as number,
            mimeType: e.mimeType as string,
            createdAt: e.createdAt as string,
            // Pass-through new optional fields when present and valid.
            // width/height must be STRICTLY positive (> 0) to match the projection layer
            // (toImageValue / imageAttrs / mediaEntryToImageValue all require > 0). A stored
            // 0 is dropped here so a 0-dimension entry never leaks an inconsistent value
            // downstream (SSR card → "—", projected ImageFieldValue → no width/height attr).
            ...(typeof e.alt === 'string' && { alt: e.alt }),
            ...(typeof e.width === 'number' &&
              Number.isFinite(e.width) &&
              e.width > 0 && { width: e.width }),
            ...(typeof e.height === 'number' &&
              Number.isFinite(e.height) &&
              e.height > 0 && { height: e.height }),
            // fileCategory: pass-through when explicitly set, otherwise derive from mimeType (backward compat ADR-2).
            // Never mutates the file on disk — derivation is in-memory only.
            fileCategory:
              e.fileCategory === 'image' || e.fileCategory === 'document'
                ? e.fileCategory
                : (e.mimeType as string).startsWith('image/')
                  ? 'image'
                  : 'document',
            // Pass-through status only when it is a valid literal
            ...(typeof e.status === 'string' &&
              VALID_STATUSES.has(e.status) && { status: e.status as MediaEntry['status'] }),
            // Pass-through variants only when each element is a valid {format, width, url}
            ...(Array.isArray(e.variants) && {
              variants: (e.variants as unknown[]).filter((v): v is MediaVariant => {
                if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
                const vObj = v as Record<string, unknown>;
                return (
                  (vObj.format === 'webp' || vObj.format === 'avif') &&
                  typeof vObj.width === 'number' &&
                  vObj.width > 0 &&
                  typeof vObj.url === 'string'
                );
              }),
            }),
          };
          acc.push(normalised);
        }
        return acc;
      }, [])
    : [];
  return { uploads };
}

export async function updateMediaEntryAlt(id: string, alt: string): Promise<MediaEntry | null> {
  return withFileLock(mediaLockKey(), async () => {
    const m = await loadMedia();
    const index = m.uploads.findIndex((e) => e.id === id);
    if (index === -1) return null;
    m.uploads[index] = { ...m.uploads[index], alt };
    await saveMedia(m);
    return m.uploads[index];
  });
}

export async function saveMedia(data: MediaData): Promise<void> {
  await writeJson(getDataPath('media.json'), data);
}

// All media mutations share ONE lock keyed by the resolved media.json path so
// appends, deletes, and reconcile never race against each other.
function mediaLockKey(): string {
  return getDataPath('media.json');
}

export async function appendMediaEntry(entry: MediaEntry): Promise<MediaData> {
  return withFileLock(mediaLockKey(), async () => {
    const m = await loadMedia();
    m.uploads.push(entry);
    await saveMedia(m);
    return m;
  });
}

export async function removeMediaEntryByUrl(url: string): Promise<MediaData> {
  return withFileLock(mediaLockKey(), async () => {
    const m = await loadMedia();
    m.uploads = m.uploads.filter((e) => e.url !== url);
    await saveMedia(m);
    return m;
  });
}

/**
 * Update a MediaEntry to status:'ready' and populate its variants.
 * Runs under the media file lock to prevent concurrent registry corruption.
 */
export async function markMediaVariantsReady(id: string, variants: MediaVariant[]): Promise<void> {
  await withFileLock(mediaLockKey(), async () => {
    const m = await loadMedia();
    const index = m.uploads.findIndex((e) => e.id === id);
    if (index === -1) return; // No-op when id not found (robustness)
    m.uploads[index] = { ...m.uploads[index], status: 'ready', variants };
    await saveMedia(m);
  });
}

/**
 * Update a MediaEntry to status:'failed' and clear its variants.
 * Runs under the media file lock to prevent concurrent registry corruption.
 */
export async function markMediaVariantsFailed(id: string): Promise<void> {
  await withFileLock(mediaLockKey(), async () => {
    const m = await loadMedia();
    const index = m.uploads.findIndex((e) => e.id === id);
    if (index === -1) return; // No-op when id not found (robustness)
    m.uploads[index] = { ...m.uploads[index], status: 'failed', variants: [] };
    await saveMedia(m);
  });
}

/**
 * Variant file naming regex: matches `<token>-<base>-<w>.<format>` pattern.
 * Conservative: only matches files where the last segment before extension is a number
 * and the extension is webp or avif, to avoid accidentally deleting originals.
 * Pattern: anything ending in -<digits>.webp or -<digits>.avif
 */
const VARIANT_FILE_REGEX = /^.+-\d+\.(webp|avif)$/;

/**
 * Unlink a file, tolerating ENOENT (idempotent).
 */
async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Non-ENOENT errors are swallowed: cleanup is best-effort
    }
  }
}

export async function reconcileMedia(): Promise<MediaData> {
  return withFileLock(mediaLockKey(), async () => {
    const media = await loadMedia();
    const projectRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();
    const valid: MediaEntry[] = [];
    const pruned: MediaEntry[] = [];
    let changed = false;

    for (const entry of media.uploads) {
      // Resolve the public file path from the URL (strip leading slash)
      const urlPath = entry.url.startsWith('/') ? entry.url.slice(1) : entry.url;
      const filePath = path.join(projectRoot, 'public', urlPath);
      try {
        await fs.access(filePath);
        valid.push(entry);
      } catch {
        // File not on disk — prune entry and schedule variant cleanup
        pruned.push(entry);
        changed = true;
      }
    }

    // Delete variant files for pruned entries
    for (const entry of pruned) {
      if (entry.variants && entry.variants.length > 0) {
        for (const variant of entry.variants) {
          const variantUrlPath = variant.url.startsWith('/') ? variant.url.slice(1) : variant.url;
          const variantFilePath = path.join(projectRoot, 'public', variantUrlPath);
          await safeUnlink(variantFilePath);
        }
      }
    }

    // Orphan scan: enumerate variant files in uploads directories and check they
    // belong to a surviving entry. Only delete files matching VARIANT_FILE_REGEX.
    // Build a set of all valid variant URLs for quick lookup.
    const validVariantUrls = new Set<string>();
    for (const entry of valid) {
      if (entry.variants) {
        for (const variant of entry.variants) {
          validVariantUrls.add(variant.url);
        }
      }
    }

    // Scan all subdirectories under public/uploads for orphan variant files
    const uploadsDir = path.join(projectRoot, 'public', 'uploads');
    try {
      const yearDirs = await fs.readdir(uploadsDir);
      for (const yearDir of yearDirs) {
        const yearPath = path.join(uploadsDir, yearDir);
        let yearStat: Awaited<ReturnType<typeof fs.stat>>;
        try {
          yearStat = await fs.stat(yearPath);
        } catch {
          continue;
        }
        if (!yearStat.isDirectory()) continue;

        const monthDirs = await fs.readdir(yearPath);
        for (const monthDir of monthDirs) {
          const monthPath = path.join(yearPath, monthDir);
          let monthStat: Awaited<ReturnType<typeof fs.stat>>;
          try {
            monthStat = await fs.stat(monthPath);
          } catch {
            continue;
          }
          if (!monthStat.isDirectory()) continue;

          const files = await fs.readdir(monthPath);
          for (const filename of files) {
            if (!VARIANT_FILE_REGEX.test(filename)) continue;
            // Reconstruct the URL for this file
            const fileUrl = `/uploads/${yearDir}/${monthDir}/${filename}`;
            if (!validVariantUrls.has(fileUrl)) {
              // Orphan variant file — unlink
              await safeUnlink(path.join(monthPath, filename));
              changed = true;
            }
          }
        }
      }
    } catch {
      // Uploads dir may not exist (first run, test environment) — skip scan
    }

    if (changed) {
      const reconciled: MediaData = { uploads: valid };
      await saveMedia(reconciled);
      return reconciled;
    }

    return { uploads: valid };
  });
}

export function getDefaultLocale(languagesData: LanguagesData): string {
  return getDefaultLanguageCode(languagesData);
}

export function getPageStatus(page: Page, locale: string, defaultLocale: string): PageStatus {
  return getLocalizedValue(page.status, locale, defaultLocale) || 'draft';
}

export function getPageSlug(page: Page, locale: string, defaultLocale: string): string | string[] {
  return getLocalizedValue(page.slug, locale, defaultLocale) || '/';
}

export function getPageIndexable(page: Page, locale: string, defaultLocale: string): boolean {
  const value = getLocalizedValue(page.indexable, locale, defaultLocale);
  return value !== false;
}

export function getPageSeo(page: Page, locale: string, defaultLocale: string): SeoData {
  return {
    title: getLocalizedValue(page.seo?.title, locale, defaultLocale),
    description: getLocalizedValue(page.seo?.description, locale, defaultLocale),
    canonical: getLocalizedValue(page.seo?.canonical, locale, defaultLocale),
    image: getLocalizedValue(page.seo?.image, locale, defaultLocale),
    nofollow: getLocalizedValue(page.seo?.nofollow, locale, defaultLocale),
  };
}

export function getPagePublishedAt(
  page: Page,
  locale: string,
  defaultLocale: string,
): string | null {
  return getLocalizedValue(page.publishedAt, locale, defaultLocale) ?? null;
}

export function isPagePublished(page: Page, locale: string, defaultLocale: string): boolean {
  return getPageStatus(page, locale, defaultLocale) === 'published';
}

export function getPageLocaleView(
  page: Page,
  locale: string,
  defaultLocale: string,
): PageLocaleView {
  return {
    id: page.id,
    locale: normalizeLocaleCode(locale),
    title: getLocalizedValue(page.title, locale, defaultLocale) || 'Untitled',
    slug: getPageSlug(page, locale, defaultLocale),
    status: getPageStatus(page, locale, defaultLocale),
    indexable: getPageIndexable(page, locale, defaultLocale),
    seo: getPageSeo(page, locale, defaultLocale),
    blocks: page.blocks || [],
    publishedAt: getPagePublishedAt(page, locale, defaultLocale),
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

export function getPageStatusStrict(page: Page, locale: string): PageStatus {
  return getLocalizedValueForLocale(page.status, locale) || 'draft';
}

export function getPageSlugStrict(page: Page, locale: string): string | string[] | undefined {
  return getLocalizedValueForLocale(page.slug, locale);
}

export function getPageLocaleViewStrict(page: Page, locale: string): PageLocaleView {
  return {
    id: page.id,
    locale: normalizeLocaleCode(locale),
    title: getLocalizedValueForLocale(page.title, locale) || 'Untitled',
    slug: getPageSlugStrict(page, locale) || '/',
    status: getPageStatusStrict(page, locale),
    indexable: getLocalizedValueForLocale(page.indexable, locale) !== false,
    seo: {
      title: getLocalizedValueForLocale(page.seo?.title, locale),
      description: getLocalizedValueForLocale(page.seo?.description, locale),
      canonical: getLocalizedValueForLocale(page.seo?.canonical, locale),
      image: getLocalizedValueForLocale(page.seo?.image, locale),
      nofollow: getLocalizedValueForLocale(page.seo?.nofollow, locale),
    },
    blocks: page.blocks || [],
    publishedAt: getLocalizedValueForLocale(page.publishedAt, locale) ?? null,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

export function setPageLocaleValue<T>(
  map: Record<string, T> | undefined,
  locale: string,
  value: T,
): Record<string, T> {
  return setLocalizedValue(map, locale, value);
}

export function getPublishedPages(
  pagesData: PagesData,
  locale: string,
  defaultLocale: string,
): Page[] {
  const list = pagesData.pages ?? [];
  return list.filter((page) => isPagePublished(page, locale, defaultLocale));
}

export function getPublishedPagesStrict(pagesData: PagesData, locale: string): Page[] {
  const list = pagesData.pages ?? [];
  return list.filter((page) => getPageStatusStrict(page, locale) === 'published');
}

export function getPageBySlug(
  pagesData: PagesData,
  slug: string | string[],
  locale: string,
  defaultLocale: string,
): Page | undefined {
  const pathStr = slugToPath(slug);
  return (pagesData.pages ?? []).find(
    (page) =>
      slugToPath(getPageSlug(page, locale, defaultLocale)) === pathStr &&
      isPagePublished(page, locale, defaultLocale),
  );
}

export function getPageBySlugStrict(
  pagesData: PagesData,
  slug: string | string[],
  locale: string,
): Page | undefined {
  const pathStr = slugToPath(slug);
  return (pagesData.pages ?? []).find((page) => {
    const localizedSlug = getPageSlugStrict(page, locale);
    if (!localizedSlug) return false;
    return (
      slugToPath(localizedSlug) === pathStr && getPageStatusStrict(page, locale) === 'published'
    );
  });
}

export function getPageById(pagesData: PagesData, id: string): Page | undefined {
  return (pagesData.pages ?? []).find((page) => page.id === id);
}

export function getMenuItems(menu: Menu, locale: string, defaultLocale: string): MenuItem[] {
  const selected = getLocalizedValue(menu.items, locale, defaultLocale);
  return Array.isArray(selected) ? selected : [];
}

export function getMenuItemsStrict(menu: Menu, locale: string): MenuItem[] {
  const selected = getLocalizedValueForLocale(menu.items, locale);
  return Array.isArray(selected) ? selected : [];
}

export function getMenuLocaleView(
  menu: Menu,
  locale: string,
  defaultLocale: string,
): MenuLocaleView {
  return {
    id: menu.id,
    locale: normalizeLocaleCode(locale),
    name: menu.name,
    selector: menu.selector,
    items: getMenuItems(menu, locale, defaultLocale),
  };
}

export { pageToSlugParam };

export function generateId(): string {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export async function ensureDataDir(): Promise<void> {
  await ensureDir(getDataDir());
  await ensureDir(getUploadsDir());
}

export async function ensureDefaultFiles(): Promise<void> {
  await ensureDataDir();

  const defaults: Array<[string, unknown]> = [
    [getDataPath('site.json'), DEFAULT_SITE],
    [getDataPath('pages.json'), DEFAULT_PAGES],
    [getDataPath('menus.json'), DEFAULT_MENUS],
    [getDataPath('redirects.json'), DEFAULT_REDIRECTS],
    [getDataPath('configs.json'), DEFAULT_CONFIGS],
    [getDataPath('users.json'), DEFAULT_USERS],
    [getDataPath('languages.json'), DEFAULT_LANGUAGES],
    [getDataPath('global-blocks.json'), DEFAULT_GLOBAL_BLOCKS],
    [getDataPath('media.json'), DEFAULT_MEDIA],
  ];

  for (const [filePath, defaultValue] of defaults) {
    try {
      await fs.access(filePath);
    } catch {
      await writeJson(filePath, defaultValue);
    }
  }
}

export function ensureLocaleAvailable(locale: string, languagesData: LanguagesData): string {
  const normalized = normalizeLocaleCode(locale);
  const available = languagesData.languages.filter((language) => language.enabled !== false);
  if (available.length === 0) return getDefaultLanguageCode(languagesData);
  if (available.some((language) => normalizeLocaleCode(language.code) === normalized))
    return normalized;
  return getDefaultLanguageCode(languagesData);
}

export function buildLocalizedSlugMap(
  locale: string,
  slug: string | string[],
): Record<string, string | string[]> {
  return { [normalizeLocaleCode(locale)]: slug };
}

export function buildLocalizedStatusMap(
  locale: string,
  status: PageStatus,
): Record<string, PageStatus> {
  return { [normalizeLocaleCode(locale)]: ensurePageStatus(status) };
}

export function buildLocalizedBooleanMap(locale: string, value: boolean): Record<string, boolean> {
  return { [normalizeLocaleCode(locale)]: Boolean(value) };
}
