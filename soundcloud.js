// Подключение SoundCloud (основной процесс): вход через окно сайта soundcloud.com внутри приложения.
// Приложение берёт сессию этого окна и ходит в тот же api-v2, что и сайт (способ неофициальный).
// Токены в окно приложения не попадают: наружу отдаются готовые списки треков и ссылки на звук.
const { app, BrowserWindow, session, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:soundcloud';            // отдельное хранилище cookie для окна входа
const LIMITS = { recent: 40, recommended: 40, liked: 1000, playlists: 100, following: 200 };

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
  for (let guard = 0; next && out.length < limit && guard < Math.max(12, Math.ceil(limit / 50) + 2); guard++) {
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
const art = (u, size) => {
  const big = u ? String(u).replace('-large.', '-' + (size || 't300x300') + '.') : '';
  return SAFE_IMG.test(big) ? big : '';
};
function toTrack(t) {
  if (!t || !t.id || !t.title) return null;
  const u = t.user || {};
  return {
    scId: t.id,
    title: String(t.title),
    artist: String(u.username || (t.publisher_metadata && t.publisher_metadata.artist) || ''),
    artistId: u.id || 0,
    artistUrl: String(u.permalink_url || ''),
    dur: Math.round((t.full_duration || t.duration || 0) / 1000),
    art: art(t.artwork_url || u.avatar_url),
    url: String(t.permalink_url || ''),
    plays: t.playback_count || 0,
    likes: t.likes_count || t.favoritings_count || 0,
    date: String(t.release_date || t.created_at || t.display_date || ''),
    genre: String(t.genre || ''),
    lock: regionBlocked(t) ? 'region' : drmOnly(t) ? 'drm' : '',   // трек, который здесь не сыграть: закрыт для региона или только защищённые потоки
  };
}
// элемент списка бывает самим треком ({title…}), обёрткой ({track}) или событием ленты ({type, origin})
const trackOf = (it) => it && toTrack(it.track || (/track/.test(it.type || '') && it.origin) || (!it.type && it) || null);
function toPlaylist(it) {
  const p = it && (it.playlist || (/playlist/.test(it.type || '') && it.origin) || (!it.type && it));
  if (!p || !p.id || !p.title) return null;
  const first = (p.tracks || [])[0] || {};
  const u = p.user || {};
  return {
    scId: p.id,
    name: String(p.title),
    count: p.track_count || (p.tracks || []).length || 0,
    art: art(p.artwork_url || first.artwork_url),
    url: String(p.permalink_url || ''),
    isAlbum: !!p.is_album || /^(album|ep|single|compilation)$/i.test(String(p.set_type || '')),
    artist: String(u.username || ''),
    artistId: u.id || 0,
    artistUrl: String(u.permalink_url || ''),
    date: String(p.release_date || p.published_at || p.created_at || ''),
  };
}
function toUser(u) {
  if (!u || !u.id || !u.username) return null;
  return {
    scId: u.id,
    name: String(u.username),
    art: art(u.avatar_url),
    url: String(u.permalink_url || ''),
    followers: u.followers_count || 0,
    trackCount: u.track_count || 0,
    city: String(u.city || ''),
    country: String(u.country_code || ''),
  };
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
    v: 4,                                          // версия формата списков (в кэше интерфейса)
    likedComplete: liked.length < LIMITS.liked,    // false: список обрезан лимитом, и отсутствие трека в нём ничего не доказывает
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
// Играть умеем обычный файл (progressive) и HLS с mp3/aac. Зашифрованные потоки (DRM) и HLS с opus окно приложения не воспроизведёт,
// поэтому их не выбираем. Перед выдачей ссылку проверяем: если она не открывается, берём следующий вариант.
const isPlayable = (x) => {
  const p = x.format.protocol;
  const m = String(x.format.mime_type || '');
  return p === 'progressive' || (p === 'hls' && /mpeg|mp4|aac/i.test(m));
};
// у трека описаны потоки, и среди них нет ни одного, который можно играть (записи лейблов бывают только такими)
// SoundCloud помечает закрытые для региона треки полями access и policy
const regionBlocked = (t) => !!t && (t.access === 'blocked' || t.policy === 'BLOCK');
const drmOnly = (t) => {
  const list = ((t && t.media && t.media.transcodings) || []).filter((x) => x && x.format);
  return list.length > 0 && !list.some(isPlayable);
};
const describe = (x) => `${x.format.protocol} ${x.format.mime_type || '?'}${x.snipped ? ' (preview)' : ''}`;

async function reachable(url) {
  try {
    const res = await net.fetch(url, { headers: { Range: 'bytes=0-1', 'User-Agent': chromeUA() } });
    try { if (res.body) await res.body.cancel(); } catch (e) { /* ничего */ }
    return res.status === 200 || res.status === 206 ? '' : 'HTTP ' + res.status;
  } catch (e) { return String((e && e.message) || e); }
}

async function resolveStream(get, trackId) {
  const t = await get(`/tracks/${Number(trackId)}`);
  const all = ((t.media && t.media.transcodings) || []).filter((x) => x && x.url && x.format);
  const list = all.filter(isPlayable);
  // полный трек раньше превью, обычный файл раньше HLS, mp3 раньше aac
  const rank = (x) => (x.snipped ? 100 : 0) + (x.format.protocol === 'progressive' ? 0 : 10) + (/mpeg/.test(x.format.mime_type || '') ? 0 : 1);
  list.sort((a, b) => rank(a) - rank(b));
  const notes = [];
  let lastError = null;
  for (const tc of list) {
    try {
      const u = new URL(tc.url);
      if (t.track_authorization) u.searchParams.set('track_authorization', t.track_authorization);
      const r = await get(u.toString());
      if (!r || !r.url) { notes.push(describe(tc) + ': no link'); continue; }
      const bad = await reachable(r.url);
      if (bad) { notes.push(describe(tc) + ': ' + bad); lastError = new Error(bad); continue; }
      return { ok: true, url: r.url, protocol: tc.format.protocol, mime: tc.format.mime_type || '', snipped: !!tc.snipped };
    } catch (e) { if (e instanceof AuthError) throw e; notes.push(describe(tc) + ': ' + e.message); lastError = e; }
  }
  // в терминале видно, какие варианты были у трека и почему ни один не подошёл
  log('no playable stream for track', trackId, '| available:', all.map(describe).join(', ') || 'none', '| tried:', notes.join('; ') || 'nothing');
  if (regionBlocked(t) || !all.length) return { ok: false, lock: 'region', error: 'This track is not available in your region' };
  if (!list.length && all.length) {
    return { ok: false, lock: 'drm', error: 'Only protected or unsupported formats are available for this track (' + [...new Set(all.map((x) => x.format.protocol))].join(', ') + ')' };
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

/* ---------- Страницы: трек, исполнитель, плейлист/альбом, поиск ---------- */
// Только ссылки на сам сайт: по ним можно открыть страницу и разрешить адрес в объект.
const SC_LINK = /^https:\/\/(www\.|m\.)?soundcloud\.com\/\S+$/i;
const parseTags = (s) => [...String(s || '').matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] || m[2]);

function trackFull(t) {
  const u = t.user || {};
  return {
    ...toTrack(t),
    artBig: art(t.artwork_url || u.avatar_url, 't500x500'),
    desc: String(t.description || '').slice(0, 4000),
    tags: parseTags(t.tag_list).slice(0, 12),
    reposts: t.reposts_count || 0,
    comments: t.comment_count || 0,
  };
}
function userFull(u) {
  return { ...toUser(u), artBig: art(u.avatar_url, 't500x500'), desc: String(u.description || '').slice(0, 4000) };
}
function playlistFull(p, tracks) {
  const base = toPlaylist(p);
  return {
    ...base,
    artBig: art(p.artwork_url, 't500x500') || (tracks[0] && tracks[0].art) || base.art,
    desc: String(p.description || '').slice(0, 4000),
    totalDur: Math.round((p.duration || 0) / 1000),
  };
}

// объект по номеру или по ссылке на soundcloud.com
async function byRef(get, ref, base, kind) {
  if (ref.id) return get(`/${base}/${ref.id}`);
  if (!SC_LINK.test(ref.url)) throw new Error('Unsupported link');
  const r = await get('/resolve?url=' + encodeURIComponent(ref.url));
  if (!r || r.kind !== kind) throw new Error('This link leads to a different kind of page');
  return r;
}

// у плейлиста полностью описаны только первые треки, у остальных есть лишь номер: догружаем пачками
async function hydrate(get, items) {
  const need = items.filter((x) => x && x.id && !x.title).map((x) => x.id).slice(0, 300);
  const got = new Map();
  for (let i = 0; i < need.length; i += 30) {
    try {
      const part = await get(`/tracks?ids=${need.slice(i, i + 30).join(',')}`);
      (Array.isArray(part) ? part : []).forEach((x) => x && x.id && got.set(x.id, x));
    } catch (e) { if (e instanceof AuthError) throw e; }
  }
  return items.map((x) => (x && x.title ? x : got.get(x && x.id))).filter(Boolean);
}

const tracksOf = (list) => uniq(list.map(trackOf), (x) => x.scId);

function safeCollect(get, warnings) {
  return async (first, limit) => {
    try { return await collect(get, first, limit); } catch (e) {
      if (e instanceof AuthError) throw e;
      warnings.push(e.message);
      return [];
    }
  };
}

async function trackPage(get, ref) {
  const t = await byRef(get, ref, 'tracks', 'track');
  const safe = safeCollect(get, []);
  const related = await safe(`/tracks/${t.id}/related?limit=20`, 20);
  return { track: trackFull(t), related: tracksOf(related).filter((x) => x.scId !== t.id) };
}

async function userPage(get, ref) {
  const u = await byRef(get, ref, 'users', 'user');
  const warnings = [];
  const safe = safeCollect(get, warnings);
  const [top, latest, albums, lists] = await Promise.all([
    safe(`/users/${u.id}/toptracks?limit=10`, 10),
    safe(`/users/${u.id}/tracks?limit=50`, 50),
    safe(`/users/${u.id}/albums?limit=30`, 30),
    safe(`/users/${u.id}/playlists_without_albums?limit=30`, 30),
  ]);
  const lists_ = (l) => uniq(l.map(toPlaylist), (p) => p.scId);
  return { artist: userFull(u), popular: tracksOf(top), tracks: tracksOf(latest), albums: lists_(albums), playlists: lists_(lists), warnings };
}

async function playlistPage(get, ref) {
  const p = await byRef(get, ref, 'playlists', 'playlist');
  const tracks = tracksOf(await hydrate(get, p.tracks || []));
  return { playlist: playlistFull(p, tracks), tracks };
}

async function searchAll(get, q) {
  const enc = encodeURIComponent(q);
  const warnings = [];
  const safe = safeCollect(get, warnings);
  const [tr, us, pl, al] = await Promise.all([
    safe(`/search/tracks?q=${enc}&limit=20`, 20),
    safe(`/search/users?q=${enc}&limit=10`, 10),
    safe(`/search/playlists_without_albums?q=${enc}&limit=10`, 10),
    safe(`/search/albums?q=${enc}&limit=10`, 10),
  ]);
  return {
    tracks: tracksOf(tr),
    users: uniq(us.map(toUser), (u) => u.scId),
    playlists: uniq(pl.map(toPlaylist), (p) => p.scId),
    albums: uniq(al.map(toPlaylist), (p) => p.scId),
    warnings,
  };
}

// общая обёртка: проверяем вход, достаём client_id и превращаем любую ошибку в { ok: false }
async function viaWeb(fn) {
  try {
    const token = await webToken();
    if (!token || readConf().mode !== 'web') throw new AuthError('Signed out');
    return await fn(webGetter(token, await webClientId()));
  } catch (e) {
    return { ok: false, auth: e instanceof AuthError, error: String((e && e.message) || e) };
  }
}
const cleanRef = (r) => {
  const id = Math.floor(Number(r && r.id));
  return { id: id > 0 ? id : 0, url: r && typeof r.url === 'string' ? r.url.trim().slice(0, 400) : '' };
};

/* ---------- Лайки ---------- */
// Тот же запрос, что делает сайт: PUT ставит лайк, DELETE снимает (повтор ничего не ломает). Чтение у SoundCloud открыто любому клиенту,
// а запись он иногда принимает только от настоящей страницы сайта, поэтому: сперва обычный запрос с cookie окна входа и заголовками сайта,
// а если сервер отказал, тот же запрос выполняется изнутри скрытой страницы soundcloud.com (как сделал бы браузер).
let meIdCache = 0;
let bridgeWin = null;
let bridgeTimer = null;

async function bridge() {
  if (bridgeWin && !bridgeWin.isDestroyed()) return bridgeWin;
  const win = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.webContents.setUserAgent(chromeUA());
  win.on('closed', () => { if (bridgeWin === win) bridgeWin = null; });
  bridgeWin = win;
  await win.loadURL('https://soundcloud.com/');
  return win;
}

// выполняется внутри страницы: client_id берём тот, с которым сайт сам обращается к api-v2
function inPageRequest(want) {
  return (async () => {
    let cid = '';
    for (let i = 0; i < 16 && !cid; i++) {
      for (const e of performance.getEntriesByType('resource')) {
        const m = /api-v2\.soundcloud\.com\/.*[?&]client_id=([A-Za-z0-9]{32})/.exec(e.name);
        if (m) cid = m[1];
      }
      if (!cid) await new Promise((r) => setTimeout(r, 500));
    }
    const url = new URL(want.path, 'https://api-v2.soundcloud.com');
    url.searchParams.set('client_id', cid || want.fallbackClientId);
    const res = await fetch(url, { method: want.method, credentials: 'include', headers: { Authorization: 'OAuth ' + want.token, Accept: 'application/json' } });
    return { status: res.status, text: (await res.text()).slice(0, 200), siteClientId: !!cid };
  })();
}

async function pageRequest(want) {
  const win = await bridge();
  clearTimeout(bridgeTimer);
  bridgeTimer = setTimeout(() => { if (bridgeWin && !bridgeWin.isDestroyed()) bridgeWin.destroy(); }, 3 * 60 * 1000);   // окно живёт недолго
  return win.webContents.executeJavaScript(`(${inPageRequest.toString()})(${JSON.stringify(want)})`);
}

async function writeLike(token, clientId, userId, trackId, on) {
  const method = on ? 'PUT' : 'DELETE';
  const path = `/users/${userId}/track_likes/${trackId}`;
  const ok = (s) => s >= 200 && s < 300;
  let status = 0;
  let body = '';
  try {
    const url = new URL(path, 'https://api-v2.soundcloud.com');
    url.searchParams.set('client_id', clientId);
    const res = await ses().fetch(url.toString(), {
      method, credentials: 'include',
      headers: { Authorization: 'OAuth ' + token, Accept: 'application/json', 'User-Agent': chromeUA(), Origin: 'https://soundcloud.com', Referer: 'https://soundcloud.com/' },
    });
    status = res.status;
    body = (await res.text()).slice(0, 160);
  } catch (e) { body = String((e && e.message) || e); }
  log('like', method, trackId, 'direct ->', status, body.replace(/\s+/g, ' '));
  if (ok(status)) return;
  if (status === 401) throw new AuthError('Session expired (HTTP 401)');

  const r = await pageRequest({ method, path, token, fallbackClientId: clientId });
  log('like', method, trackId, 'via page ->', r.status, r.siteClientId ? '(site client_id)' : '(own client_id)', String(r.text || '').replace(/\s+/g, ' '));
  if (ok(r.status)) return;
  if (r.status === 401) throw new AuthError('Session expired (HTTP 401)');
  throw new Error('HTTP ' + r.status);
}

async function setLike(trackId, on) {
  const id = Math.floor(Number(trackId));
  if (!(id > 0)) return { ok: false, error: 'Bad track id' };
  try {
    const token = await webToken();
    if (!token || readConf().mode !== 'web') throw new AuthError('Signed out');
    const clientId = await webClientId();
    if (!meIdCache) meIdCache = (await webGetter(token, clientId)('/me')).id;
    await writeLike(token, clientId, meIdCache, id, on);
    return { ok: true };
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
  meIdCache = 0;
  const c = readConf();
  delete c.mode;
  writeConf();
  try { await ses().clearStorageData(); } catch (e) { /* ничего */ }
}

function register(ipcMain, winOf) {
  ipcMain.handle('sc:status', () => status());
  ipcMain.handle('sc:library', () => library());
  ipcMain.handle('sc:stream', (_e, id) => stream(id));
  ipcMain.handle('sc:like', (_e, track, on) => setLike(track && track.scId, !!on));

  // страницы: трек, исполнитель, плейлист или альбом (по номеру или по ссылке на soundcloud.com)
  const page = (channel, fn) => ipcMain.handle(channel, (_e, ref) => {
    const r = cleanRef(ref);
    if (!r.id && !r.url) return { ok: false, error: 'No link' };
    return viaWeb(async (get) => ({ ok: true, data: await fn(get, r) }));
  });
  page('sc:track', trackPage);
  page('sc:user', userPage);
  page('sc:playlist', playlistPage);
  ipcMain.handle('sc:search', (_e, q) => {
    const s = String(q || '').trim().slice(0, 100);
    if (s.length < 2) return { ok: false, error: 'Query is too short' };
    return viaWeb(async (get) => ({ ok: true, data: await searchAll(get, s) }));
  });
  // «Открыть на SoundCloud»: только адреса самого сайта
  ipcMain.handle('sc:open-link', async (_e, url) => {
    const u = typeof url === 'string' ? url.trim() : '';
    if (!SC_LINK.test(u)) return false;
    await shell.openExternal(u);
    return true;
  });
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

module.exports = { register, _test: { fetchLibrary, collect, trackOf, toPlaylist, toUser, art, resolveStream, AuthError, trackPage, userPage, playlistPage, searchAll, hydrate, setLike } };
