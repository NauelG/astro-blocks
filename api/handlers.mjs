import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT, jwtVerify } from 'jose';
import { getUploadsDir, getDataPath, getDataDir } from '../utils/paths.mjs';
import * as data from './data.mjs';

const JWT_SECRET = new TextEncoder().encode(process.env.CMS_JWT_SECRET || 'cms-jwt-secret-change-me');
const JWT_EXPIRY = '7d';

function scryptAsync(password, salt, keylen) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return scryptAsync(password, salt, 64).then((hash) => salt.toString('base64') + ':' + hash.toString('base64'));
}

export async function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [saltB64, hashB64] = stored.split(':');
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password, salt, 64);
  return crypto.timingSafeEqual(derived, expected);
}

async function createToken(user) {
  return new SignJWT({
    email: user.email,
    role: user.role,
  })
    .setSubject(user.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

/** Returns { user: { id, email, role } } or null if not authenticated. */
export async function getAuth(request) {
  const token =
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')?.trim() || request.headers.get('x-cms-token') || '';
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const id = payload.sub;
    const email = payload.email;
    const role = payload.role;
    if (!id || !email || !role) return null;
    return { user: { id, email, role } };
  } catch {
    return null;
  }
}

/** Returns 403 Response if user is not owner, else null. */
export function requireOwner(user) {
  if (!user || user.role !== 'owner') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
  return null;
}

export async function handleLogin(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
  }

  const usersData = await data.loadUsers();
  const users = usersData.users || [];

  if (users.length === 0) {
    const id = data.generateId();
    const createdAt = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    const newUser = { id, email, passwordHash, role: 'owner', createdAt };
    users.push(newUser);
    await data.saveUsers({ users });
    const token = await createToken(newUser);
    return Response.json({ token, user: { id, email, role: 'owner' } });
  }

  const u = users.find((x) => x.email === email);
  if (!u || !(await verifyPassword(password, u.passwordHash))) {
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
  }
  const token = await createToken(u);
  return Response.json({ token, user: { id: u.id, email: u.email, role: u.role } });
}

export async function handleAuthMe(user) {
  if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  return Response.json({ user });
}

/** Public: no auth. Returns hasUsers, logo, siteName for login/onboarding screen. */
export async function handleAuthStatus() {
  const usersData = await data.loadUsers();
  const site = await data.loadSite();
  const hasUsers = (usersData.users || []).length > 0;
  return Response.json({
    hasUsers,
    logo: site.logo || '',
    siteName: site.siteName || 'CMS',
  });
}

export async function handleGetUsers(user) {
  const forbidden = requireOwner(user);
  if (forbidden) return forbidden;
  const usersData = await data.loadUsers();
  const list = (usersData.users || []).map(({ id, email, role, createdAt }) => ({ id, email, role, createdAt }));
  return Response.json({ users: list });
}

export async function handlePostUsers(request, authUser) {
  const forbidden = requireOwner(authUser);
  if (forbidden) return forbidden;
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role = body.role === 'owner' ? 'owner' : 'user';
  if (!email || !password) {
    return new Response(JSON.stringify({ error: 'Email and password required' }), { status: 400 });
  }
  const usersData = await data.loadUsers();
  const users = usersData.users || [];
  if (users.some((u) => u.email === email)) {
    return new Response(JSON.stringify({ error: 'Email already exists' }), { status: 400 });
  }
  const id = data.generateId();
  const createdAt = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  users.push({ id, email, passwordHash, role, createdAt });
  await data.saveUsers({ users });
  return Response.json({ id, email, role, createdAt });
}

export async function handlePutUser(id, request, authUser) {
  const forbidden = requireOwner(authUser);
  if (forbidden) return forbidden;
  const usersData = await data.loadUsers();
  const users = usersData.users || [];
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid body' }), { status: 400 });
  }

  const target = users[idx];
  const ownerCount = users.filter((u) => u.role === 'owner').length;

  if (body.role !== undefined) {
    const newRole = body.role === 'owner' ? 'owner' : 'user';
    if (target.role === 'owner' && newRole === 'user' && ownerCount <= 1) {
      return new Response(JSON.stringify({ error: 'No se puede quitar el único propietario' }), { status: 400 });
    }
    users[idx] = { ...target, role: newRole };
  }

  if (typeof body.password === 'string' && body.password.length > 0) {
    users[idx] = { ...users[idx], passwordHash: await hashPassword(body.password) };
  }

  await data.saveUsers({ users });
  const updated = users[idx];
  return Response.json({ id: updated.id, email: updated.email, role: updated.role, createdAt: updated.createdAt });
}

export async function handleDeleteUser(id, authUser) {
  const forbidden = requireOwner(authUser);
  if (forbidden) return forbidden;
  const usersData = await data.loadUsers();
  const users = usersData.users || [];
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  const target = users[idx];
  const ownerCount = users.filter((u) => u.role === 'owner').length;
  if (target.role === 'owner' && ownerCount <= 1) {
    return new Response(JSON.stringify({ error: 'No se puede eliminar al único propietario' }), { status: 400 });
  }
  users.splice(idx, 1);
  await data.saveUsers({ users });
  return new Response(null, { status: 204 });
}

export async function handleGetPages() {
  const pagesData = await data.loadPages();
  return Response.json(pagesData);
}

export async function handlePostPages(request) {
  const body = await request.json();
  const pagesData = await data.loadPages();
  const id = data.generateId();
  const now = new Date().toISOString();
  const page = {
    id,
    slug: body.slug ?? '/',
    status: body.status ?? 'draft',
    title: body.title ?? 'Untitled',
    blocks: body.blocks ?? [],
    seo: body.seo ?? {},
    indexable: body.indexable !== false,
    publishedAt: body.status === 'published' ? now : null,
    createdAt: now,
    updatedAt: now,
  };
  pagesData.pages = pagesData.pages || [];
  pagesData.pages.push(page);
  await data.savePages(pagesData);
  return Response.json(page);
}

export async function handlePutPage(id, request) {
  const body = await request.json();
  const pagesData = await data.loadPages();
  const idx = (pagesData.pages || []).findIndex((p) => p.id === id);
  if (idx === -1) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  const now = new Date().toISOString();
  const existing = pagesData.pages[idx];
  const page = {
    ...existing,
    slug: body.slug !== undefined ? body.slug : existing.slug,
    status: body.status !== undefined ? body.status : existing.status,
    title: body.title !== undefined ? body.title : existing.title,
    blocks: body.blocks !== undefined ? body.blocks : existing.blocks,
    seo:
      body.seo !== undefined
        ? { ...(existing.seo || {}), ...body.seo }
        : existing.seo,
    indexable: body.indexable !== undefined ? body.indexable : existing.indexable,
    updatedAt: now,
    publishedAt: body.status === 'published' ? (existing.publishedAt || now) : existing.publishedAt,
  };
  pagesData.pages[idx] = page;
  await data.savePages(pagesData);
  return Response.json(page);
}

export async function handleDeletePage(id) {
  const pagesData = await data.loadPages();
  const before = (pagesData.pages || []).length;
  pagesData.pages = (pagesData.pages || []).filter((p) => p.id !== id);
  if (pagesData.pages.length === before) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  await data.savePages(pagesData);
  return new Response(null, { status: 204 });
}

export async function handleGetSite() {
  const site = await data.loadSite();
  return Response.json(site);
}

export async function handlePutSite(request) {
  const body = await request.json();
  const existing = await data.loadSite();
  const site = { ...existing, ...body };
  await data.saveSite(site);
  return Response.json(site);
}

export async function handleGetMenus() {
  const menusData = await data.loadMenus();
  return Response.json(menusData);
}

/** Recursively validate that every item has non-empty path. Returns error message or null. */
function validateMenuItemsPaths(items) {
  if (!Array.isArray(items)) return 'Los elementos del menú deben ser un array.';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') return 'Elemento del menú no válido.';
    const pathVal = item.path;
    if (typeof pathVal !== 'string' || pathVal.trim() === '') {
      return 'La ruta es obligatoria en todos los elementos del menú.';
    }
    if (Array.isArray(item.children)) {
      const childErr = validateMenuItemsPaths(item.children);
      if (childErr) return childErr;
    }
  }
  return null;
}

/** Validate selector format and uniqueness. excludeMenuId = id to exclude when updating. */
function validateMenuSelector(menusData, selector, excludeMenuId) {
  if (typeof selector !== 'string' || selector.trim() === '') {
    return 'El selector es obligatorio.';
  }
  if (!data.MENU_SELECTOR_REGEX.test(selector)) {
    return 'El selector solo puede contener letras, números, guiones y guiones bajos (sin espacios).';
  }
  const menus = menusData.menus ?? [];
  const taken = menus.some((m) => m.selector === selector && m.id !== excludeMenuId);
  if (taken) return 'Ya existe un menú con ese selector.';
  return null;
}

export async function handlePostMenus(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const selector = typeof body.selector === 'string' ? body.selector.trim() : '';
  const items = Array.isArray(body.items) ? body.items : [];

  const menusData = await data.loadMenus();
  const selErr = validateMenuSelector(menusData, selector, null);
  if (selErr) return new Response(JSON.stringify({ error: selErr }), { status: 400 });
  const pathErr = validateMenuItemsPaths(items);
  if (pathErr) return new Response(JSON.stringify({ error: pathErr }), { status: 400 });

  const newMenu = {
    id: data.generateId(),
    name: name || 'Menú',
    selector: selector || 'menu',
    items,
  };
  menusData.menus.push(newMenu);
  await data.saveMenus(menusData);
  return Response.json(newMenu);
}

export async function handlePutMenu(id, request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const selector = typeof body.selector === 'string' ? body.selector.trim() : '';
  const items = Array.isArray(body.items) ? body.items : [];

  const menusData = await data.loadMenus();
  const index = (menusData.menus ?? []).findIndex((m) => m.id === id);
  if (index === -1) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  const selErr = validateMenuSelector(menusData, selector, id);
  if (selErr) return new Response(JSON.stringify({ error: selErr }), { status: 400 });
  const pathErr = validateMenuItemsPaths(items);
  if (pathErr) return new Response(JSON.stringify({ error: pathErr }), { status: 400 });

  const updated = {
    id: menusData.menus[index].id,
    name: name || 'Menú',
    selector: selector || 'menu',
    items,
  };
  menusData.menus[index] = updated;
  await data.saveMenus(menusData);
  return Response.json(updated);
}

export async function handleDeleteMenu(id) {
  const menusData = await data.loadMenus();
  const menus = (menusData.menus ?? []).filter((m) => m.id !== id);
  if (menus.length === menusData.menus.length) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
  }
  await data.saveMenus({ menus });
  return new Response(null, { status: 204 });
}

export async function handleUpload(request) {
  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return new Response(JSON.stringify({ error: 'No file' }), { status: 400 });
  }
  const buf = await file.arrayBuffer();
  const name = file.name || 'upload';
  const ext = path.extname(name) || '';
  const subdir = new Date().toISOString().slice(0, 7).replace(/-/g, '/');
  const dir = path.join(getUploadsDir(), subdir);
  await fs.mkdir(dir, { recursive: true });
  const token = crypto.randomBytes(4).toString('hex');
  const base = path.basename(name, ext) || 'file';
  const filename = `${token}-${base}${ext}`;
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, Buffer.from(buf));
  const url = `/uploads/${subdir}/${filename}`.replace(/\/+/g, '/');
  return Response.json({ url });
}

/**
 * Resolve an upload URL (e.g. /uploads/2025/03/abc.jpg) to a filesystem path.
 * Returns null if the URL is not under /uploads/ or would escape the uploads dir.
 */
function uploadUrlToFilePath(url) {
  if (!url || typeof url !== 'string') return null;
  const normalized = url.replace(/\/+/g, '/').replace(/^\//, '');
  if (!normalized.startsWith('uploads/')) return null;
  const relative = normalized.slice('uploads/'.length);
  if (relative.includes('..')) return null;
  const fullPath = path.join(getUploadsDir(), relative);
  const uploadsDir = path.resolve(getUploadsDir());
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(uploadsDir)) return null;
  return resolved;
}

export async function handleDeleteUpload(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }
  const url = body?.url;
  const filePath = uploadUrlToFilePath(url);
  if (!filePath) {
    return new Response(JSON.stringify({ error: 'Invalid or disallowed URL' }), { status: 400 });
  }
  try {
    await fs.unlink(filePath);
  } catch (e) {
    if (e.code === 'ENOENT') return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ error: 'Delete failed' }), { status: 500 });
  }
  return new Response(null, { status: 204 });
}

export async function handleRebuild() {
  const { spawn } = await import('node:child_process');
  const projectRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT || process.cwd();
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'build'], {
      cwd: projectRoot,
      shell: true,
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code === 0) resolve(Response.json({ ok: true }));
      else resolve(new Response(JSON.stringify({ error: 'Build failed', code }), { status: 500 }));
    });
    child.on('error', (err) => {
      resolve(new Response(JSON.stringify({ error: String(err) }), { status: 500 }));
    });
  });
}
