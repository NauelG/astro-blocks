/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { getDataDir, getDataPath, getUploadsDir } from '../utils/paths.js';
import { pageToSlugParam, slugToPath } from '../utils/slug.js';
import type { Menu, MenuItem, MenusData, Page, PagesData, Site, UsersData } from '../types/index.js';

const DEFAULT_PAGES: PagesData = { pages: [] };
const DEFAULT_SITE: Site = {
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
const DEFAULT_MENUS: MenusData = { menus: [] };
const DEFAULT_USERS: UsersData = { users: [] };

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

function normalizeMenu(menu: unknown, index: number): Menu {
  if (!menu || typeof menu !== 'object') {
    return { id: generateId(), name: '', selector: `menu-${index}`, items: [] };
  }

  const raw = menu as Partial<Menu>;
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeMenuItem) : [];

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : generateId(),
    name: typeof raw.name === 'string' ? raw.name : '',
    selector: typeof raw.selector === 'string' ? raw.selector : `menu-${String(index)}`,
    items,
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

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export async function loadPages(): Promise<PagesData> {
  const data = await readJson(getDataPath('pages.json'), DEFAULT_PAGES);
  return Array.isArray(data.pages) ? data : { ...DEFAULT_PAGES, pages: data.pages ?? [] };
}

export async function savePages(pagesData: PagesData): Promise<void> {
  await writeJson(getDataPath('pages.json'), pagesData);
}

export async function loadSite(): Promise<Site> {
  const data = await readJson(getDataPath('site.json'), DEFAULT_SITE);
  return { ...DEFAULT_SITE, ...data };
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

export async function loadUsers(): Promise<UsersData> {
  const data = await readJson(getDataPath('users.json'), DEFAULT_USERS);
  return Array.isArray(data.users) ? data : { ...DEFAULT_USERS, users: data.users ?? [] };
}

export async function saveUsers(usersData: UsersData): Promise<void> {
  await writeJson(getDataPath('users.json'), usersData);
}

export function getPublishedPages(pagesData: PagesData): Page[] {
  const list = pagesData.pages ?? [];
  return list.filter((page) => page.status === 'published');
}

export function getPageBySlug(pagesData: PagesData, slug: string | string[]): Page | undefined {
  const pathStr = slugToPath(slug);
  return (pagesData.pages ?? []).find((page) => slugToPath(page.slug) === pathStr && page.status === 'published');
}

export function getPageById(pagesData: PagesData, id: string): Page | undefined {
  return (pagesData.pages ?? []).find((page) => page.id === id);
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
    [getDataPath('users.json'), DEFAULT_USERS],
  ];

  for (const [filePath, defaultValue] of defaults) {
    try {
      await fs.access(filePath);
    } catch {
      await writeJson(filePath, defaultValue);
    }
  }
}
