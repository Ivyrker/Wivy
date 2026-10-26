// Подключение SoundCloud (основной процесс). Два способа входа, оба отдают плееру одинаковую «библиотеку»:
//  1) «web»: вход в обычном окне soundcloud.com внутри приложения. Пользователю ничего настраивать не нужно.
//     Приложение берёт сессию этого окна и ходит в тот же api-v2, что и сайт. Способ неофициальный.
//  2) «api»: официальный API SoundCloud (OAuth 2.1 + PKCE). Нужны client_id и client_secret своего приложения
//     (soundcloud.com/you/apps, нужен Artist Pro). Запасной способ, если первый перестанет работать.
// Токены и пароли в окно приложения не попадают: наружу отдаются только готовые списки треков.
const { app, BrowserWindow, session, safeStorage, shell, net } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:soundcloud';            // отдельное хранилище cookie для окна входа
const REDIRECT_URI = 'http://localhost:53682/callback'; // впишите его в настройки своего приложения SoundCloud (запасной способ)
const LIMITS = { recent: 40, recommended: 40, liked: 300, playlists: 100, following: 200 };

class AuthError extends Error {}

/* ---------- Хранилище настроек: секреты шифруются средствами системы, если она это умеет ---------- */
let conf = null;
const confFile = () => path.join(app.getPath('userData'), 'soundcloud.json');
function readConf() {
  if (conf) return conf;
  try { conf = JSON.parse(fs.readFileSync(confFile(), 'utf8')); } catch (e) { conf = {}; }
  if (!conf || typeof conf !== 'object') conf = {};
  return conf;
}
function writeConf() { try { fs.writeFileSync(confFile(), JSON.stringify(conf)); } catch (e) { /* ничего */ } }
function seal(s) {
  if (!s) return '';
  try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64'); } catch (e) { /* ниже */ }
  return 'raw:' + s;
}
function unseal(s) {
  if (!s) return '';
  try {
    if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
    if (s.startsWith('raw:')) return s.slice(4);
  } catch (e) { /* ниже */ }
  return '';
}

/* ---------- Сеть ---------- */
const ses = () => session.fromPartition(PARTITION);
// обычный Chrome без пометок Electron: так вход через Google и Apple реже отвергается
const chromeUA = () => ses().getUserAgent().replace(/\s*Electron\/\S+/, '').replace(/\s*music-player\/\S+/i, '');

async function getJson(url, headers) {
  const res = await net.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': chromeUA(), ...headers } });
  if (res.status === 401) throw new AuthError('Session expired (HTTP 401)');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function collect(get, first, limit) {
  const out = [];
  let next = first;
  for (let guard = 0; next && out.length < limit && guard < 12; guard++) {
    const page = await get(next);
    if (Array.isArray(page)) { out.push(...page); break; }
    out.push(...((page && page.collection) || []));
    next = page && page.next_href;
  }
  return out.slice(0, limit);
}

/* ---------- Приведение ответов SoundCloud к одному виду ---------- */
// картинки показываем только с серверов SoundCloud: адрес попадает в стиль страницы
const SAFE_IMG = /^https:\/\/[a-z0-9.-]+\.sndcdn\.com\/[^\s"'()<>\\]+$/i;
const art = (u) => {
  const big = u ? String(u).replace('-large.', '-t300x300.') : '';
  return SAFE_IMG.test(big) ? big : '';
};
function toTrack(t) {
  if (!t || !t.id || !t.title) return null;
  const u = t.user || {};
  return {
    scId: t.id,
    title: String(t.title),
    artist: String(u.username || (t.publisher_metadata && t.publisher_metadata.artist) || ''),
    dur: Math.round((t.full_duration || t.duration || 0) / 1000),
    art: art(t.artwork_url || u.avatar_url),
    url: String(t.permalink_url || ''),
  };
}
// элемент списка бывает самим треком ({title…}), обёрткой ({track}) или событием ленты ({type, origin})
const trackOf = (it) => it && toTrack(it.track || (/track/.test(it.type || '') && it.origin) || (!it.type && it) || null);
function toPlaylist(it) {
  const p = it && (it.playlist || (/playlist/.test(it.type || '') && it.origin) || (!it.type && it));
  if (!p || !p.id || !p.title) return null;
  const first = (p.tracks || [])[0] || {};
  return { name: String(p.title), count: p.track_count || (p.tracks || []).length || 0, art: art(p.artwork_url || first.artwork_url), url: String(p.permalink_url || '') };
}
function toUser(u) {
  if (!u || !u.id || !u.username) return null;
  return { name: String(u.username), art: art(u.avatar_url), url: String(u.permalink_url || '') };
}
const uniq = (list, key) => { const seen = new Set(); return list.filter((x) => x && !seen.has(key(x)) && seen.add(key(x))); };

async function fetchLibrary(get, kind) {
  const web = kind === 'web';
  const warnings = [];
  const me = await get('/me');                    // если тут отказ, значит мы не вошли
  const flag = web ? '' : '&linked_partitioning=true'; // в официальном API страницы листаются только с этим флагом
  const safe = async (name, first, limit) => {
    if (!first) return [];
    try { return await collect(get, first, limit); } catch (e) {
      if (e instanceof AuthError) throw e;
      warnings.push(name + ': ' + e.message);
      return [];
    }
  };
  const [recent, recommended, liked, own, likedPl, following] = await Promise.all([
    safe('recent', web ? `/me/play-history/tracks?limit=${LIMITS.recent}` : '', LIMITS.recent), // в официальном API истории прослушиваний нет
    safe('recommended', web ? `/stream?limit=${LIMITS.recommended}` : `/me/activities?limit=${LIMITS.recommended}${flag}`, LIMITS.recommended),
    safe('liked', web ? `/users/${me.id}/track_likes?limit=50` : `/me/likes/tracks?limit=50&access=playable${flag}`, LIMITS.liked),
    safe('playlists', web ? `/users/${me.id}/playlists_without_albums?limit=50` : `/me/playlists?limit=50&show_tracks=false${flag}`, LIMITS.playlists),
    safe('likedPlaylists', web ? `/users/${me.id}/playlist_likes?limit=50` : `/me/likes/playlists?limit=50${flag}`, LIMITS.playlists),
    safe('following', web ? `/users/${me.id}/followings?limit=50` : `/me/followings?limit=50${flag}`, LIMITS.following),
  ]);
  const tracks = (list) => uniq(list.map(trackOf), (t) => t.scId);
  return {
    me: { name: String(me.username || me.full_name || ''), avatar: art(me.avatar_url), url: String(me.permalink_url || '') },
    mode: kind,
    updated: Date.now(),
    recent: tracks(recent),
    recommended: tracks(recommended),
    liked: tracks(liked),
    playlists: uniq([...own, ...likedPl].map(toPlaylist), (p) => p.url || p.name).slice(0, LIMITS.playlists),
    following: uniq(following.map(toUser), (u) => u.url || u.name),
    warnings,
  };
}

/* ---------- Способ 1: вход через окно сайта ---------- */
let clientIdCache = '';
async function webClientId() {
  if (clientIdCache) return clientIdCache;
  const html = await (await net.fetch('https://soundcloud.com/', { headers: { 'User-Agent': chromeUA() } })).text();
  const scripts = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).reverse();
  for (const url of scripts) {
    try {
      const js = await (await net.fetch(url, { headers: { 'User-Agent': chromeUA() } })).text();
      const m = js.match(/client_id\s*:\s*"([A-Za-z0-9]{32})"/);
      if (m) return (clientIdCache = m[1]);
    } catch (e) { /* пробуем следующий файл */ }
  }
  throw new Error('SoundCloud client_id not found');
}
async function webToken() {
  const c = (await ses().cookies.get({ name: 'oauth_token' })).find((x) => x.value);
  return c ? decodeURIComponent(c.value) : '';
}
const webGetter = (token, clientId) => (p) => {
  const url = new URL(p, 'https://api-v2.soundcloud.com');
  if (!url.searchParams.has('client_id')) url.searchParams.set('client_id', clientId);
  return getJson(url.toString(), { Authorization: 'OAuth ' + token });
};

const log = (...args) => console.log('[SoundCloud]', ...args);

function errorPage(desc, url) {
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:32px;color:#222">
    <h3>SoundCloud did not load</h3><p>${esc(desc)}</p><p style="color:#777;word-break:break-all">${esc(url)}</p>
    <p>Check your internet connection, close this window and try again.</p>`;
}

function openWindow(parent, url) {
  const win = new BrowserWindow({
    width: 520, height: 780, parent: parent || undefined, autoHideMenuBar: true,
    title: 'SoundCloud', backgroundColor: '#ffffff',
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const wc = win.webContents;
  wc.setUserAgent(chromeUA());
  // если страница осталась белой, эти строки в терминале (и F12 в самом окне) покажут причину
  wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: переход отменён самой страницей
    log('did-fail-load', code, desc, failedUrl);
    win.loadFailure = desc;
    if (!win.isDestroyed()) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorPage(desc, failedUrl)));
  });
  wc.on('render-process-gone', (_e, d) => log('render-process-gone', d && d.reason));
  wc.on('console-message', (e) => { if (e.level === 'error') log('page console:', String(e.message).slice(0, 200)); });
  wc.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F12') wc.toggleDevTools(); });
  ses().webRequest.onCompleted({ urls: ['*://soundcloud.com/*', '*://secure.soundcloud.com/*'] }, (d) => {
    if (d.resourceType === 'mainFrame') log('page', d.statusCode, d.url);
  });
  log('opening', url);
  win.loadURL(url).catch((e) => log('loadURL rejected:', e && e.message));
  return win;
}

// на главной странице сайта нажимаем «Sign in», чтобы пользователю не пришлось искать кнопку
const CLICK_SIGN_IN = `(() => {
  const re = /^\\s*(sign in|log in|войти)\\s*$/i;
  const el = [...document.querySelectorAll('button, a')].find((e) => re.test(e.textContent || ''));
  if (el) el.click();
  return !!el;
})()`;

let loginBusy = false;
async function loginWeb(parent) {
  // уже вошли раньше: окно не нужно
  try {
    const token = await webToken();
    if (token) { await webGetter(token, await webClientId())('/me'); return { ok: true }; }
  } catch (e) { /* значит, нужен вход */ }

  const win = openWindow(parent, 'https://soundcloud.com/');
  let clicked = false;
  win.webContents.on('did-finish-load', () => {
    if (clicked || win.isDestroyed()) return;
    setTimeout(() => {
      if (clicked || win.isDestroyed()) return;
      win.webContents.executeJavaScript(CLICK_SIGN_IN).then((ok) => { if (ok) clicked = true; }).catch(() => {});
    }, 1500);
  });
  return new Promise((resolve) => {
    let done = false;
    let busy = false;
    const finish = (r) => { if (done) return; done = true; clearInterval(timer); clearTimeout(limit); if (!win.isDestroyed()) win.destroy(); resolve(r); };
    // пока пользователь входит, раз в пару секунд проверяем, появилась ли рабочая сессия
    const timer = setInterval(async () => {
      if (busy || done) return;
      busy = true;
      try {
        const token = await webToken();
        if (token) {
          try { await webGetter(token, await webClientId())('/me'); finish({ ok: true }); }
          catch (e) { if (!(e instanceof AuthError)) finish({ ok: false, error: e.message }); } // AuthError: сессия ещё гостевая
        }
      } finally { busy = false; }
    }, 1500);
    const limit = setTimeout(() => finish({ ok: false, error: 'Sign-in timed out' }), 10 * 60 * 1000);
    win.on('closed', () => finish(win.loadFailure ? { ok: false, error: win.loadFailure } : { ok: false, cancelled: true }));
  });
}

/* ---------- Способ 2: официальный API ---------- */
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function tokenRequest(params) {
  const res = await net.fetch('https://secure.soundcloud.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json; charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(j.error_description || j.error || 'HTTP ' + res.status);
  return j;
}
function saveTokens(t) {
  const c = readConf();
  c.mode = 'api';
  c.access = seal(t.access_token);
  if (t.refresh_token) c.refresh = seal(t.refresh_token);
  c.expires = Date.now() + (Number(t.expires_in) || 3600) * 1000;
  writeConf();
}
async function apiToken() {
  const c = readConf();
  if (!c.access) throw new AuthError('Not signed in');
  if (Date.now() < (c.expires || 0) - 60000) return unseal(c.access);
  if (!c.refresh) throw new AuthError('Session expired');
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', client_id: c.apiClientId, client_secret: unseal(c.apiSecret), refresh_token: unseal(c.refresh) });
    saveTokens(t);
    return t.access_token;
  } catch (e) { throw new AuthError(e.message); }
}
const apiGetter = () => async (p) => {
  const url = new URL(p, 'https://api.soundcloud.com');
  return getJson(url.toString(), { Authorization: 'OAuth ' + (await apiToken()) });
};

async function loginApi(parent) {
  const c = readConf();
  const clientId = c.apiClientId;
  const secret = unseal(c.apiSecret);
  if (!clientId || !secret) return { ok: false, error: 'no-keys' };

  const verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(12));
  const authUrl = 'https://secure.soundcloud.com/authorize?' + new URLSearchParams({
    client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state,
  }).toString();

  // вход проходит в обычном браузере пользователя; код возвращается на локальный адрес, который слушает приложение
  const result = await new Promise((resolve) => {
    const redirect = new URL(REDIRECT_URI);
    let done = false;
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname !== redirect.pathname) { res.writeHead(404).end(); return; }
      const q = u.searchParams;
      const ok = q.get('state') === state && q.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Music Player</title><body style="font:16px system-ui;padding:48px;text-align:center">${ok ? 'Done! You can close this tab and return to Music Player.' : 'Sign-in failed. Return to Music Player and try again.'}`);
      finish(ok ? { code: q.get('code') } : { error: q.get('error_description') || q.get('error') || 'state mismatch' });
    });
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); server.close(); if (parent && !parent.isDestroyed()) parent.focus(); resolve(v); };
    const timer = setTimeout(() => finish({ error: 'Sign-in timed out' }), 5 * 60 * 1000);
    server.on('error', (e) => finish({ error: e.code === 'EADDRINUSE' ? 'Port ' + redirect.port + ' is busy' : e.message }));
    server.listen(Number(redirect.port), '127.0.0.1', () => shell.openExternal(authUrl).catch((e) => finish({ error: e.message })));
  });
  if (result.cancelled) return { ok: false, cancelled: true };
  if (!result.code) return { ok: false, error: result.error || 'No authorization code' };
  try {
    saveTokens(await tokenRequest({
      grant_type: 'authorization_code', client_id: clientId, client_secret: secret,
      redirect_uri: REDIRECT_URI, code_verifier: verifier, code: result.code,
    }));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/* ---------- Общие действия ---------- */
async function status() {
  const c = readConf();
  let connected = false;
  try {
    if (c.mode === 'web') connected = !!(await webToken());
    else if (c.mode === 'api') connected = !!c.access;
  } catch (e) { connected = false; }
  return { connected, mode: c.mode || null, apiClientId: c.apiClientId || '', hasSecret: !!c.apiSecret, redirectUri: REDIRECT_URI };
}

async function library() {
  const c = readConf();
  try {
    if (c.mode === 'web') {
      const token = await webToken();
      if (!token) throw new AuthError('Signed out');
      return { ok: true, library: await fetchLibrary(webGetter(token, await webClientId()), 'web') };
    }
    if (c.mode === 'api') return { ok: true, library: await fetchLibrary(apiGetter(), 'api') };
    return { ok: false, error: 'Not connected' };
  } catch (e) {
    return { ok: false, auth: e instanceof AuthError, error: String((e && e.message) || e) };
  }
}

async function logout() {
  const c = readConf();
  ['mode', 'access', 'refresh', 'expires'].forEach((k) => delete c[k]); // ключи своего приложения остаются
  writeConf();
  try { await ses().clearStorageData(); } catch (e) { /* ничего */ }
}

function saveApiKeys(cfg) {
  const c = readConf();
  c.apiClientId = String((cfg && cfg.clientId) || '').trim().slice(0, 100);
  const secret = String((cfg && cfg.clientSecret) || '').trim().slice(0, 200);
  if (secret) c.apiSecret = seal(secret);
  if (!c.apiClientId) delete c.apiSecret;
  writeConf();
}

function register(ipcMain, winOf) {
  ipcMain.handle('sc:status', () => status());
  ipcMain.handle('sc:library', () => library());
  ipcMain.handle('sc:logout', async () => { await logout(); return true; });
  ipcMain.handle('sc:save-api', (_e, cfg) => { saveApiKeys(cfg); return status(); });
  ipcMain.handle('sc:login', async (e, mode) => {
    if (loginBusy) return { ok: false, error: 'Sign-in is already in progress' };
    loginBusy = true;
    try {
      const parent = winOf(e);
      const r = mode === 'api' ? await loginApi(parent) : await loginWeb(parent);
      if (r.ok && mode !== 'api') { const c = readConf(); c.mode = 'web'; writeConf(); }
      return r;
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    } finally { loginBusy = false; }
  });
}

module.exports = { register, _test: { fetchLibrary, collect, trackOf, toPlaylist, toUser, art, AuthError } };
