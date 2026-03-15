export const prerender = false;
import * as handlers from '../../api/handlers.mjs';

function getPathSegments(url) {
  const pathname = new URL(url).pathname;
  const segments = pathname.split('/').filter(Boolean);
  return segments.slice(2);
}

async function ensureAuth(request) {
  const auth = await handlers.getAuth(request);
  if (!auth) return { status: 401, body: { error: 'Unauthorized' } };
  return { user: auth.user };
}

export async function GET({ request }) {
  const seg = getPathSegments(request.url);

  if (seg[0] === 'auth' && seg[1] === 'status' && seg.length === 2) {
    return handlers.handleAuthStatus();
  }
  if (seg[0] === 'auth' && seg[1] === 'me' && seg.length === 2) {
    const auth = await handlers.getAuth(request);
    return handlers.handleAuthMe(auth?.user);
  }

  const authResult = await ensureAuth(request);
  if (authResult.status === 401) {
    return new Response(JSON.stringify(authResult.body), { status: 401 });
  }
  const user = authResult.user;

  if (seg[0] === 'pages' && seg.length === 1) return handlers.handleGetPages();
  if (seg[0] === 'site' && seg.length === 1) return handlers.handleGetSite();
  if (seg[0] === 'menus' && seg.length === 1) return handlers.handleGetMenus();
  if (seg[0] === 'users' && seg.length === 1) return handlers.handleGetUsers(user);
  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

export async function POST({ request }) {
  const seg = getPathSegments(request.url);

  if (seg[0] === 'auth' && seg[1] === 'login' && seg.length === 2) {
    return handlers.handleLogin(request);
  }

  const authResult = await ensureAuth(request);
  if (authResult.status === 401) {
    return new Response(JSON.stringify(authResult.body), { status: 401 });
  }
  const user = authResult.user;

  if (seg[0] === 'pages' && seg.length === 1) return handlers.handlePostPages(request);
  if (seg[0] === 'upload' && seg.length === 1) return handlers.handleUpload(request);
  if (seg[0] === 'rebuild' && seg.length === 1) return handlers.handleRebuild();
  if (seg[0] === 'users' && seg.length === 1) return handlers.handlePostUsers(request, user);
  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

export async function PUT({ request }) {
  const authResult = await ensureAuth(request);
  if (authResult.status === 401) {
    return new Response(JSON.stringify(authResult.body), { status: 401 });
  }
  const user = authResult.user;

  const seg = getPathSegments(request.url);
  if (seg[0] === 'pages' && seg.length === 2) return handlers.handlePutPage(seg[1], request);
  if (seg[0] === 'site' && seg.length === 1) {
    const forbidden = handlers.requireOwner(user);
    if (forbidden) return forbidden;
    return handlers.handlePutSite(request);
  }
  if (seg[0] === 'menus' && seg.length === 1) return handlers.handlePutMenus(request);
  if (seg[0] === 'users' && seg.length === 2) return handlers.handlePutUser(seg[1], request, user);
  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}

export async function DELETE({ request }) {
  const authResult = await ensureAuth(request);
  if (authResult.status === 401) {
    return new Response(JSON.stringify(authResult.body), { status: 401 });
  }
  const user = authResult.user;

  const seg = getPathSegments(request.url);
  if (seg[0] === 'pages' && seg.length === 2) return handlers.handleDeletePage(seg[1]);
  if (seg[0] === 'users' && seg.length === 2) return handlers.handleDeleteUser(seg[1], user);
  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
}
