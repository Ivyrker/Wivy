// Подключение SoundCloud (основной процесс): вход через окно сайта soundcloud.com внутри приложения.
// Приложение берёт сессию этого окна и ходит в тот же api-v2, что и сайт (способ неофициальный).
// Токены в окно приложения не попадают: наружу отдаются готовые списки треков и ссылки на звук.
const { app, BrowserWindow, session, net } = require('electron');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:soundcloud';            // отдельное хранилище cookie для окна входа
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

async function fetchLibrary(get) {
  const warnings = [];
  const me = await get('/me');                    // если тут отказ, значит мы не вошли
  const safe = async (name, first, limit) => {
    try { return await collect(get, first, limit); } catch (e) {
      if (e instanceof AuthError) throw e;
      warnings.push(name + ': ' + e.message);
      return [];
    }
  };
  const [recent, recommended, liked, own, likedPl, following] = await Promise.all([
    safe('recent', `/me/play-history/tracks?limit=${LIMITS.recent}`, LIMITS.recent),
    safe('recommended', `/stream?limit=${LIMITS.recommended}`, LIMITS.recommended),
    safe('liked', `/users/${me.id}/track_likes?limit=50`, LIMITS.liked),
    safe('playlists', `/users/${me.id}/playlists_without_albums?limit=50`, LIMITS.playlists),
    safe('likedPlaylists', `/users/${me.id}/playlist_likes?limit=50`, LIMITS.playlists),
    safe('following', `/users/${me.id}/followings?limit=50`, LIMITS.following),
  ]);
  const tracks = (list) => uniq(list.map(trackOf), (t) => t.scId);
  return {
    me: { name: String(me.username || me.full_name || ''), avatar: art(me.avatar_url), url: String(me.permalink_url || '') },
    updated: Date.now(),
    recent: tracks(recent),
    recommended: tracks(recommended),
    liked: tracks(liked),
    playlists: uniq([...own, ...likedPl].map(toPlaylist), (p) => p.url || p.name).slice(0, LIMITS.playlists),
    following: uniq(following.map(toUser), (u) => u.url || u.name),
    warnings,
  };
}

/* ---------- Вход через окно сайта ---------- */
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

/* ---------- Звук ---------- */
// Ссылка на звук живёт недолго, поэтому запрашивается в момент, когда трек начинает играть.
// Берём обычный mp3 (progressive): он играет без дополнительных библиотек, потом HLS, потом всё остальное.
async function resolveStream(get, trackId) {
  const t = await get(`/tracks/${Number(trackId)}`);
  const list = ((t.media && t.media.transcodings) || []).filter((x) => x && x.url && x.format);
  const rank = (x) => (x.snipped ? 100 : 0) + (x.format.protocol === 'progressive' ? 0 : 10) + (/mpeg/.test(x.format.mime_type || '') ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b));
  let lastError = null;
  for (const tc of list) {
    try {
      const u = new URL(tc.url);
      if (t.track_authorization) u.searchParams.set('track_authorization', t.track_authorization);
      const r = await get(u.toString());
      if (r && r.url) return { ok: true, url: r.url, protocol: tc.format.protocol, mime: tc.format.mime_type || '', snipped: !!tc.snipped };
    } catch (e) { if (e instanceof AuthError) throw e; lastError = e; }
  }
  return { ok: false, error: lastError ? lastError.message : 'No playable stream (the track may be restricted in your region)' };
}

async function stream(trackId) {
  try {
    const token = await webToken();
    if (!token) throw new AuthError('Signed out');
    return await resolveStream(webGetter(token, await webClientId()), trackId);
  } catch (e) {
    return { ok: false, auth: e instanceof AuthError, error: String((e && e.message) || e) };
  }
}

/* ---------- Общие действия ---------- */
async function status() {
  let connected = false;
  try { connected = readConf().mode === 'web' && !!(await webToken()); } catch (e) { connected = false; }
  return { connected, mode: connected ? 'web' : null };
}

async function library() {
  try {
    const token = await webToken();
    if (!token || readConf().mode !== 'web') throw new AuthError('Signed out');
    return { ok: true, library: await fetchLibrary(webGetter(token, await webClientId())) };
  } catch (e) {
    return { ok: false, auth: e instanceof AuthError, error: String((e && e.message) || e) };
  }
}

async function logout() {
  const c = readConf();
  delete c.mode;
  writeConf();
  try { await ses().clearStorageData(); } catch (e) { /* ничего */ }
}

function register(ipcMain, winOf) {
  ipcMain.handle('sc:status', () => status());
  ipcMain.handle('sc:library', () => library());
  ipcMain.handle('sc:stream', (_e, id) => stream(id));
  ipcMain.handle('sc:logout', async () => { await logout(); return true; });
  ipcMain.handle('sc:login', async (e) => {
    if (loginBusy) return { ok: false, error: 'Sign-in is already in progress' };
    loginBusy = true;
    try {
      const r = await loginWeb(winOf(e));
      if (r.ok) { const c = readConf(); c.mode = 'web'; writeConf(); }
      return r;
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    } finally { loginBusy = false; }
  });
}

module.exports = { register, _test: { fetchLibrary, collect, trackOf, toPlaylist, toUser, art, resolveStream, AuthError } };
