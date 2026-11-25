// Подключение YouTube Music (основной процесс).
// Вход: окно сайта music.youtube.com внутри приложения (отдельное хранилище cookie, как у SoundCloud и VK).
// Библиотека, поиск, плейлисты и лайки: тот же внутренний API (InnerTube, клиент WEB_REMIX), что использует сам сайт.
//   Запросы подписываются заголовком SAPISIDHASH из cookie входа: схема описана в sigma67/ytmusicapi.
// Звук и видео: играет НАСТОЯЩАЯ страница music.youtube.com в <webview> под интерфейсом, приложение лишь управляет её <video>.
//   Так не нужно расшифровывать адреса потоков, получать PO-токены и поддерживать SABR (всё это ломается у клиентов,
//   которые тянут потоки сами). Подход тот же, что у th-ch/youtube-music и ytmdesktop. Страница лежит под интерфейсом на всё окно: это и есть фон-видео.
// Cookie в окно приложения не попадают: наружу отдаются готовые списки и состояние плеера.
const { BrowserWindow, session, shell, webContents } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PARTITION = 'persist:ytmusic';
const ORIGIN = 'https://music.youtube.com';
const LIMITS = { liked: 1000, playlists: 100, following: 200, recent: 60, search: 40 };
const FALLBACK_VERSION = '1.20250101.01.00';

class AuthError extends Error {}
const log = (...a) => console.log('[YouTube Music]', ...a);

/* ---------- Сеть ---------- */
// сеть при запуске бывает ещё не готова, а DNS провайдера может отвечать с задержкой: сетевые сбои повторяем, а не принимаем за отказ входа
const NET_ERR = /ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|NETWORK_CHANGED|CONNECTION_\w+|TIMED_OUT|PROXY_\w+|ADDRESS_UNREACHABLE|SSL_\w+|CERT_\w+)|fetch failed/i;
async function netFetch(url, opts) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await ses().fetch(url, opts); } catch (e) {
      last = e;
      if (!NET_ERR.test(String((e && e.message) || e))) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  const code = (NET_ERR.exec(String((last && last.message) || last)) || [])[0] || 'network error';
  const err = new Error(`Can’t reach music.youtube.com (${code}). Check your internet connection, VPN or DNS.`);
  err.network = true;
  throw err;
}
const ses = () => session.fromPartition(PARTITION);
// обычный Chrome без пометок Electron: так вход через Google реже отвергается
const chromeUA = () => ses().getUserAgent().replace(/\s*Electron\/\S+/, '').replace(/\s*wivy\/\S+/i, '');

// Cookie входа в аккаунт Google: без них сайт не узнаёт пользователя. Всё остальное (реклама, дубли с поддоменов) для входа не нужно,
// а раздутый заголовок Cookie сервер отвергает ответом HTTP 413.
const KEEP = new Set(['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PAPISID', '__Secure-3PAPISID',
  '__Secure-1PSIDTS', '__Secure-3PSIDTS', '__Secure-1PSIDCC', '__Secure-3PSIDCC', 'SIDCC', 'LOGIN_INFO', 'PREF', 'VISITOR_INFO1_LIVE',
  'VISITOR_PRIVACY_METADATA', 'YSC', 'SOCS', 'CONSENT']);
const COOKIE_LIMIT = 7000;   // байт в заголовке Cookie; серверы Google отвечают 413 примерно с 8-16 КБ

// если заголовок Cookie слишком велик, удаляем самые тяжёлые необязательные cookie; true, если что-то удалили
async function trimCookies() {
  const list = await ses().cookies.get({ url: ORIGIN });
  const size = (c) => c.name.length + c.value.length + 3;
  let total = list.reduce((n, c) => n + size(c), 0);
  if (total <= COOKIE_LIMIT) return false;
  const drop = list.filter((c) => !KEEP.has(c.name)).sort((a, b) => size(b) - size(a));
  let removed = false;
  for (const c of drop) {
    if (total <= COOKIE_LIMIT) break;
    const url = 'https://' + String(c.domain || 'music.youtube.com').replace(/^\./, '') + (c.path || '/');
    try { await ses().cookies.remove(url, c.name); total -= size(c); removed = true; } catch (e) { /* пропускаем */ }
  }
  return removed;
}

async function authCookie() {
  const list = await ses().cookies.get({ url: ORIGIN });
  const pick = (n) => (list.find((c) => c.name === n && c.value) || {}).value || '';
  return pick('__Secure-3PAPISID') || pick('SAPISID');
}
async function sapisidHash() {
  const sid = await authCookie();
  if (!sid) throw new AuthError('Not signed in');
  const ts = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(`${ts} ${sid} ${ORIGIN}`).digest('hex');
  return `SAPISIDHASH ${ts}_${hash}`;
}

let ctx = null;   // { version, visitor, at }
async function webContext() {
  if (ctx && Date.now() - ctx.at < 3600e3) return ctx;
  let html = '';
  try { html = await (await netFetch(ORIGIN + '/', { headers: { 'User-Agent': chromeUA(), 'Accept-Language': 'en-US,en;q=0.9' } })).text(); } catch (e) { /* возьмём запасные значения */ }
  const grab = (re) => { const m = re.exec(html); return m ? m[1] : ''; };
  ctx = {
    version: grab(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/) || grab(/"clientVersion":"(1\.[\d.]+)"/) || FALLBACK_VERSION,
    visitor: grab(/"VISITOR_DATA":"([^"]+)"/) || grab(/"visitorData":"([^"]+)"/),
    at: Date.now(),
  };
  return ctx;
}

async function call(endpoint, body, query, retried) {
  const c = await webContext();
  const auth = await sapisidHash();
  const payload = { context: { client: { clientName: 'WEB_REMIX', clientVersion: c.version, hl: 'en', ...(c.visitor ? { visitorData: c.visitor } : {}) }, user: {} }, ...body };
  const res = await netFetch(`${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false${query || ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'User-Agent': chromeUA(), Accept: '*/*', 'Accept-Language': 'en-US,en;q=0.9',
      Authorization: auth, 'X-Goog-AuthUser': '0', 'X-Origin': ORIGIN, Origin: ORIGIN, Referer: ORIGIN + '/',
      'X-Youtube-Client-Name': '67', 'X-Youtube-Client-Version': c.version, ...(c.visitor ? { 'X-Goog-Visitor-Id': c.visitor } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 413 && !retried && await trimCookies().catch(() => false)) return call(endpoint, body, query, true);   // раздутые cookie: чистим и повторяем
  if (res.status === 401 || res.status === 403) throw new AuthError('Session expired');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

/* ---------- Разбор ответов InnerTube ---------- */
function collectKey(node, key, out = []) {
  if (Array.isArray(node)) node.forEach((n) => collectKey(n, key, out));
  else if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) { if (k === key) out.push(node[k]); else collectKey(node[k], key, out); }
  }
  return out;
}
const textOf = (o) => (o && o.runs ? o.runs.map((r) => r.text).join('') : '');
const contToken = (data) => {
  const c = collectKey(data, 'continuationCommand')[0];
  if (c && c.token) return c.token;
  const n = collectKey(data, 'nextContinuationData')[0];
  return (n && n.continuation) || '';
};

// картинки только с серверов Google: адрес попадает в стиль страницы
const SAFE_IMG = /^https:\/\/(?:[a-z0-9-]+\.)*(?:ytimg\.com|ggpht\.com|googleusercontent\.com)\/[^\s"'()<>\\]+$/i;
function artOf(thumbHolder) {
  const list = collectKey(thumbHolder, 'thumbnails')[0] || [];
  let url = (list[list.length - 1] || {}).url || '';
  if (/=w\d+-h\d+/.test(url)) url = url.replace(/=w\d+-h\d+[^\s]*$/, '=w400-h400-l90-rj');
  return SAFE_IMG.test(url) ? url : '';
}
const parseDur = (s) => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d\d)$/.exec(String(s || '').trim());
  return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : 0;
};
const flexRuns = (r, i) => ((((r.flexColumns || [])[i] || {}).musicResponsiveListItemFlexColumnRenderer || {}).text || {}).runs || [];
const browseIdOf = (run) => (((run || {}).navigationEndpoint || {}).browseEndpoint || {}).browseId || '';
const SEP = /^[\s•·]+$/;
const TYPE_WORDS = /^(song|video|album|single|ep|playlist|artist|profile|episode|podcast)$/i;

// адрес страницы исполнителя по номеру канала (UC...): по нему приложение открывает его страницу
const artistUrlOf = (id) => (/^UC[\w-]{10,}$/.test(String(id || '')) ? `${ORIGIN}/channel/${id}` : '');
const firstArtistUrl = (runs) => artistUrlOf(((runs || []).map(browseIdOf).find((x) => /^UC/.test(x))) || '');

function toTrack(r, fallback) {
  if (!r) return null;
  const nameRuns = flexRuns(r, 0);
  const videoId = (r.playlistItemData && r.playlistItemData.videoId)
    || (((nameRuns[0] || {}).navigationEndpoint || {}).watchEndpoint || {}).videoId
    || collectKey(r.overlay, 'videoId')[0] || '';
  if (!videoId) return null;
  const title = textOf({ runs: nameRuns });
  if (!title) return null;
  const meta = flexRuns(r, 1);
  const artists = meta.filter((x) => /^UC/.test(browseIdOf(x))).map((x) => x.text);
  let artist = artists.join(', ');
  if (!artist) {   // в списках библиотеки исполнитель идёт простым текстом
    const plain = meta.map((x) => x.text).filter((x) => x && !SEP.test(x) && !TYPE_WORDS.test(x) && !parseDur(x));
    artist = plain[0] || (fallback && fallback.artist) || '';
  }
  const fixed = textOf((((r.fixedColumns || [])[0] || {}).musicResponsiveListItemFixedColumnRenderer || {}).text);
  const dur = parseDur(fixed) || meta.map((x) => parseDur(x.text)).find(Boolean) || 0;
  return {
    ytId: videoId, title, artist, artistId: 0, artistUrl: firstArtistUrl(meta) || (fallback && fallback.artistUrl) || '', dur,
    art: artOf(r.thumbnail) || (fallback && fallback.art) || '',
    url: `${ORIGIN}/watch?v=${videoId}`, plays: 0, likes: 0, date: '', genre: '',
    lock: '',   // замков нет: если трек не играет, приложение разбирается с этим при воспроизведении, а не помечает его заранее
  };
}
const tracksOf = (data, fallback) => {
  const seen = new Set();
  return collectKey(data, 'musicResponsiveListItemRenderer').map((r) => toTrack(r, fallback)).filter((t) => t && !seen.has(t.ytId) && seen.add(t.ytId));
};

const playlistUrl = (id) => `${ORIGIN}/playlist?list=${encodeURIComponent(String(id).replace(/^VL/, ''))}`;
// плейлист, альбом или исполнитель из карточки (двухстрочной или строки списка)
function toEntity(r) {
  const two = !!r.title && !r.flexColumns;
  const nav = (r.navigationEndpoint && r.navigationEndpoint.browseEndpoint && r.navigationEndpoint.browseEndpoint.browseId)
    || (r.navigationEndpoint && r.navigationEndpoint.watchPlaylistEndpoint && ('VL' + r.navigationEndpoint.watchPlaylistEndpoint.playlistId))
    || (r.menu ? collectKey(r.menu, 'playlistId')[0] && 'VL' + collectKey(r.menu, 'playlistId')[0] : '') || '';
  const nameRuns = two ? (r.title && r.title.runs) || [] : flexRuns(r, 0);
  const subRuns = two ? (r.subtitle && r.subtitle.runs) || [] : flexRuns(r, 1);
  const name = textOf({ runs: nameRuns });
  if (!nav || !name) return null;
  const sub = subRuns.map((x) => x.text);
  const art = artOf(two ? r.thumbnailRenderer : r.thumbnail);
  if (/^UC/.test(nav)) return { kind: 'artist', e: { name, art, url: artistUrlOf(nav), followers: 0, trackCount: 0, city: '', country: '' } };
  const count = Number((sub.map((x) => /^(\d[\d,]*)\s*(?:songs?|tracks?)/i.exec(x)).find(Boolean) || [])[1] || 0);
  const artist = subRuns.filter((x) => /^UC/.test(browseIdOf(x))).map((x) => x.text).join(', ')
    || sub.find((x) => x && !SEP.test(x) && !TYPE_WORDS.test(x) && !/^\d/.test(x) && !/songs?$|tracks?$/i.test(x)) || '';
  if (/^MPRE/.test(nav)) return { kind: 'album', e: { name, count, art, url: `${ORIGIN}/browse/${nav}`, isAlbum: true, artist, artistId: 0, artistUrl: firstArtistUrl(subRuns), date: (sub.find((x) => /^\d{4}$/.test(x)) || '') } };
  if (/^(VL|PL|RD|OL|LM)/.test(nav)) return { kind: 'playlist', e: { name, count, art, url: playlistUrl(nav), isAlbum: false, artist, artistId: 0, artistUrl: firstArtistUrl(subRuns), date: '' } };
  return null;
}
const entitiesOf = (data) => {
  const raw = [...collectKey(data, 'musicTwoRowItemRenderer'), ...collectKey(data, 'musicResponsiveListItemRenderer').filter((r) => !((r.playlistItemData && r.playlistItemData.videoId)))];
  return raw.map(toEntity).filter(Boolean);
};
const uniq = (list, key) => { const seen = new Set(); return list.filter((x) => x && !seen.has(key(x)) && seen.add(key(x))); };

// все страницы одного раздела (продолжения), не больше limit элементов
async function browseAll(browseId, limit, take) {
  let data = await call('browse', { browseId });
  const out = [...take(data)];
  let tok = contToken(data);
  for (let guard = 0; tok && out.length < limit && guard < 25; guard++) {
    data = await call('browse', { continuation: tok }, `&ctoken=${encodeURIComponent(tok)}&continuation=${encodeURIComponent(tok)}`);
    out.push(...take(data));
    const next = contToken(data);
    tok = next && next !== tok ? next : '';
  }
  return out.slice(0, limit);
}

/* ---------- Главная страница: полки рекомендаций ---------- */
// «Видеоклипы для вас», «Альбомы для вас», «Новые релизы», «Плейлисты для вас», «Слушать снова» и другие: названия и состав даёт сам сайт
const SHELF_LIMIT = 14;     // сколько полок брать
const SHELF_ITEMS = 24;     // сколько элементов в полке
const twoRowTrack = (r, videoId) => {
  const sub = (r.subtitle && r.subtitle.runs) || [];
  let artist = sub.filter((x) => /^UC/.test(browseIdOf(x))).map((x) => x.text).join(', ');
  if (!artist) artist = (sub.map((x) => x.text).find((x) => x && !SEP.test(x) && !TYPE_WORDS.test(x) && !/^\d/.test(x) && !/views?|просмотр|plays?|прослуш/i.test(x))) || '';
  const title = textOf(r.title);
  if (!title) return null;
  return { ytId: videoId, title, artist, artistId: 0, artistUrl: firstArtistUrl(sub), dur: 0, art: artOf(r.thumbnailRenderer), url: `${ORIGIN}/watch?v=${videoId}`, plays: 0, likes: 0, date: '', genre: '', lock: '' };
};
function shelfOf(sh) {
  const title = textOf(collectKey(sh.header, 'title')[0]);
  if (!title) return null;
  const tracks = [], lists = [];
  for (const it of sh.contents || []) {
    const row = it.musicResponsiveListItemRenderer, two = it.musicTwoRowItemRenderer;
    if (row) {
      const t = toTrack(row);
      if (t) tracks.push(t);
      else { const e = toEntity(row); if (e && e.kind !== 'artist') lists.push(e.e); }
    } else if (two) {
      const vid = (((two.navigationEndpoint || {}).watchEndpoint) || {}).videoId;
      if (vid) { const t = twoRowTrack(two, vid); if (t) tracks.push(t); }
      else { const e = toEntity(two); if (e && e.kind !== 'artist') lists.push(e.e); }
    }
  }
  const t = uniq(tracks, (x) => x.ytId).slice(0, SHELF_ITEMS);
  const l = uniq(lists, (x) => x.url).slice(0, SHELF_ITEMS);
  return t.length || l.length ? { title, tracks: t, lists: l } : null;
}
const homeToken = (d) => {
  const sl = collectKey(d, 'sectionListRenderer')[0] || collectKey(d, 'sectionListContinuation')[0];
  const c = sl && sl.continuations && sl.continuations[0];
  return (c && c.nextContinuationData && c.nextContinuationData.continuation) || '';
};
async function homeShelves() {
  let data = await call('browse', { browseId: 'FEmusic_home' });
  const out = [];
  const take = (d) => collectKey(d, 'musicCarouselShelfRenderer').forEach((sh) => { const s = shelfOf(sh); if (s) out.push(s); });
  take(data);
  let tok = homeToken(data);
  // нижние полки (новые релизы, плейлисты) подгружаются продолжениями
  for (let guard = 0; tok && out.length < SHELF_LIMIT && guard < 5; guard++) {
    data = await call('browse', { continuation: tok }, `&ctoken=${encodeURIComponent(tok)}&continuation=${encodeURIComponent(tok)}`);
    take(data);
    const next = homeToken(data);
    tok = next && next !== tok ? next : '';
  }
  return out.slice(0, SHELF_LIMIT);
}

/* ---------- Библиотека ---------- */
async function fetchMe() {
  const data = await call('account/account_menu', {});
  const head = collectKey(data, 'activeAccountHeaderRenderer')[0];
  if (!head) throw new AuthError('Not signed in');   // без входа заголовка аккаунта нет
  return { name: textOf(head.accountName), avatar: artOf(head.accountPhoto), url: '' };
}

async function library() {
  const warnings = [];
  const me = await fetchMe();
  const safe = async (name, fn, def) => {
    try { return await fn(); } catch (e) { if (e instanceof AuthError) throw e; warnings.push(name + ': ' + e.message); return def; }
  };
  // «Понравившиеся» (лайки) в YouTube Music лежат в плейлисте Liked Music (LM). Раздел FEmusic_liked_videos — это «Песни библиотеки»
  // (добавленные в библиотеку), а не лайки, поэтому он только запасной вариант на случай, когда плейлист не открылся
  const likedLists = async () => {
    try { return await browseAll('VLLM', LIMITS.liked, (d) => tracksOf(d)); } catch (e) {
      if (e instanceof AuthError) throw e;
      return browseAll('FEmusic_liked_videos', LIMITS.liked, (d) => tracksOf(d));
    }
  };
  const [liked, recent, plRaw, folRaw, shelves] = await Promise.all([
    safe('liked', likedLists, []),
    safe('recent', () => browseAll('FEmusic_history', LIMITS.recent, (d) => tracksOf(d)), []),
    safe('playlists', () => browseAll('FEmusic_liked_playlists', LIMITS.playlists, entitiesOf), []),
    safe('following', () => browseAll('FEmusic_library_corpus_artists', LIMITS.following, entitiesOf), []),
    safe('home', homeShelves, []),
  ]);
  return {
    me, v: 8, likedComplete: liked.length < LIMITS.liked, updated: Date.now(),
    recent: uniq(recent, (t) => t.ytId).slice(0, LIMITS.recent),
    recommended: [],
    liked: uniq(liked, (t) => t.ytId),
    // Liked Music уже показан как «Понравившиеся», в плейлистах его не дублируем
    playlists: uniq(plRaw.filter((x) => x.kind !== 'artist').map((x) => x.e).filter((p) => !/[?&]list=LM$/.test(p.url)), (p) => p.url).slice(0, LIMITS.playlists),
    shelves,
    following: uniq(folRaw.filter((x) => x.kind === 'artist').map((x) => x.e), (u) => u.name),
    warnings,
  };
}

/* ---------- Поиск, страницы, лайки ---------- */
const SONGS_FILTER = 'EgWKAQIIAWoMEA4QChADEAQQCRAF';   // фильтр «Songs» (значение из sigma67/ytmusicapi)
async function search(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: true, data: { tracks: [], users: [], playlists: [], albums: [] } };
  const [mixed, songs] = await Promise.allSettled([call('search', { query: q }), call('search', { query: q, params: SONGS_FILTER })]);
  if (mixed.status === 'rejected' && songs.status === 'rejected') throw mixed.reason;
  const m = mixed.status === 'fulfilled' ? mixed.value : {};
  const s = songs.status === 'fulfilled' ? songs.value : {};
  const ents = entitiesOf(m);
  return { ok: true, data: {
    tracks: uniq([...tracksOf(s), ...tracksOf(m)], (t) => t.ytId).slice(0, LIMITS.search),
    users: uniq(ents.filter((x) => x.kind === 'artist').map((x) => x.e), (u) => u.name).slice(0, 12),
    playlists: uniq(ents.filter((x) => x.kind === 'playlist').map((x) => x.e), (p) => p.url).slice(0, 12),
    albums: uniq(ents.filter((x) => x.kind === 'album').map((x) => x.e), (p) => p.url).slice(0, 12),
  } };
}

function browseIdFromRef(ref) {
  const url = String((ref && ref.url) || '');
  const m = /[?&]list=([\w-]+)/.exec(url);
  if (m) return /^(VL|MPRE)/.test(m[1]) ? m[1] : 'VL' + m[1];
  const b = /\/browse\/([\w-]+)/.exec(url);
  return b ? b[1] : '';
}
async function playlist(ref) {
  const id = browseIdFromRef(ref);
  if (!id) return { ok: false, error: 'Unsupported link' };
  const first = await call('browse', { browseId: id });
  const head = collectKey(first, 'musicResponsiveHeaderRenderer')[0] || collectKey(first, 'musicDetailHeaderRenderer')[0] || collectKey(first, 'musicEditablePlaylistDetailHeaderRenderer')[0] || {};
  const h = head.header ? (collectKey(head, 'musicResponsiveHeaderRenderer')[0] || collectKey(head, 'musicDetailHeaderRenderer')[0] || head) : head;
  const name = textOf(h.title) || 'Playlist';
  const art = artOf(h.thumbnail) || '';
  const artist = (((h.straplineTextOne || {}).runs || []).map((x) => x.text).join('')) || ((h.subtitle && h.subtitle.runs) || []).filter((x) => /^UC/.test(browseIdOf(x))).map((x) => x.text).join(', ');
  const artistUrl = firstArtistUrl([...((h.straplineTextOne || {}).runs || []), ...((h.subtitle && h.subtitle.runs) || [])]);
  const fallback = { art, artist: /^MPRE/.test(id) ? artist : '', artistUrl: /^MPRE/.test(id) ? artistUrl : '' };
  const tracks = [...tracksOf(first, fallback)];
  let tok = contToken(first);
  for (let guard = 0; tok && guard < 25; guard++) {
    const d = await call('browse', { continuation: tok }, `&ctoken=${encodeURIComponent(tok)}&continuation=${encodeURIComponent(tok)}`);
    tracks.push(...tracksOf(d, fallback));
    const next = contToken(d);
    tok = next && next !== tok ? next : '';
  }
  const list = uniq(tracks, (t) => t.ytId);
  return { ok: true, data: { playlist: { name, count: list.length, art, artBig: art, url: ref.url, isAlbum: /^MPRE/.test(id), artist, artistId: 0, artistUrl, date: '', desc: '', totalDur: list.reduce((s, x) => s + (x.dur || 0), 0) }, tracks: list } };
}

/* ---------- Страница исполнителя ---------- */
// «12,5 млн подписчиков», «3.4M subscribers», «870K»: число из подписи
function parseCount(text) {
  const m = /([\d][\d.,\s]*)\s*([KkMmBbКкМмТт]|тыс|млн|млрд|thousand|million|billion)?/.exec(String(text || ''));
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  const u = (m[2] || '').toLowerCase();
  const k = /^(k|к|тыс|thousand|т)/.test(u) ? 1e3 : /^(m|м|млн|million)/.test(u) ? 1e6 : /^(b|млрд|billion)/.test(u) ? 1e9 : 1;
  return Math.round(n * k);
}
async function artistPage(ref) {
  const id = ((/\/channel\/(UC[\w-]{10,})/.exec(String((ref && ref.url) || '')) || [])[1]) || '';
  if (!id) return { ok: false, error: 'Unsupported link' };
  const data = await call('browse', { browseId: id });
  const head = collectKey(data, 'musicImmersiveHeaderRenderer')[0] || collectKey(data, 'musicVisualHeaderRenderer')[0] || {};
  const name = textOf(head.title);
  if (!name) return { ok: false, error: 'This artist page is not available.' };
  const art = artOf(head.thumbnail) || artOf(head.foregroundThumbnail) || '';
  const subs = textOf((collectKey(head, 'subscriberCountText')[0]) || head.monthlyListenerCount);
  const desc = textOf(head.description);
  // главный список «Songs»: популярные треки; у него же ссылка «все песни»
  const songsShelf = collectKey(data, 'musicShelfRenderer')[0];
  const popular = songsShelf ? tracksOf({ s: songsShelf.contents || [] }, { art, artist: name, artistUrl: artistUrlOf(id) }) : [];
  // «Показать все»: полный список песен. Кнопка ведёт на страницу-плейлист (или список разворачивается продолжением): пробуем оба пути
  const fb = { art, artist: name, artistUrl: artistUrlOf(id) };
  let tracks = [];
  if (songsShelf) {
    const ids = [];
    collectKey(songsShelf, 'browseEndpoint').forEach((b) => { if (b && /^(VL|MPAD|OLAK|PL)/.test(b.browseId || '')) ids.push(b.browseId); });
    collectKey(songsShelf, 'playlistId').forEach((p) => { if (typeof p === 'string' && /^(OLAK|PL)/.test(p)) ids.push('VL' + p); });
    for (const bid of [...new Set(ids)]) {
      try { const got = await browseAll(bid, 300, (d) => tracksOf(d, fb)); if (got.length > tracks.length) tracks = got; } catch (e) { if (e instanceof AuthError) throw e; }
      if (tracks.length > popular.length) break;
    }
    if (tracks.length <= popular.length) {   // продолжение самого списка
      const c = (songsShelf.continuations || [])[0];
      let tok = (c && c.nextContinuationData && c.nextContinuationData.continuation) || '';
      const more = [...popular];
      for (let guard = 0; tok && guard < 20; guard++) {
        let d;
        try { d = await call('browse', { continuation: tok }, `&ctoken=${encodeURIComponent(tok)}&continuation=${encodeURIComponent(tok)}`); } catch (e) { if (e instanceof AuthError) throw e; break; }
        more.push(...tracksOf(d, fb));
        const next = contToken(d);
        tok = next && next !== tok ? next : '';
      }
      if (more.length > tracks.length) tracks = more;
    }
  }
  // полки с альбомами, синглами, клипами: у каждой своя кнопка «Ещё» со всем списком
  const moreItems = async (sh) => {
    const btn = collectKey(sh.header || {}, 'moreContentButton')[0];
    const be = btn && collectKey(btn, 'browseEndpoint')[0];
    if (!be || !be.browseId) return null;
    try {
      const d = await call('browse', be.params ? { browseId: be.browseId, params: be.params } : { browseId: be.browseId });
      const got = collectKey(d, 'musicTwoRowItemRenderer');
      return got.length ? got : null;
    } catch (e) { if (e instanceof AuthError) throw e; return null; }
  };
  const shelves = collectKey(data, 'musicCarouselShelfRenderer').slice(0, 8);
  const fulls = await Promise.all(shelves.map(moreItems));
  const albums = [], playlists = [], videos = [];
  shelves.forEach((sh, i) => {
    const items = fulls[i] || (sh.contents || []).map((x) => x.musicTwoRowItemRenderer).filter(Boolean);
    for (const two of items) {
      const vid = (((two.navigationEndpoint || {}).watchEndpoint) || {}).videoId;
      if (vid) { const t = twoRowTrack(two, vid); if (t) videos.push(t); continue; }
      const e = toEntity(two);
      if (!e) continue;
      if (e.kind === 'album') albums.push(e.e); else if (e.kind === 'playlist') playlists.push(e.e);
    }
  });
  const all = uniq([...(tracks.length ? tracks : popular), ...videos], (t) => t.ytId);
  return { ok: true, data: {
    artist: { name, art, artBig: art, url: artistUrlOf(id), followers: parseCount(subs), trackCount: all.length, city: '', country: '', desc },
    popular: popular.slice(0, 10), tracks: all,
    albums: uniq(albums, (x) => x.url), playlists: uniq(playlists, (x) => x.url),
  } };
}

/* ---------- Страница трека: «Дальше» с переключаемыми разделами и текст песни ---------- */
// Раздел «Все» и остальные («Популярное», «Рекомендованное», «Редкие треки», десятилетия...) это переключатели очереди «Дальше» на сайте:
// каждый возвращает свой список. Разделы берём из ответа сайта как есть, поэтому набор зависит от трека.
const nextCache = new Map();   // videoId -> { chips: [{ title, we }], lyricsId }
function panelTrack(r) {
  if (!r || !r.videoId) return null;
  const by = (r.longBylineText && r.longBylineText.runs) || [];
  const artists = by.filter((x) => /^UC/.test(browseIdOf(x))).map((x) => x.text);
  const plain = by.map((x) => x.text).filter((x) => x && !SEP.test(x) && !/^\d{4}$/.test(x));
  const album = (by.find((x) => /^MPRE/.test(browseIdOf(x))) || {}).text || '';
  const artist = artists.join(', ') || plain[0] || '';
  const title = textOf(r.title);
  if (!title) return null;
  const year = (by.map((x) => x.text).find((x) => /^\d{4}$/.test(x))) || '';
  return {
    ytId: r.videoId, title, artist, artistId: 0, artistUrl: firstArtistUrl(by), dur: parseDur(textOf(r.lengthText)),
    art: artOf(r.thumbnail), url: `${ORIGIN}/watch?v=${r.videoId}`, plays: 0, likes: 0, date: year ? year + '-01-01' : '', genre: album, lock: '',
  };
}
async function watchNext(videoId, we) {
  const body = {
    enablePersistentPlaylistPanel: true, isAudioOnly: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL',
    videoId, playlistId: 'RDAMVM' + videoId,
    watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { hasPersistentPlaylistPanel: true, musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' } },
    ...(we || {}),
  };
  const data = await call('next', body);
  const panel = collectKey(data, 'playlistPanelRenderer')[0] || {};
  const tracks = [];
  for (const c of panel.contents || []) {
    // у «обёртки» берём основной вариант (песню), а не её видеоверсию: иначе каждый трек был бы дважды
    const r = c.playlistPanelVideoRenderer || (c.playlistPanelVideoWrapperRenderer && c.playlistPanelVideoWrapperRenderer.primaryRenderer && c.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer);
    const t = panelTrack(r);
    if (t) tracks.push(t);
  }
  const chips = collectKey(data, 'chipCloudChipRenderer').map((c) => ({
    title: textOf(c.text) || (c.text && c.text.simpleText) || '', we: collectKey(c, 'watchEndpoint')[0] || null, selected: !!c.isSelected,
  })).filter((c) => c.title && c.we);
  const lyricsTab = collectKey(data, 'tabRenderer').find((t) => !t.unselectable && /^MPLYt/.test((((t.endpoint || {}).browseEndpoint) || {}).browseId || ''));
  const lyricsId = lyricsTab ? lyricsTab.endpoint.browseEndpoint.browseId : '';
  return { tracks: uniq(tracks, (t) => t.ytId), chips, lyricsId };
}
const videoIdOfRef = (ref) => ((/[?&]v=([\w-]{11})/.exec(String((ref && ref.url) || '')) || [])[1]) || '';
function remember(videoId, w) {
  nextCache.set(videoId, { chips: w.chips, lyricsId: w.lyricsId });
  if (nextCache.size > 40) nextCache.delete(nextCache.keys().next().value);
}
async function trackPage(ref) {
  const id = videoIdOfRef(ref);
  if (!id) return { ok: false, error: 'Unsupported link' };
  const w = await watchNext(id);
  remember(id, w);
  const first = w.tracks.find((t) => t.ytId === id) || w.tracks[0];
  if (!first) return { ok: false, error: 'This track is no longer available.' };
  const rest = w.tracks.filter((t) => t.ytId !== first.ytId);
  const sel = Math.max(0, w.chips.findIndex((c) => c.selected));
  return { ok: true, data: {
    track: { ...first, artBig: first.art, desc: '', tags: [], reposts: 0, comments: 0 },
    related: rest, relatedTitle: 'Up next',
    lyricsId: w.lyricsId,
    sections: w.chips.length > 1 ? w.chips.map((c, i) => ({ title: c.title, chip: i, tracks: i === sel ? rest : null })) : [],
  } };
}
async function trackSection(ref) {
  const id = String((ref && ref.videoId) || '');
  if (!/^[\w-]{11}$/.test(id)) return { ok: false, error: 'Bad track id' };
  let c = nextCache.get(id);
  if (!c) { const w = await watchNext(id); remember(id, w); c = nextCache.get(id); }
  const chip = c.chips[Number(ref.chip)];
  if (!chip) return { ok: false, error: 'No such section' };
  const w = await watchNext(id, chip.we);
  return { ok: true, data: { tracks: w.tracks.filter((t) => t.ytId !== id) } };
}
async function lyrics(ref) {
  const id = String((ref && ref.videoId) || '');
  if (!/^[\w-]{11}$/.test(id)) return { ok: false, error: 'Bad track id' };
  let c = nextCache.get(id);
  if (!c) { const w = await watchNext(id); remember(id, w); c = nextCache.get(id); }
  if (!c.lyricsId) return { ok: false, error: 'No lyrics for this track' };
  const data = await call('browse', { browseId: c.lyricsId });
  const shelf = collectKey(data, 'musicDescriptionShelfRenderer')[0];
  const text = shelf ? textOf(shelf.description).trim() : '';
  if (!text) return { ok: false, error: 'No lyrics for this track' };
  return { ok: true, data: { text, source: shelf.footer ? textOf(shelf.footer) : '' } };
}

async function like(track, on) {
  const id = track && track.ytId;
  if (!id) return { ok: false, error: 'No track' };
  await call(on ? 'like/like' : 'like/removelike', { target: { videoId: id } });
  return { ok: true };
}

/* ---------- Вход ---------- */
async function status() {
  try { return { ok: true, connected: !!(await authCookie()), mode: 'web' }; } catch (e) { return { ok: true, connected: false, mode: 'web' }; }
}

let loginWin = null;
function loginWindow(parent) {
  return new Promise((resolve) => {
    if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return resolve({ ok: false, error: 'Window is already open' }); }
    const win = new BrowserWindow({
      width: 520, height: 780, parent: parent || undefined, autoHideMenuBar: true, title: 'YouTube Music', backgroundColor: '#ffffff',
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    loginWin = win;
    win.webContents.setUserAgent(chromeUA());
    win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/([\w-]+\.)*(google|youtube)\.com\//.test(url)) win.loadURL(url); return { action: 'deny' }; });
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearInterval(timer); clearTimeout(limit); if (!win.isDestroyed()) win.destroy(); loginWin = null; resolve(r); };
    // через страницу входа Google с возвратом на music.youtube.com
    win.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&continue=' + encodeURIComponent(ORIGIN + '/')).catch(() => {});
    const timer = setInterval(async () => {
      try {
        // Google отказал встроенному окну («браузер не поддерживается»): переходим ко входу через обычный браузер
        if (!win.isDestroyed() && /^https:\/\/accounts\.google\./.test(win.webContents.getURL())) {
          const bad = /signin\/(v\d\/)?rejected|deniedsignin/.test(win.webContents.getURL())
            || await win.webContents.executeJavaScript(`/may not be secure|not secure|isn.t secure|небезопасн|не защищ|не поддерживается/i.test(document.body ? document.body.innerText : '')`, true).catch(() => false);
          if (bad) return finish({ fallback: true });
        }
        if (!win.isDestroyed() && /^https:\/\/music\.youtube\.com\//.test(win.webContents.getURL()) && await authCookie()) {
          ctx = null;
          await ses().cookies.flushStore().catch(() => {});
          finish({ ok: true });
        }
      } catch (e) { /* пробуем в следующий раз */ }
    }, 1000);
    const limit = setTimeout(() => finish({ ok: false, error: 'Sign-in timed out' }), 10 * 60 * 1000);
    win.on('closed', () => finish({ ok: false, error: 'Window closed' }));
  });
}

/* ---------- Запасной вход: через обычный браузер и вставку cookie ---------- */
// Google не пускает во встроенные окна, а cookie обычного браузера приложению недоступны (браузеры их шифруют).
// Поэтому: сайт открывается в браузере по умолчанию, а строку Cookie запроса пользователь вставляет в небольшое окно (так же входит ytmusicapi).
const REQUIRED = ['SAPISID', 'SID', 'HSID', 'SSID', 'APISID'];
const OPTIONAL = ['__Secure-1PSIDTS', '__Secure-3PSIDTS'];
// у Google эти cookie хранят одно и то же значение под разными именами: если не заполнены, повторяем введённое
const MIRRORS = { SAPISID: ['__Secure-1PAPISID', '__Secure-3PAPISID'], SID: ['__Secure-1PSID', '__Secure-3PSID'], '__Secure-1PSIDTS': ['__Secure-3PSIDTS'], '__Secure-3PSIDTS': ['__Secure-1PSIDTS'] };

/* ---------- Автоматический вход: сессия берётся из Firefox ---------- */
// Firefox хранит cookie в открытом виде (cookies.sqlite в папке профиля), поэтому их можно прочитать без ручного копирования.
// Chrome, Edge и другие шифруют cookie ключом, недоступным приложению, для них остаётся ручной ввод.
function firefoxRoots() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  return [
    path.join(appData, 'Mozilla', 'Firefox', 'Profiles'),
    path.join(home, 'Library', 'Application Support', 'Firefox', 'Profiles'),
    path.join(home, '.mozilla', 'firefox'),
    path.join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
    path.join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
  ];
}
// профили с базой cookie, свежие первыми
function firefoxDbs(roots) {
  const out = [];
  for (const root of roots || firefoxRoots()) {
    let names = [];
    try { names = fs.readdirSync(root); } catch (e) { continue; }
    for (const n of names) {
      const db = path.join(root, n, 'cookies.sqlite');
      try { out.push({ db, at: fs.statSync(db).mtimeMs }); } catch (e) { /* в этой папке профиля нет */ }
    }
  }
  return out.sort((a, b) => b.at - a.at).map((x) => x.db);
}
// Из всей базы нужны только cookie, которые уходят на music.youtube.com (youtube.com и music.youtube.com), и cookie входа Google.
// Остальные (реклама, другие поддомены) раздувают заголовок Cookie; одинаковые имена с разных адресов сводим к одной, с самым долгим сроком.
function pickRows(rows) {
  const best = new Map();
  for (const r of rows || []) {
    if (!r || !r.value) continue;
    const host = String(r.host || '').replace(/^\./, '');
    const yt = host === 'youtube.com' || host === 'music.youtube.com';
    const g = host === 'google.com' && KEEP.has(r.name);
    if (!yt && !g) continue;
    const key = (yt ? 'y|' : 'g|') + r.name;
    const prev = best.get(key);
    if (!prev || (Number(r.expiry) || 0) > (Number(prev.expiry) || 0)) best.set(key, r);
  }
  return [...best.values()];
}

// строки cookie сайтов YouTube и Google из первого профиля, где есть вход (SAPISID). null: читать нечем
function readFirefoxRows(roots) {
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) { return null; }
  for (const db of firefoxDbs(roots)) {
    let dir = '';
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wivy-ff-'));   // Firefox держит базу открытой: читаем копию вместе с журналом
      fs.copyFileSync(db, path.join(dir, 'cookies.sqlite'));
      try { fs.copyFileSync(db + '-wal', path.join(dir, 'cookies.sqlite-wal')); } catch (e) { /* журнала может не быть */ }
      const conn = new DatabaseSync(path.join(dir, 'cookies.sqlite'));
      let rows = [];
      try { rows = conn.prepare("SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE host LIKE '%youtube.com' OR host LIKE '%google.com'").all(); } finally { conn.close(); }
      rows = pickRows(rows);
      if (rows.some((r) => (r.name === 'SAPISID' || r.name === '__Secure-3PAPISID') && r.value)) return rows;
    } catch (e) { /* профиль пропускаем */ } finally { if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ничего */ } } }
  }
  return [];
}
const sigOf = (rows) => { const r = (rows || []).find((x) => x.name === 'SAPISID' || x.name === '__Secure-3PAPISID'); return r ? r.value : ''; };

async function applyRows(rows) {
  const SAME = { 0: 'no_restriction', 1: 'lax', 2: 'strict' };
  for (const r of rows) {
    if (!r.value) continue;
    const host = String(r.host || '');
    const secure = !!r.isSecure;
    let exp = Number(r.expiry) || 0;
    if (exp > 1e11) exp = Math.floor(exp / 1000);   // в новых версиях Firefox срок бывает в миллисекундах
    try {
      await ses().cookies.set({
        url: 'https://' + host.replace(/^\./, '') + (r.path || '/'), name: r.name, value: r.value,
        ...(host.startsWith('.') && !String(r.name).startsWith('__Host-') ? { domain: host } : {}),
        path: r.path || '/', secure, httpOnly: !!r.isHttpOnly,
        sameSite: secure ? (SAME[r.sameSite] || 'unspecified') : 'unspecified',
        expirationDate: exp > Date.now() / 1000 ? exp : Math.floor(Date.now() / 1000) + 30 * 86400,
      });
    } catch (e) { /* такую cookie пропускаем */ }
  }
  await ses().cookies.flushStore().catch(() => {});
}

// пробуем войти cookie из Firefox: { ok } | { ok: false, hasProfile, sig }
let lastTriedSig = '';
async function importFirefox() {
  const hasProfile = firefoxDbs().length > 0;
  let rows = null;
  try { rows = readFirefoxRows(); } catch (e) { rows = null; }
  if (rows === null) return { ok: false, hasProfile: false };   // нет node:sqlite: ручной ввод
  const sig = sigOf(rows);
  if (!sig) return { ok: false, hasProfile, sig: '' };
  if (sig === lastTriedSig) return { ok: false, hasProfile, sig };   // эту сессию уже пробовали, YouTube её не принял
  lastTriedSig = sig;
  ctx = null;
  await ses().clearStorageData({ storages: ['cookies'] }).catch(() => {});   // прежние cookie (в том числе лишние от прошлых входов) не копим
  await applyRows(rows);
  await trimCookies().catch(() => false);
  try { await fetchMe(); log('signed in with cookies from Firefox'); return { ok: true }; } catch (e) {
    if (!(e instanceof AuthError)) { log('could not verify the session (network?):', e && e.message); return { ok: true }; }   // сбой сети: вход оставляем, библиотека повторит загрузку сама
    await ses().clearStorageData().catch(() => {});
    return { ok: false, hasProfile, sig };
  }
}

/* ---------- Вход через обычный браузер ---------- */
// Google не пускает во встроенные окна. Сайт открывается в браузере по умолчанию, а приложение ждёт, пока в Firefox появится вход.
// Для остальных браузеров под спойлером есть ручной ввод cookie по одной.
const pasteHtml = (auto) => `<!doctype html><meta charset="utf-8"><title>YouTube Music: sign in with your browser</title>
<body style="font:14px system-ui;margin:0;padding:16px 22px;color:#222;background:#fff">
<h3 style="margin:0 0 8px">Sign in to YouTube Music</h3>
<p id="st" style="margin:0 0 12px;color:#444;line-height:1.5">${auto
  ? 'Your browser was opened on music.youtube.com. Sign in there: Wivy continues automatically as soon as you are signed in (works with Firefox).'
  : 'Google doesn’t allow sign-in inside apps, and automatic sign-in works only with Firefox. Enter the cookies below instead.'}</p>
<details ${auto ? '' : 'open'}><summary style="cursor:pointer;color:#555">Other browser? Enter cookies manually</summary>
<ol style="padding-left:20px;line-height:1.5;margin:8px 0">
<li>Sign in to YouTube Music in your browser and press <b>F12</b>.</li>
<li>Open <b>Storage → Cookies → music.youtube.com</b> (Firefox) or <b>Application → Cookies</b> (Chrome, Edge).</li>
<li>For each name below copy <b>only its value</b> (without quotes).</li></ol>
<div id="f" style="display:grid;grid-template-columns:150px 1fr;gap:6px 10px;align-items:center"></div>
<p style="margin:12px 0 0"><button style="padding:7px 20px" onclick="go()">Connect</button></p></details>
<script>
const REQ=${JSON.stringify(REQUIRED)},OPT=${JSON.stringify(OPTIONAL)};
const f=document.getElementById('f');
function row(n,req){f.insertAdjacentHTML('beforeend','<label for="c_'+n+'"><b>'+n+'</b>'+(req?'':' <small style="color:#888">(optional)</small>')+'</label><input id="c_'+n+'" autocomplete="off" spellcheck="false" style="padding:5px 7px;font:12px monospace;width:100%;box-sizing:border-box">');}
REQ.forEach(n=>row(n,true));OPT.forEach(n=>row(n,false));
function go(){const o={};REQ.concat(OPT).forEach(n=>{o[n]=document.getElementById('c_'+n).value;});window.__val=JSON.stringify(o);}
</script>`;

function parseCookieHeader(text) {
  return String(text || '').replace(/^\s*cookie\s*:/i, '').split(/;|\n/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf('=');
    return i > 0 ? { name: x.slice(0, i).trim(), value: x.slice(i + 1).trim() } : null;
  }).filter((c) => c && /^[\w.-]+$/.test(c.name) && c.value);
}

async function applyCookies(list) {
  const exp = Math.floor(Date.now() / 1000) + 365 * 86400;
  for (const c of list) {
    try {
      await ses().cookies.set({ url: ORIGIN + '/', name: c.name, value: c.value, ...(c.name.startsWith('__Host-') ? {} : { domain: '.youtube.com' }), path: '/', secure: true, sameSite: 'no_restriction', expirationDate: exp });
    } catch (e) { /* такую cookie пропускаем */ }
  }
  await ses().cookies.flushStore().catch(() => {});
}

function loginBrowser(parent, auto) {
  return new Promise((resolve) => {
    shell.openExternal(ORIGIN + '/').catch(() => {});
    const win = new BrowserWindow({
      width: 640, height: auto ? 230 : 560, parent: parent || undefined, autoHideMenuBar: true, title: 'YouTube Music', backgroundColor: '#ffffff',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    loginWin = win;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pasteHtml(auto))).catch(() => {});
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearInterval(timer); clearInterval(watch); clearTimeout(limit); if (!win.isDestroyed()) win.destroy(); loginWin = null; resolve(r); };
    let busy = false;
    let watching = false;
    // вход в Firefox: раз в пару секунд смотрим, появилась ли сессия
    const watch = setInterval(async () => {
      if (!auto || watching || done) return;
      watching = true;
      try { if ((await importFirefox()).ok) finish({ ok: true }); } catch (e) { /* пробуем позже */ } finally { watching = false; }
    }, 2000);
    // ручной ввод: значения cookie из формы
    const timer = setInterval(async () => {
      if (busy || done || win.isDestroyed()) return;
      busy = true;
      try {
        const val = await win.webContents.executeJavaScript('window.__val || ""', true);
        if (val) {
          await win.webContents.executeJavaScript('window.__val = ""', true);
          let list = [];
          try {
            const o = JSON.parse(val);
            const clean = (n, v) => String(v || '').trim().replace(/^"(.*)"$/, '$1').replace(new RegExp('^' + n + '\\s*=\\s*'), '').trim();
            const got = {};
            for (const n of [...REQUIRED, ...OPTIONAL]) { const v = clean(n, o[n]); if (v && !/[\s;]/.test(v)) got[n] = v; }
            for (const [n, copies] of Object.entries(MIRRORS)) if (got[n]) copies.forEach((c) => { if (!got[c]) got[c] = got[n]; });
            list = Object.entries(got).map(([name, value]) => ({ name, value }));
          } catch (e) { list = parseCookieHeader(val); }
          const have = (n) => list.some((c) => c.name === n);
          if (!have('SAPISID') || !have('SID')) {
            await win.webContents.executeJavaScript(`alert('Please fill in at least SAPISID and SID (values of the cookies of music.youtube.com while you are signed in).')`, true);
          } else {
            ctx = null;
            await applyCookies(list);
            let ok = false;
            try { await fetchMe(); ok = true; } catch (e) { ok = !(e instanceof AuthError); }   // сбой сети не считаем отказом
            if (ok) return finish({ ok: true });
            await ses().clearStorageData().catch(() => {});
            await win.webContents.executeJavaScript(`alert('YouTube Music did not accept these cookies. Sign in again and copy fresh values.')`, true);
          }
        }
      } catch (e) { /* пробуем в следующий раз */ } finally { busy = false; }
    }, 500);
    const limit = setTimeout(() => finish({ ok: false, error: 'Sign-in timed out' }), 10 * 60 * 1000);
    win.on('closed', () => finish({ ok: false, cancelled: true }));
  });
}

// 1) тихо пробуем сессию Firefox; 2) если Firefox есть, но входа нет: сайт в браузере и ожидание входа; 3) иначе окно Google, а при отказе ручной ввод
async function login(parent) {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return { ok: false, error: 'Window is already open' }; }
  lastTriedSig = '';
  const quick = await importFirefox().catch(() => ({ ok: false, hasProfile: false }));
  if (quick.ok) return { ok: true };
  if (quick.hasProfile) return loginBrowser(parent, true);
  const r = await loginWindow(parent);
  return r && r.fallback ? loginBrowser(parent, false) : r;
}

async function logout() {
  try { await ses().clearStorageData(); await ses().clearCache(); } catch (e) { /* ничего */ }
  ctx = null;
  stopPlayer();
  return { ok: true };
}

/* ---------- Плеер: настоящая страница сайта в <webview> под интерфейсом ---------- */
// Окно приложения (renderer.js) создаёт <webview> и командой yt:attach сообщает его номер. Страница растянута на всё окно
// ПОД интерфейсом, мышь и клавиши в неё не доходят (pointer-events: none). Пока фон-видео выключен, она прозрачна и просто играет звук;
// при включённом показывается только видео трека, а панели интерфейса лежат поверх с прозрачностью из настроек.
let guest = null;         // webContents страницы сайта
let ownerWc = null;       // окно приложения: ему сообщаем, показано ли видео
let want = '';            // трек, который просили сыграть
let endedFor = '';        // для какого трека уже сообщили «доиграл»
let userPaused = false;   // паузу нажал пользователь: любая другая пауза страницы лечится
let lastT = 0, lastDur = 0, hijacks = 0, heals = 0, reloadsLive = 0;

let videoWanted = false;  // пользователь включил фон-видео
let videoLive = false;    // у текущего трека есть видео, страница в режиме «Video» и показана
let videoSeq = 0;
// true: клип идёт; false: клипа пока нет (загрузка); 'none': у этого трека клипа нет, приложение покажет его обложку
const FADE_MS = 350;   // столько приложение гасит клип, прежде чем страница уйдёт на другой трек
const tell = (v) => { try { if (ownerWc && !ownerWc.isDestroyed()) ownerWc.send('yt:video', v === 'none' ? 'none' : !!v); } catch (e) { /* ничего */ } };
function setLive(on) {
  if (videoLive === on) return;
  videoLive = on;
  tell(on);
}

// страница растягивает <video> на всё окно и прячет остальное: в фоне видно только видео
const VIDEO_CSS = 'html,body{background:#000!important;overflow:hidden!important;margin:0!important;padding:0!important}html *,body *{transform:none!important;translate:none!important;scale:none!important;rotate:none!important;filter:none!important;backdrop-filter:none!important;perspective:none!important;contain:none!important;will-change:auto!important;clip-path:none!important}ytmusic-app,ytmusic-app-layout,#layout,#content,#main-panel,ytmusic-player-page,#player-page,#player{margin:0!important;padding:0!important;border:0!important;inset-inline:0!important}body *{visibility:hidden!important}ytmusic-player,#movie_player,.html5-video-container{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;transform:none!important}body video{visibility:visible!important;position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;object-fit:fill!important;transform:none!important;margin:0!important;padding:0!important;z-index:2147483647!important}';
const QUALITY = `(()=>{window.dispatchEvent(new Event('resize'));const p=document.querySelector('#movie_player');try{p.setPlaybackQualityRange('hd1080','highres');p.setPlaybackQuality('hd1080');}catch(e){}})()`;
// если страница всё же сдвинула видео (отступы сайта), компенсируем сдвиг по его реальному положению
const FIT = `(()=>{const fit=()=>{const v=document.querySelector('video');if(!v)return;const r=v.getBoundingClientRect();
  if(Math.abs(r.left)>0.5||Math.abs(r.top)>0.5){const ml=parseFloat(v.style.marginLeft)||0,mt=parseFloat(v.style.marginTop)||0;
    v.style.setProperty('margin-left',(ml-r.left)+'px','important');v.style.setProperty('margin-top',(mt-r.top)+'px','important');}};
  window.__wivyFit=fit;if(!window.__wivyFitOn){window.__wivyFitOn=1;addEventListener('resize',()=>setTimeout(()=>window.__wivyFit&&window.__wivyFit(),350));}fit();})()`;
const VIDEO_ON = `(()=>{
  const btn=document.querySelector('ytmusic-av-toggle .video-button')||document.querySelector('.video-button');
  const has=!!btn&&!btn.closest('[hidden]');
  if(has){let st=document.getElementById('wivy-video-css');if(!st){st=document.createElement('style');st.id='wivy-video-css';st.textContent=${JSON.stringify(VIDEO_CSS)};document.head.appendChild(st);}btn.click();}
  return {has};})()`;
// Есть ли на странице настоящая картинка: у части треков переключатель «Song / Video» есть, но «видео» это звуковая дорожка (чёрный экран)
// или статичная заставка из обложки. Тогда клипом это не считаем и приложение показывает свою большую обложку.
const FRAMES = `(()=>{const v=document.querySelector('video');if(!v)return null;const p=document.querySelector('#movie_player');let type='';
  try{type=p.getPlayerResponse().videoDetails.musicVideoType||'';}catch(e){}
  const q=v.getVideoPlaybackQuality?v.getVideoPlaybackQuality():null;
  return {w:v.videoWidth,h:v.videoHeight,frames:q?q.totalVideoFrames:-1,type};})()`;
const realClip = (f) => !!f && f.w >= 160 && f.h >= 90 && f.frames !== 0 && f.type !== 'MUSIC_VIDEO_TYPE_ATV';
const VIDEO_OFF = `(()=>{const st=document.getElementById('wivy-video-css');if(st)st.remove();const b=document.querySelector('ytmusic-av-toggle .song-button')||document.querySelector('.song-button');if(b)b.click();return true;})()`;

// В странице за 0,4 с до конца трек ставится на паузу, и сайт не успевает запустить свой «следующий»
// (автовоспроизведение ломало порядок очереди).
const HOOK = `(()=>{if(window.__wivyHook)return;window.__wivyHook=1;
  const hook=(v)=>{if(v.__wh)return;v.__wh=1;
    v.addEventListener('timeupdate',()=>{const d=v.duration;if(isFinite(d)&&d>5&&d-v.currentTime<0.4&&!v.paused&&!window.__wivyEnded){window.__wivyEnded=true;v.pause();}});
    v.addEventListener('ended',()=>{window.__wivyEnded=true;});};
  const scan=()=>{const v=document.querySelector('video');if(v)hook(v);};
  scan();new MutationObserver(scan).observe(document.documentElement,{childList:true,subtree:true});})()`;

const WATCH_RE = /^https:\/\/music\.youtube\.com\/watch/;
const watchUrl = (id) => `${ORIGIN}/watch?v=${id}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (code) => (guest && !guest.isDestroyed() ? guest.executeJavaScript(code, true) : Promise.resolve(null));

// Окно приложения может создавать <webview> только для этого плеера: своё хранилище, без preload и без доступа к Node
function guardWebview(wc) {
  wc.on('will-attach-webview', (event, prefs, params) => {
    if (params.partition !== PARTITION || String(params.src || 'about:blank') !== 'about:blank') { event.preventDefault(); return; }
    delete prefs.preload; delete prefs.preloadURL;
    Object.assign(prefs, {
      nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
    });
  });
}

// окно приложения сообщает номер своего <webview>: проверяем, что это именно страница плеера, встроенная в него
function attach(sender, id) {
  const wc = webContents.fromId(Number(id));
  if (!wc || wc.isDestroyed()) return { ok: false, error: 'no such page' };
  if (wc.getType() !== 'webview') return { ok: false, error: 'not a webview (' + wc.getType() + ')' };
  if (wc.session !== ses()) return { ok: false, error: 'wrong session' };
  ownerWc = sender;
  if (guest === wc) return { ok: true };
  guest = wc;
  wc.setUserAgent(chromeUA());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Пока трек играет, сайт вешает на страницу вопрос «Покинуть сайт?» и без этого обработчика не даёт ей смениться:
  // новый трек не открывался, сайт «перескакивал» обратно на играющий. Уход со страницы разрешаем всегда.
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  wc.on('did-finish-load', () => {   // страница трека загрузилась (в том числе заново): ставим перехват конца и возвращаем режим видео
    if (!WATCH_RE.test(wc.getURL())) return;
    run(HOOK).catch(() => {});
    if (videoWanted && want) applyVideo(true, 14);
  });
  // клавиатура всегда остаётся у интерфейса: страница не должна забирать фокус (горячие клавиши приложения)
  wc.on('focus', () => { try { if (ownerWc && !ownerWc.isDestroyed()) ownerWc.focus(); } catch (e) { /* ничего */ } });
  wc.once('destroyed', () => { if (guest === wc) { guest = null; want = ''; videoLive = false; } });
  return { ok: true };
}

function stopPlayer() {
  want = ''; endedFor = ''; userPaused = false;
  videoWanted = false; videoSeq++; setLive(false);
  if (guest && !guest.isDestroyed()) guest.loadURL('about:blank').catch(() => {});
}

// включает или выключает режим видео на странице; tries: сколько раз ждать, пока на ней появится переключатель Song / Video
async function applyVideo(on, tries) {
  const seq = ++videoSeq;
  if (!on) { await run(VIDEO_OFF).catch(() => {}); if (seq === videoSeq) setLive(false); return { has: false }; }
  let has = false;
  for (let i = 0; i < (tries || 6) && seq === videoSeq && videoWanted && want; i++) {
    let r = null;
    try { r = await run(VIDEO_ON); } catch (e) { r = null; }
    if (r && r.has) { has = true; break; }
    if (i === 5) tell('none');   // за три секунды переключателя Song / Video нет: показываем обложку, а клип подхватим, если появится позже
    await sleep(500);
  }
  if (seq !== videoSeq) return { has };
  if (has) {   // переключатель найден и нажат: ждём, пока на странице пойдёт настоящая картинка (до 5 секунд)
    let real = false;
    for (let k = 0; k < 10 && seq === videoSeq && videoWanted && want; k++) {
      let f = null;
      try { f = await run(FRAMES); } catch (e) { f = null; }
      if (realClip(f)) { real = true; break; }
      await sleep(500);
    }
    if (seq !== videoSeq) return { has: real };
    if (!real) { await run(VIDEO_OFF).catch(() => {}); has = false; }   // картинки нет: возвращаем «Song», показывать будем обложку
  }
  if (has && videoWanted) setLive(true);
  else { videoLive = false; tell(videoWanted ? 'none' : false); }
  if (has) for (const d of [300, 800, 2500, 6000]) setTimeout(() => {   // качество сайт выбирает сам: просим максимум несколько раз; заодно выравниваем видео по окну
    if (seq !== videoSeq) return;
    run(QUALITY).catch(() => {});
    run(FIT).catch(() => {});
  }, d);
  return { has };
}

const PROBE = (vol) => `(()=>{const v=document.querySelector('video');const u=new URL(location.href);const p=document.querySelector('#movie_player');
  const e=document.querySelector('.ytp-error');const bad=!!(e&&e.offsetParent!==null);
  const ad=!!(p&&p.classList.contains('ad-showing'))||!!document.querySelector('.ytp-ad-player-overlay,.ytp-ad-text');
  const vid=u.searchParams.get('v')||'';
  if(!v)return {vid,has:false,bad,ad};
  ${vol === null ? '' : `try{v.volume=${vol};}catch(e){} if(v.paused&&!bad){v.play().catch(()=>{});}`}
  return {vid,has:true,t:v.currentTime,d:v.duration,paused:v.paused,ended:v.ended,ready:v.readyState,bad,ad,we:!!window.__wivyEnded};})()`;

// Сайт сохраняет свою очередь в localStorage / IndexedDB / sessionStorage и при загрузке возвращается к прошлому треку.
// Поэтому перед каждым запуском открываем безобидную страницу того же сайта, стираем эти данные и только потом идём на трек
// (cookie, то есть вход, не трогаем). Пока страница грузится, видео в фоне скрыто.
async function freshLoad(videoId) {
  const wc = guest;
  if (!wc || wc.isDestroyed()) return null;
  const wasLive = videoLive;
  setLive(false);
  if (wasLive) await sleep(FADE_MS);   // приложение плавно гасит клип, и только потом страница уходит на другой трек
  try { await wc.executeJavaScript("(()=>{const v=document.querySelector('video');if(v)v.pause();})()", true); } catch (e) { /* страницы может не быть */ }
  try {
    await wc.loadURL(ORIGIN + '/robots.txt');
    await wc.executeJavaScript('try{sessionStorage.clear();localStorage.clear();}catch(e){}', true);
  } catch (e) { /* не страшно */ }
  try { await wc.session.clearStorageData({ origin: ORIGIN, storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] }); } catch (e) { /* не страшно */ }
  try { await wc.loadURL(watchUrl(videoId)); } catch (e) { /* загрузку прервала смена трека или сайт перенаправил: проверит опрос */ }
  return wc;
}

// Запуск терпеливый: сайт может сперва показать рекламу, перескочить на другой трек своей очереди или на секунду остановиться.
// Мы возвращаем свой трек, снова нажимаем «play» и при необходимости обновляем страницу, а не сдаёмся при первой заминке.
let starting = 0;   // сколько запусков идёт сейчас: пока идёт запуск, опрос старой страницы ничего не трогает
async function play(videoId, volume, wantVideo) {
  starting++;
  try {
    const r = await playInner(videoId, volume, wantVideo);
    // Не вышло (трек недоступен, ошибка плеера): страница не должна сама перейти к «следующему» своей очереди и играть мимо приложения.
    // «Cancelled» — это уже запущен другой трек, его не трогаем.
    if (!r.ok && r.error !== 'Cancelled' && want === videoId) await silencePage();
    return r;
  } finally { starting--; }
}

// страница сайта замолкает: пауза и пустая страница; очередь остаётся за приложением
async function silencePage() {
  want = ''; endedFor = ''; userPaused = false; videoSeq++; setLive(false);
  if (!guest || guest.isDestroyed()) return;
  try { await guest.executeJavaScript("(()=>{const v=document.querySelector('video');if(v)v.pause();})()", true); } catch (e) { /* страницы может не быть */ }
  try { await guest.loadURL('about:blank'); } catch (e) { /* ничего */ }
}

async function playInner(videoId, volume, wantVideo) {
  if (!/^[\w-]{11}$/.test(String(videoId || ''))) return { ok: false, error: 'Bad track id' };
  if (!guest || guest.isDestroyed()) return { ok: false, error: 'The player is not ready yet. Try again in a moment.' };
  want = videoId; endedFor = ''; userPaused = false; lastT = 0; lastDur = 0; hijacks = 0; heals = 0; reloadsLive = 0;
  videoWanted = !!wantVideo; videoSeq++;   // клипы включены кнопкой: страница переключится на «Video», как только загрузится
  await sleep(250);   // при быстрой смене треков страницу не загружаем зря (и не дёргаем сайт лишний раз)
  if (want !== videoId) return { ok: false, error: 'Cancelled' };
  await freshLoad(videoId);
  if (want !== videoId) return { ok: false, error: 'Cancelled' };
  await run(HOOK).catch(() => {});
  const vol = Math.max(0, Math.min(1, Number(volume))) || 0;
  let limit = 120;   // 30 секунд; реклама продлевает
  let navs = 0, stable = 0, prevT = -1, badSeen = 0, reloads = 0;
  for (let i = 0; i < limit; i++) {
    if (want !== videoId) return { ok: false, error: 'Cancelled' };
    let st = null;
    try { st = await run(PROBE(vol)); } catch (e) { st = null; }
    if (st && st.ad) { stable = 0; limit = Math.max(limit, 240); }
    else if (st && st.vid && st.vid !== videoId) {   // сайт перескочил на другой трек: возвращаем наш
      stable = 0;
      if (++navs > 3) return { ok: false, error: 'YouTube Music keeps switching to another track. Try again in a moment.' };
      await freshLoad(videoId);
      await sleep(1000);
      continue;
    } else if (st && st.bad) {   // ошибка плеера бывает мимолётной: ждём, затем обновляем страницу
      stable = 0; badSeen++;
      if (badSeen % 12 === 0) {
        if (++reloads > 2) return { ok: false, error: 'YouTube Music can’t play this track right now. Try again in a moment.' };
        await freshLoad(videoId);
        await sleep(2000);
        continue;
      }
    } else if (st && st.has && !st.paused && st.ready >= 2 && st.t > prevT + 0.05) {
      if (++stable >= 3) return { ok: true };   // время идёт три опроса подряд: трек действительно играет
    } else stable = 0;
    if (st && st.has) prevT = st.t;
    if (i === 60 && reloads < 2 && !(st && st.ad)) {   // за 15 секунд не заиграло: обновляем страницу
      reloads++;
      await freshLoad(videoId);
      await sleep(1500);
      prevT = -1; stable = 0;
      continue;
    }
    await sleep(250);
  }
  let seen = null;
  try { seen = await run(PROBE(null)); } catch (e) { seen = null; }
  const where = (() => { try { return guest && !guest.isDestroyed() ? guest.getURL().replace(/^https:\/\//, '').slice(0, 60) : 'no page'; } catch (e) { return '?'; } })();
  const info = seen ? `video ${seen.has ? 'yes' : 'no'}, paused ${seen.paused}, ready ${seen.ready}, error ${seen.bad}` : 'page not answering';
  return { ok: false, error: `YouTube Music did not start playing this track (${where}; ${info}).` };
}

async function state() {
  if (!want) return { ok: true, active: false };
  if (starting > 0) return { ok: true, active: true, t: 0, d: 0, playing: false, ended: false };
  let s = null;
  try { s = await run(PROBE(null)); } catch (e) { s = null; }
  if (!s || !s.has) return { ok: true, active: true, t: 0, d: 0, playing: false, ended: false };
  if (s.ad) return { ok: true, active: true, ad: true, t: 0, d: 0, playing: false, ended: false };   // идёт реклама: её конец не конец трека
  const dur = Number.isFinite(s.d) ? s.d : 0;
  const jumped = !!(s.vid && s.vid !== want);
  if (!jumped) { lastT = s.t; lastDur = dur; }
  const atEnd = s.ended || s.we || (dur > 5 && dur - s.t < 0.6);
  const progressed = lastT > 5 || (lastDur > 5 && lastDur - lastT < 4);
  // сайт перескочил на другой трек, не дав этому толком поиграть: это не конец трека, возвращаем свой
  if (jumped && !progressed && hijacks < 3 && endedFor !== want) {
    hijacks++;
    freshLoad(want).catch(() => {});
    return { ok: true, active: true, t: 0, d: 0, playing: false, ended: false };
  }
  // сайт сам переходит к следующему треку своей очереди: мы этого не хотим, поэтому останавливаем его и сообщаем «доиграл»
  if ((jumped || atEnd) && endedFor !== want) {
    endedFor = want;
    run(`(()=>{const v=document.querySelector('video');if(v)v.pause();})()`).catch(() => {});
  }
  // пауза, которую никто не просил (страница остановила воспроизведение сама): снова нажимаем «play», при затяжной остановке обновляем страницу
  if (!s.paused) heals = 0;
  else if (!userPaused && !jumped && !atEnd && endedFor !== want) {
    heals++;
    if (heals === 12 && reloadsLive < 2 && lastT < 3) {
      reloadsLive++;
      freshLoad(want).catch(() => {});
    } else if (heals <= 40) {
      run(`(()=>{const v=document.querySelector('video');if(v)v.play().catch(()=>{});})()`).catch(() => {});
    }
  }
  return { ok: true, active: true, t: jumped ? dur : s.t, d: dur, playing: !s.paused && endedFor !== want, ended: endedFor === want };
}

async function control(cmd, arg) {
  if (!want) return { ok: true };
  const n = Number(arg) || 0;
  const code = {
    pause: `document.querySelector('video')&&document.querySelector('video').pause()`,
    resume: `(()=>{const v=document.querySelector('video');if(v){window.__wivyEnded=false;v.play();}})()`,
    seek: `(()=>{const v=document.querySelector('video');if(v){window.__wivyEnded=false;v.currentTime=${n};}})()`,
    volume: `(()=>{const v=document.querySelector('video');if(v)v.volume=${Math.max(0, Math.min(1, n))};})()`,
    // повтор одного трека: в начало и играть за один шаг (по отдельности трек успевал доиграть хвост, и сайт переходил к своему следующему)
    restart: `(()=>{const v=document.querySelector('video');if(v){window.__wivyEnded=false;v.currentTime=0;v.play().catch(()=>{});}})()`,
  }[cmd];
  if (!code) return { ok: false, error: 'Unknown command' };
  if (cmd === 'resume' || cmd === 'seek' || cmd === 'restart') endedFor = '';
  if (cmd === 'restart') { lastT = 0; heals = 0; hijacks = 0; userPaused = false; }
  if (cmd === 'pause') userPaused = true;
  if (cmd === 'resume') userPaused = false;
  try { await run(code); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true };
}

// видео: страница переключается на «Video» и показывается под интерфейсом на всё окно
async function video(on) {
  if (!guest || guest.isDestroyed() || !want) return { ok: false, error: 'Nothing is playing' };
  videoWanted = !!on;
  const r = await applyVideo(!!on, 6);
  if (on && !r.has) return { ok: true, shown: false, none: true };   // у трека нет клипа: желание остаётся, приложение покажет обложку
  return { ok: true, shown: !!on };
}

function register(ipcMain, winOf) {
  const wrap = (fn) => async (e, ...args) => {
    try { return await fn(e, ...args); } catch (err) {
      if (err instanceof AuthError) return { ok: false, auth: true, error: err.message };
      log('error:', err && err.message);
      return { ok: false, error: String((err && err.message) || err) };
    }
  };
  ipcMain.handle('yt:status', wrap(() => status()));
  ipcMain.handle('yt:login', wrap((e) => login(winOf(e))));
  ipcMain.handle('yt:logout', wrap(() => logout()));
  ipcMain.handle('yt:library', wrap(async () => ({ ok: true, library: await library() })));
  ipcMain.handle('yt:search', wrap((e, q) => search(q)));
  ipcMain.handle('yt:playlist', wrap((e, ref) => playlist(ref || {})));
  ipcMain.handle('yt:like', wrap((e, t, on) => like(t, on)));
  ipcMain.handle('yt:track', wrap((e, ref) => trackPage(ref || {})));
  ipcMain.handle('yt:artist', wrap((e, ref) => artistPage(ref || {})));
  ipcMain.handle('yt:track-section', wrap((e, ref) => trackSection(ref || {})));
  ipcMain.handle('yt:lyrics', wrap((e, ref) => lyrics(ref || {})));
  ipcMain.handle('yt:attach', wrap((e, id) => attach(e.sender, id)));
  ipcMain.handle('yt:play', wrap((e, id, vol, video) => play(id, vol, !!video)));
  ipcMain.handle('yt:state', wrap(() => state()));
  ipcMain.handle('yt:control', wrap((e, cmd, arg) => control(String(cmd), arg)));
  ipcMain.handle('yt:video', wrap((e, on) => video(on)));
  ipcMain.handle('yt:stop', wrap(() => { stopPlayer(); return { ok: true }; }));
  ipcMain.handle('yt:open-link', wrap(async (e, url) => {
    if (!/^https:\/\/music\.youtube\.com\//.test(String(url || ''))) return { ok: false, error: 'Bad link' };
    await shell.openExternal(url);
    return { ok: true };
  }));
}

module.exports = { register, guardWebview };
