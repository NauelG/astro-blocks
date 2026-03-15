import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataPath, getDataDir, getUploadsDir } from '../utils/paths.mjs';

const DEFAULT_PAGES = { pages: [] };
const DEFAULT_SITE = {
  siteName: 'My Site',
  baseUrl: 'http://localhost:4321',
  favicon: '/favicon.svg',
  logo: '',
  primaryColor: '#333',
  secondaryColor: '#666',
  seo: {
    defaultTitle: '',
    defaultDescription: '',
  },
};
const DEFAULT_MENUS = { menus: [] };
const DEFAULT_USERS = { users: [] };

export const MENU_SELECTOR_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Normalize a single menu item (name, path, children?). */
function normalizeMenuItem(item) {
  if (!item || typeof item !== 'object') return { name: '', path: '', children: [] };
  const children = Array.isArray(item.children) ? item.children.map(normalizeMenuItem) : [];
  return {
    name: typeof item.name === 'string' ? item.name : '',
    path: typeof item.path === 'string' ? item.path : '',
    ...(children.length > 0 ? { children } : {}),
  };
}

/** Normalize a menu entry (id, name, selector, items). */
function normalizeMenu(menu, index) {
  if (!menu || typeof menu !== 'object') {
    return { id: generateId(), name: '', selector: 'menu-' + index, items: [] };
  }
  const items = Array.isArray(menu.items) ? menu.items.map(normalizeMenuItem) : [];
  return {
    id: typeof menu.id === 'string' && menu.id ? menu.id : generateId(),
    name: typeof menu.name === 'string' ? menu.name : '',
    selector: typeof menu.selector === 'string' ? menu.selector : 'menu-' + String(index),
    items,
  };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(filePath, defaultValue) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return defaultValue ?? null;
    throw e;
  }
}

async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function loadPages() {
  const data = await readJson(getDataPath('pages.json'), DEFAULT_PAGES);
  return Array.isArray(data.pages) ? data : { ...DEFAULT_PAGES, pages: data.pages ?? [] };
}

export async function savePages(pagesData) {
  await ensureDir(getDataDir());
  await writeJson(getDataPath('pages.json'), pagesData);
}

export async function loadSite() {
  const data = await readJson(getDataPath('site.json'), DEFAULT_SITE);
  return { ...DEFAULT_SITE, ...data };
}

export async function saveSite(siteData) {
  await ensureDir(getDataDir());
  await writeJson(getDataPath('site.json'), siteData);
}

export async function loadMenus() {
  const data = await readJson(getDataPath('menus.json'), DEFAULT_MENUS);
  if (!data || typeof data !== 'object' || !Array.isArray(data.menus)) {
    return { menus: [] };
  }
  return {
    menus: data.menus.map((m, i) => normalizeMenu(m, i)),
  };
}

export async function saveMenus(menusData) {
  await ensureDir(getDataDir());
  await writeJson(getDataPath('menus.json'), menusData);
}

export async function loadUsers() {
  const data = await readJson(getDataPath('users.json'), DEFAULT_USERS);
  return Array.isArray(data.users) ? data : { ...DEFAULT_USERS, users: data.users ?? [] };
}

export async function saveUsers(usersData) {
  await ensureDir(getDataDir());
  await writeJson(getDataPath('users.json'), usersData);
}

export function getPublishedPages(pagesData) {
  const list = pagesData.pages ?? [];
  return list.filter((p) => p.status === 'published');
}

export function getPageBySlug(pagesData, slug) {
  const normalized = Array.isArray(slug) ? slug : slug === '/' || slug === '' ? [] : [slug].flat();
  const pathStr = normalized.length === 0 ? '/' : '/' + normalized.join('/');
  const list = pagesData.pages ?? [];
  return list.find((p) => {
    const pSlug = p.slug === '/' || (Array.isArray(p.slug) && p.slug.length === 0) ? '/' : (Array.isArray(p.slug) ? '/' + p.slug.join('/') : p.slug);
    return pSlug === pathStr && p.status === 'published';
  });
}

export function getPageById(pagesData, id) {
  return (pagesData.pages ?? []).find((p) => p.id === id);
}

/** Slug string for getStaticPaths: '' for home, 'a/b' for /a/b */
export function pageToSlugParam(page) {
  if (!page) return '';
  const s = page.slug;
  if (s === '/' || (Array.isArray(s) && s.length === 0)) return '';
  if (Array.isArray(s)) return s.join('/');
  return String(s).replace(/^\//, '');
}

export function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function ensureDataDir() {
  await ensureDir(getDataDir());
  await ensureDir(getUploadsDir());
}

/** Create data/ and default JSON files if they do not exist (call from plugin on setup). */
export async function ensureDefaultFiles() {
  await ensureDataDir();
  const sitePath = getDataPath('site.json');
  try {
    await fs.access(sitePath);
  } catch {
    await writeJson(sitePath, DEFAULT_SITE);
  }
  const pagesPath = getDataPath('pages.json');
  try {
    await fs.access(pagesPath);
  } catch {
    await writeJson(pagesPath, DEFAULT_PAGES);
  }
  const menusPath = getDataPath('menus.json');
  try {
    await fs.access(menusPath);
  } catch {
    await writeJson(menusPath, { menus: [] });
  }
  const usersPath = getDataPath('users.json');
  try {
    await fs.access(usersPath);
  } catch {
    await writeJson(usersPath, DEFAULT_USERS);
  }
}
