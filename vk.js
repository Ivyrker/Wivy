// Подключение VK Музыки (основной процесс).
// Вход — в обычном окне vk.com внутри приложения (как «web»-вход SoundCloud): пользователь вводит логин, пароль, код из SMS,
// а приложение само замечает, что вход выполнен, и закрывает окно. Ключи и токены разработчика не нужны.
// Официальный OAuth для аудио VK закрыл (вход по токену отключён с июня 2024), поэтому библиотека читается так же, как её
// читает мобильный сайт m.vk.com: теми же запросами и с cookie этого окна. Способ неофициальный.
// Пароли и cookie в окно приложения не попадают: наружу отдаются только готовые списки треков.
const { app, BrowserWindow, session, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:vk';                     // отдельное хранилище cookie для окна входа
const LIMITS = { liked: 5000, playlists: 100, recent: 12 };   // лайков может быть и больше тысячи: потолок только от зависания

class AuthError extends Error {}
class NoLinkError extends Error {}   // VK не отдал ссылку на звук: трек закрыт для региона или аккаунта
const log = (...args) => console.log('[VK]', ...args);

/* ---------- Что запоминаем: номер пользователя и домен (vk.com или vk.ru). Секретов тут нет ---------- */
let conf = null;
const confFile = () => path.join(app.getPath('userData'), 'vk.json');
function readConf() {
  if (conf) return conf;
  try { conf = JSON.parse(fs.readFileSync(confFile(), 'utf8')); } catch (e) { conf = {}; }
  if (!conf || typeof conf !== 'object') conf = {};
  return conf;
}
function saveConf(c) { conf = c; try { fs.writeFileSync(confFile(), JSON.stringify(c)); } catch (e) { /* ничего */ } }

/* ---------- Сеть ---------- */
const ses = () => session.fromPartition(PARTITION);
// обычный Chrome без пометок Electron: так вход реже отвергается
const chromeUA = () => ses().getUserAgent().replace(/\s*Electron\/\S+/, '').replace(/\s*music-player\/\S+/i, '');
const hostOf = (u) => { try { const m = new URL(u).hostname.match(/(?:^|\.)(vk\.(?:com|ru))$/); return m ? m[1] : null; } catch (e) { return null; } };

async function request(host, p, form) {
  const res = await ses().fetch(`https://m.${host}${p}`, {
    method: form ? 'POST' : 'GET',
    credentials: 'include', // cookie окна входа
    headers: {
      'User-Agent': chromeUA(),
      'X-Requested-With': 'XMLHttpRequest',
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  return { res, text: await res.text() };
}

/* ---------- Приведение ответов VK к одному виду ---------- */
// картинки показываем только с серверов VK: адрес попадает в стиль страницы
const SAFE_IMG = /^https:\/\/[a-z0-9.-]+\.(?:userapi\.com|vkuserphoto\.ru|vk-cdn\.net|vkuser\.net|vk\.com|vk\.ru|vk\.me|mycdn\.me)\/[^\s"'()<>\\]+$/i;
const art = (u) => {
  const s = String(u || '').trim().replace(/&amp;/g, '&');
  if (!s) return '';
  if (SAFE_IMG.test(s)) return s;
  if (/^https:/.test(s)) log('cover host not allowed:', s.slice(0, 80));
  return '';
};
// VK отдаёт названия с HTML-сущностями (&amp;, &#39;), а плеер сам экранирует текст
const decode = (s) => String(s || '').replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  const t = e.toLowerCase();
  if (t[0] === '#') { const n = t[1] === 'x' ? parseInt(t.slice(2), 16) : parseInt(t.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[t];
}).trim();

// элемент списка — массив: [0] id, [1] владелец, [3] название, [4] исполнитель, [5] длительность, [13] хэши, [14] обложки через запятую
function toTrack(a) {
  if (!Array.isArray(a) || a.length < 6 || !a[3]) return null;
  const covers = String(a[14] || '').split(',');
  let cover = art(covers[covers.length - 1]);
  if (!cover) { // поле [14] пустое или другого вида: берём любую картинку из элемента
    const imgs = JSON.stringify(a).match(/https:[^"\\,\s]+?\.(?:jpe?g|png|webp)(?:\?[^"\\,\s]*)?/gi) || [];
    for (const u of imgs.reverse()) { cover = art(u.replace(/\\\//g, '/')); if (cover) break; }
  }
  // без хэша доступа (6 частей через «/») ссылку на звук получить нечем: такой трек VK не отдаёт (закрыт для региона, аккаунта или правообладателем)
  const h = String(a[13] || '').split('/');
  const playable = !!(h[2] && h[5]) || streamCache.has(`${a[1]}_${a[0]}`);
  return {
    vkId: `${a[1]}_${a[0]}`,
    lock: playable ? '' : 'region',
    title: decode(a[3]),
    artist: decode(a[4]),
    dur: Number(a[5]) || 0,
    art: cover,
    url: `https://vk.com/audio${a[1]}_${a[0]}`,
    hash: String(a[13] || ''), // нужен для получения ссылки на звук (act=reload_audio)
    trackCode: String(a[20] || ''), // служебный код трека: сайт передаёт его при добавлении и удалении
  };
}

// плейлисты мобильный сайт отдаёт только готовой страницей, поэтому разбираем её разметку
function parsePlaylists(html) {
  const out = [];
  const item = /<div[^>]+class="[^"]*audioPlaylistsPage__item/;
  for (const block of html.split(new RegExp('(?=' + item.source + ')')).filter((b) => b.search(item) === 0)) { // кусок страницы до первой карточки отбрасываем
    const id = block.match(/act=audio_playlist(-?\d+)_(\d+)/);
    const title = block.match(/audioPlaylistsPage__title[^>]*>\s*([^<]+)/);
    if (!id || !title) continue;
    const count = block.match(/(\d+)\s*(?:аудио|трек|песн|track|song)/i);
    const cover = block.match(/url\(\s*['"]?(https:[^'")\s]+)/);
    out.push({ name: decode(title[1]), count: count ? Number(count[1]) : 0, art: art(cover && cover[1]), url: `https://vk.com/music/playlist/${id[1]}_${id[2]}` });
  }
  return out;
}

/* ---------- Запросы к библиотеке ---------- */
// ответ бывает {data:[{list}]}, {payload:[0,[{list}]]} и т.п., поэтому ищем первый объект со списком треков где угодно в ответе
function findList(x, depth = 0) {
  if (!x || typeof x !== 'object' || depth > 6) return null;
  if (!Array.isArray(x) && Array.isArray(x.list)) return x;
  for (const v of Object.values(x)) { const r = findList(v, depth + 1); if (r) return r; }
  return null;
}

// POST на m.vk.*/audio, возвращает разобранный JSON. m.vk.ru не знает сессию окна входа и просит один раз «передать» cookie
// через login.vk.ru (role=pda_frame): делаем это и повторяем запрос
async function audioJson(host, form) {
  for (let attempt = 0; ; attempt++) {
    const { res, text } = await request(host, '/audio', form);
    let json;
    try { json = JSON.parse(text.replace(/^<!--/, '')); } catch (e) {
      log('not JSON:', res.status, res.url, text.slice(0, 160).replace(/\s+/g, ' '));
      if (/login|authcheck/i.test(res.url)) throw new AuthError('Session expired');
      throw new Error('Unexpected response from VK (HTTP ' + res.status + ')');
    }
    if (json && typeof json.location === 'string' && /^https:\/\/login\.vk\.(?:com|ru)\//.test(json.location)) {
      if (attempt >= 2) throw new Error('VK did not accept the session for m.' + host);
      log('cookie handshake:', json.location.slice(0, 60) + '…');
      const r = await ses().fetch(json.location, { credentials: 'include', headers: { 'User-Agent': chromeUA() } });
      await r.text(); // тело не нужно: важно, что VK выставил cookie для m.vk.ru
      continue;
    }
    return { json, res, text };
  }
}

let sampleLogged = false;
const streamCache = new Map();
let flagsLogged = false;   // диагностику по флагам пишем один раз за запуск
// playlistId '-1' — основной список «Моя музыка»; для плейлиста передаются его владелец (uid) и номер
async function loadSection(host, uid, offset, playlistId = '-1') {
  const { json, res, text } = await audioJson(host, {
    act: 'load_section', owner_id: String(uid), playlist_id: String(playlistId), offset: String(offset), type: 'playlist', access_hash: '', is_loading_all: '1',
  });
  const d = findList(json);
  if (!d) {
    log('no list in response:', res.status, res.url, text.slice(0, 400).replace(/\s+/g, ' '));
    throw new Error('VK returned no track list (see the [VK] line in the terminal)');
  }
  if (!sampleLogged && d.list[0]) { sampleLogged = true; log('first track item:', JSON.stringify(d.list[0]).slice(0, 700)); } // чтобы видеть, где лежат обложки и хэши
  const stat = new Map(); // значение поля [10] (флаги) -> [сколько треков со ссылкой, сколько без неё]
  for (const a of d.list) { // запоминаем прямые ссылки из списка: если reload_audio не даст ссылку, возьмём их
    const p = Array.isArray(a) ? pickStream(a) : null;
    if (p) streamCache.set(`${a[1]}_${a[0]}`, p);
    if (Array.isArray(a)) { const s = stat.get(String(a[10])) || [0, 0]; s[p ? 0 : 1]++; stat.set(String(a[10]), s); }
  }
  // если у каких-то треков в списке нет ссылки, по этой строке видно, не отличаются ли они флагами (так можно будет помечать закрытые заранее)
  if (!flagsLogged && [...stat.values()].some((s) => s[1])) log('list flags [10] -> with link / without:', [...stat].map(([f, s]) => `${f}: ${s[0]}/${s[1]}`).join(', '));
  flagsLogged = true;
  return d;
}

async function collectTracks(host, uid, limit, playlistId = '-1') {
  const out = [];
  for (let offset = 0, guard = 0; out.length < limit && guard < 40; guard++) {
    const d = await loadSection(host, uid, offset, playlistId);
    out.push(...d.list.map(toTrack).filter(Boolean));
    if (!d.hasMore || !d.list.length) break;
    offset += d.list.length;
  }
  return out.slice(0, limit);
}

async function fetchLibrary() {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const warnings = [];
  const safe = async (name, fn, fallback) => { try { return await fn(); } catch (e) { warnings.push(name + ': ' + e.message); return fallback; } };

  const liked = await collectTracks(host, uid, LIMITS.liked); // главный список: если он не загрузился, вся загрузка считается неудачной
  const [playlists, name] = await Promise.all([
    safe('playlists', async () => parsePlaylists((await request(host, `/audio?act=audio_playlists${uid}`)).text).slice(0, LIMITS.playlists), []),
    safe('profile', async () => {
      const m = (await request(host, `/id${uid}`)).text.match(/<title>\s*([^<|]+?)\s*(?:[|—–-]\s*(?:VK|ВКонтакте)[^<]*)?<\/title>/i);
      return m ? decode(m[1]) : '';
    }, ''),
  ]);
  return {
    me: { name: name || 'id' + uid, avatar: '', url: `https://vk.com/id${uid}` },
    mode: 'web',
    v: 2,                                          // версия формата списков (в кэше интерфейса): 2 — у треков есть поле lock
    updated: Date.now(),
    recent: liked.slice(0, LIMITS.recent), // у VK нет истории прослушиваний, поэтому здесь последние добавленные треки
    recommended: [],
    liked,
    likedComplete: liked.length < LIMITS.liked,   // false: список обрезан лимитом, и отсутствие трека в нём ничего не доказывает
    playlists,
    following: [],
    warnings,
  };
}

/* ---------- Ссылка на звук ---------- */
// Ссылка из списка устаревает, поэтому в момент нажатия «Играть» запрашиваем свежую (act=reload_audio).
// В данных трека (одно из полей элемента, JSON-строка) VK сам отдаёт готовые ссылки: {"audio_streams":[{"type":"aac","url":…,"fallback_url":…}, …}.
// Они не зашифрованы, поэтому играем их, а расшифровка ниже остаётся запасным способом.
const STREAM_HOST = /^[a-z0-9.-]+\.(?:okcdn\.ru|mycdn\.me|vkuseraudio\.(?:net|ru)|vkuser\.net|vk-cdn\.net)$/i;
const STREAM_RANK = ['mp3', 'aac', 'aac_eld', 'aac_low']; // лучшее первым; остальные типы (если есть) в конце
function pickStream(item) {
  const raw = item.find((x) => typeof x === 'string' && x.charCodeAt(0) === 123 && x.includes('audio_streams'));
  if (!raw) return null;
  let list;
  try { list = JSON.parse(raw).audio_streams; } catch (e) { return null; }
  const okUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && STREAM_HOST.test(x.hostname) ? u : ''; } catch (e) { return ''; } };
  const rank = (t) => { const i = STREAM_RANK.indexOf(t); return i < 0 ? 99 : i; };
  const found = (Array.isArray(list) ? list : []).filter((x) => x && okUrl(x.url)).sort((a, b) => rank(a.type) - rank(b.type))[0];
  return found ? { url: found.url, alt: okUrl(found.fallback_url), type: String(found.type || '') } : null;
}

// Если прямых ссылок нет, VK отдаёт заглушку audio_api_unavailable.mp3?extra=…, в ней настоящая ссылка в зашифрованном виде.
// Алфавит «своего» base64 у VK обычный, но буква O и цифра 0 поменяны местами; дальше цепочка операций (v, r, x, s, i).
const B64 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/=';
function unb64(t) {
  if (!t || t.length % 4 === 1) return '';
  let e = 0, n = 0, out = '';
  for (const ch of t) {
    const i = B64.indexOf(ch);
    if (i < 0) continue;
    e = n % 4 ? 64 * e + i : i;
    if (n++ % 4) out += String.fromCharCode(255 & (e >> (-2 * n & 6)));
  }
  return out;
}
function permute(t, e) {
  const n = t.length;
  if (!n) return t;
  const o = [];
  e = Math.abs(e);
  for (let s = n; s--;) { e = ((n * (s + 1)) ^ (e + s)) % n; o[s] = e; }
  const a = t.split('');
  for (let s = 1; s < n; s++) a[s] = a.splice(o[n - 1 - s], 1, a[s])[0];
  return a.join('');
}
const OPS = {
  v: (t) => t.split('').reverse().join(''),
  r: (t, e) => {
    const al = B64 + B64;
    return t.split('').map((c) => { const o = al.indexOf(c); if (o < 0) return c; let p = o - Number(e); if (p < 0) p += al.length; return al.charAt(p); }).join('');
  },
  x: (t, e) => { const k = String(e).charCodeAt(0); return t.split('').map((c) => String.fromCharCode(c.charCodeAt(0) ^ k)).join(''); },
  s: (t, e) => permute(t, Number(e)),
  i: (t, e, uid) => permute(t, Number(e) ^ uid),
};
function unmask(url, uid) {
  if (!url.includes('audio_api_unavailable')) return url;
  const parts = (url.split('?extra=')[1] || '').split('#');
  let e = unb64(parts[0]);
  const ops = parts[1] ? unb64(parts[1]).split('\t') : [];
  for (let n = ops.length; n--;) {
    const [name, ...args] = ops[n].split('\v');
    if (!OPS[name]) { log('unmask: unknown op', JSON.stringify(name)); return url; }
    e = OPS[name](e, args[0], uid);
  }
  if (!/^https:\/\//.test(e)) { log('unmask: result is not a link:', JSON.stringify(e.slice(0, 40))); return url; }
  return e;
}
const DECODED_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(?:vkuseraudio|vkuser|vk-cdn)\.(?:net|ru)$/i;

async function stream(vkId, hash) {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const [owner, id] = String(vkId).split('_');
  const h = String(hash || '').split('/');
  if (!owner || !id || !h[2] || !h[5]) {
    // хэша нет: берём ссылку из списка, если она там была, иначе это закрытый трек
    const cached = streamCache.get(String(vkId));
    log('no access hash for track', vkId, '| hash =', JSON.stringify(String(hash || '').slice(0, 60)), cached ? '| using the link from the list' : '| no link in the list either');
    if (cached) return { url: cached.url, alt: cached.alt, hls: '' };
    throw new NoLinkError('This track is not available in your region or account');
  }
  const { json, text } = await audioJson(host, { act: 'reload_audio', ids: [owner, id, h[2], h[5]].join('_') });
  const list = json && json.data && json.data[0];
  const item = Array.isArray(list) ? list[0] : null;
  let direct = item && pickStream(item);
  if (!direct) {
    const raw = item && item.find((x) => typeof x === 'string' && x.charCodeAt(0) === 123);
    log('no audio_streams in reload_audio; track', vkId, 'flags [10] =', item ? item[10] : '-', '| item:', item ? item.map((x, i) => i + ':' + (typeof x === 'string' ? 's' + x.length : typeof x)).join(' ') : 'none', '| json:', raw ? raw.slice(0, 200) : '-');
    direct = streamCache.get(String(vkId)) || null; // ссылка, полученная при загрузке списка (живёт около суток)
    if (direct) log('using the link from the library list');
  }
  if (!direct && item && typeof item[2] === 'string') { // заглушка с зашифрованной ссылкой
    const url = unmask(item[2], uid);
    let hn = '';
    try { hn = new URL(url).hostname; } catch (e) { /* ниже */ }
    if (!/audio_api_unavailable/.test(url) && DECODED_HOST.test(hn)) direct = { url, alt: '', type: 'decoded' };
    else log('could not decode the link, host =', JSON.stringify(hn));
  }
  if (!direct) throw new NoLinkError('This track is not available in your region or account');
  log('stream:', direct.type, new URL(direct.url).hostname);
  return { url: direct.url, alt: direct.alt, hls: '' };
}

/* ---------- Страницы ---------- */
// Треки плейлиста: тот же запрос, что и для основного списка, только с номером плейлиста и его владельцем.
async function playlistPage(ref) {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const owner = String((ref && ref.owner) || '');
  const id = String((ref && ref.id) || '');
  if (!/^-?\d+$/.test(owner) || !/^\d+$/.test(id)) throw new Error('Bad playlist id');
  return { tracks: await collectTracks(host, owner, LIMITS.liked, id) };
}

// «Открыть на VK»: только адреса самого сайта
const VK_LINK = /^https:\/\/(m\.)?vk\.(com|ru)\/\S+$/i;

/* ---------- Лайки ---------- */
// «Лайк» в VK — это аудиозапись в вашем списке: лайк добавляет трек (или возвращает только что удалённый), снятие лайка удаляет.
// Запросы VK не документирует. Хэши трека через «/»: 0 — добавить, 3 — удалить, 6 — вернуть удалённое.
// Прямой запрос на al_audio.php VK принимает не всегда (отвечает «перейдите на страницу /audio»), поэтому если он не прошёл, то же самое
// делается изнутри скрытой страницы vk.com/audio её собственным ajax.post, с хэшами из списка, который загрузила эта же страница.
// Принял ли VK изменение на самом деле, решает не этот ответ, а список, который приложение перезагружает следом.
const HASH_AT = { add: 0, delete_audio: 3, restore_audio: 6 };

function likeForm(track, on) {
  const [owner, id] = String((track && track.vkId) || '').split('_');
  if (!/^-?\d+$/.test(owner || '') || !/^\d+$/.test(id || '')) throw new Error('Bad track id');
  const hashes = String((track && track.hash) || '').split('/');
  const act = on ? (hashes[0] ? 'add' : 'restore_audio') : 'delete_audio';
  const hash = hashes[HASH_AT[act]];
  if (!hash) throw new Error('No hash for this action: refresh the library');
  const trackCode = String((track && track.trackCode) || '');
  const form = { al: '1', act, hash, oid: owner, aid: id };
  if (act === 'add') Object.assign(form, { group_id: '0', gid: '0', album_id: '-2', owner_id: owner, audio_id: id });
  if (act === 'delete_audio') form.restore = '1';
  if (trackCode) form.track_code = trackCode;
  return { form, act, owner, id, hashes, trackCode, key: `${owner}_${id}` };
}
const payloadCode = (json) => (json && Array.isArray(json.payload) ? json.payload[0] : undefined);

// выполняется внутри страницы vk.com/audio
function inVkPage(want) {
  return new Promise((resolve) => {
    let finished = false;
    const done = (r) => { if (!finished) { finished = true; resolve(r); } };
    setTimeout(() => done({ ok: false, error: 'No answer from the VK page' }), 25000);
    const findList = (x, depth = 0) => {
      if (!x || typeof x !== 'object' || depth > 6) return null;
      if (!Array.isArray(x) && Array.isArray(x.list)) return x;
      for (const v of Object.values(x)) { const r = findList(v, depth + 1); if (r) return r; }
      return null;
    };
    const HASH_AT = { add: 0, delete_audio: 3, restore_audio: 6 };
    const send = (hashes, trackCode, fromPage) => {
      const hash = hashes[HASH_AT[want.act]];
      if (!hash) return done({ ok: false, error: 'No hash for this action' });
      const q = { al: 1, act: want.act, hash, oid: want.owner, aid: want.id };
      if (want.act === 'add') Object.assign(q, { group_id: 0, gid: 0, album_id: -2, owner_id: want.owner, audio_id: want.id });
      if (want.act === 'delete_audio') q.restore = 1;
      if (trackCode) q.track_code = trackCode;
      window.ajax.post('al_audio.php?act=' + want.act, q, {
        onDone: () => done({ ok: true, fromPage }),
        onFail: (m) => done({ ok: false, error: 'VK refused the request: ' + String(m || 'unknown') }),
      });
    };
    // свежие хэши этого трека берём из списка, который страница загружает сама (у трека, которого уже нет в списке, остаются хэши из приложения)
    const find = (offset) => {
      window.ajax.post('al_audio.php?act=load_section', { act: 'load_section', type: 'playlist', owner_id: want.uid, playlist_id: -1, offset, is_loading_all: 1, al: 1 }, {
        onDone: (...args) => {
          const d = findList(args);
          const a = d && d.list.find((x) => Array.isArray(x) && String(x[1]) === want.owner && String(x[0]) === want.id);
          if (a) return send(String(a[13] || '').split('/'), String(a[20] || ''), true);
          if (d && d.hasMore && d.list.length) return find(offset + d.list.length);
          send(want.hashes, want.trackCode, false);
        },
        onFail: () => send(want.hashes, want.trackCode, false),
      });
    };
    const start = (tries) => {
      if (window.ajax && window.ajax.post) return find(0);
      if (tries > 80) return done({ ok: false, error: 'The VK page did not load' });
      setTimeout(() => start(tries + 1), 250);
    };
    start(0);
  });
}

let vkBridgeWin = null;
let vkBridgeTimer = null;
async function pageLike(host, want) {
  if (!vkBridgeWin || vkBridgeWin.isDestroyed()) {
    const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.setUserAgent(chromeUA());
    win.on('closed', () => { if (vkBridgeWin === win) vkBridgeWin = null; });
    vkBridgeWin = win;
    await win.loadURL(`https://${host}/audio`);
  }
  const win = vkBridgeWin;
  if (/login|authcheck/i.test(win.webContents.getURL())) { win.destroy(); return { ok: false, auth: true, error: 'Session expired' }; }
  clearTimeout(vkBridgeTimer);
  vkBridgeTimer = setTimeout(() => { if (vkBridgeWin && !vkBridgeWin.isDestroyed()) vkBridgeWin.destroy(); }, 3 * 60 * 1000);   // окно живёт недолго
  return win.webContents.executeJavaScript(`(${inVkPage.toString()})(${JSON.stringify(want)})`);
}

async function like(track, on) {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const { form, act, owner, id, hashes, trackCode, key } = likeForm(track, on);

  // 1. прямой запрос
  try {
    const res = await ses().fetch(`https://${host}/al_audio.php`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'User-Agent': chromeUA(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', Origin: `https://${host}`, Referer: `https://${host}/audio` },
      body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    log('like', act, key, 'direct ->', res.status, text.slice(0, 160).replace(/\s+/g, ' '));
    if (/login|authcheck/i.test(res.url)) throw new AuthError('Session expired');
    let json = null;
    try { json = JSON.parse(text.replace(/^<!--/, '')); } catch (e) { /* ответ не в JSON */ }
    if (res.ok && String(payloadCode(json)) === '0') return;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    log('direct like failed:', String((e && e.message) || e));
  }

  // 2. изнутри страницы
  const r = await pageLike(host, { uid: String(uid), owner, id, act, hashes, trackCode });
  log('like', act, key, 'via page ->', JSON.stringify(r).slice(0, 200));
  if (r && r.ok) return;
  if (r && r.auth) throw new AuthError('Session expired');
  throw new Error((r && r.error) || 'VK refused the request');
}

/* ---------- Вход через окно сайта ---------- */
function errorPage(desc, url) {
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:32px;color:#222">
    <h3>VK did not load</h3><p>${esc(desc)}</p><p style="color:#777;word-break:break-all">${esc(url)}</p>
    <p>Check your internet connection, close this window and try again.</p>`;
}

// Вошли ли мы? Номер пользователя ищем двумя способами:
//  1) на странице VK после входа обычно есть глобальный объект vk с номером: vk.id (до входа он 0);
//  2) если сайт его не отдаёт, берём номер из ссылок мобильной страницы m.vk.com/audio (она открывается только после входа).
async function uidFromSite(host) {
  const { text } = await request(host, '/audio');
  for (const re of [/act=audio_playlists(-?\d+)/, /\/audios(\d+)/, /"user_id"\s*:\s*(\d+)/, /vk_id["']?\s*[:=]\s*(\d+)/]) {
    const m = text.match(re);
    if (m && Number(m[1]) > 0) return Number(m[1]);
  }
  log('uid not found on m.' + host + '/audio, page starts with:', text.slice(0, 120).replace(/\s+/g, ' '));
  return 0;
}

let tick = 0;
async function signedInUser(win) {
  const url = win.webContents.getURL();
  const host = hostOf(url);
  tick++;
  let uid = 0;
  if (host) {
    try { uid = Number(await win.webContents.executeJavaScript('(window.vk && Number(window.vk.id)) || 0')) || 0; } catch (e) { /* страница ещё грузится */ }
    if (!uid && tick % 3 === 0) { try { uid = await uidFromSite(host); } catch (e) { log('uidFromSite failed:', e.message); } }
  }
  if (tick % 4 === 1) log('waiting for sign-in: page =', url.slice(0, 80), '| uid =', uid || 'none'); // раз в ~6 секунд, чтобы видеть, что происходит
  return host && Number.isInteger(uid) && uid > 0 ? { uid, host } : null;
}

let loginBusy = false;
async function login(parent) {
  const saved = readConf();
  if (saved.uid) { // уже вошли раньше: окно не нужно
    try { await loadSection(saved.host, saved.uid, 0); return { ok: true }; } catch (e) { /* значит, нужен вход */ }
  }

  const win = new BrowserWindow({
    width: 520, height: 780, parent: parent || undefined, autoHideMenuBar: true,
    title: 'VK', backgroundColor: '#ffffff',
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const wc = win.webContents;
  wc.setUserAgent(chromeUA());
  wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: переход отменён самой страницей
    log('did-fail-load', code, desc, failedUrl);
    win.loadFailure = desc;
    if (!win.isDestroyed()) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorPage(desc, failedUrl)));
  });
  wc.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F12') wc.toggleDevTools(); });
  log('opening vk.com');
  win.loadURL('https://vk.com/').catch((e) => log('loadURL rejected:', e && e.message));

  return new Promise((resolve) => {
    let done = false;
    let busy = false;
    const finish = (r) => { if (done) return; done = true; clearInterval(timer); clearTimeout(limit); if (!win.isDestroyed()) win.destroy(); resolve(r); };
    // пока пользователь входит, раз в пару секунд проверяем, появился ли номер пользователя
    const timer = setInterval(async () => {
      if (busy || done || win.isDestroyed()) return;
      busy = true;
      try {
        const who = await signedInUser(win);
        if (who) {
          log('user found:', who.uid, who.host);
          try { await loadSection(who.host, who.uid, 0); saveConf(who); finish({ ok: true }); } // убеждаемся, что список реально открывается
          catch (e) { log('list check failed:', e.message); if (!(e instanceof AuthError)) finish({ ok: false, error: e.message }); } // AuthError: cookie ещё не дошли
        }
      } catch (e) { log('check error:', e.message); } finally { busy = false; }
    }, 1500);
    const limit = setTimeout(() => finish({ ok: false, error: 'Sign-in timed out' }), 10 * 60 * 1000);
    win.on('closed', () => finish(win.loadFailure ? { ok: false, error: win.loadFailure } : { ok: false, cancelled: true }));
  });
}

/* ---------- Общие действия ---------- */
const status = () => { const c = readConf(); return { connected: !!c.uid, mode: c.uid ? 'web' : null }; };

async function library() {
  try { return { ok: true, library: await fetchLibrary() }; } catch (e) {
    return { ok: false, auth: e instanceof AuthError, error: String((e && e.message) || e) };
  }
}

async function logout() {
  saveConf({});
  try { await ses().clearStorageData(); } catch (e) { /* ничего */ }
}

function register(ipcMain, winOf) {
  ipcMain.handle('vk:status', () => status());
  ipcMain.handle('vk:library', () => library());
  ipcMain.handle('vk:stream', async (_e, vkId, hash) => {
    try { return { ok: true, ...(await stream(vkId, hash)) }; } catch (e) {
      log('stream failed:', vkId, '|', String((e && e.message) || e));   // любая неудача оставляет строку в терминале
      return { ok: false, auth: e instanceof AuthError, lock: e instanceof NoLinkError ? 'region' : undefined, error: String((e && e.message) || e) };
    }
  });
  ipcMain.handle('vk:playlist', async (_e, ref) => {
    try { return { ok: true, data: await playlistPage(ref) }; } catch (e) {
      log('playlist failed:', String((e && e.message) || e));
      return { ok: false, auth: e instanceof AuthError, error: String((e && e.message) || e) };
    }
  });
  ipcMain.handle('vk:open-link', async (_e, url) => {
    const u = typeof url === 'string' ? url.trim() : '';
    if (!VK_LINK.test(u)) return false;
    await shell.openExternal(u);
    return true;
  });
  ipcMain.handle('vk:like', async (_e, track, on) => {
    try { await like(track, !!on); return { ok: true }; } catch (e) {
      log('like failed:', String((e && e.message) || e));
      return { ok: false, auth: e instanceof AuthError, error: String((e && e.message) || e) };
    }
  });
  ipcMain.handle('vk:logout', async () => { await logout(); return true; });
  ipcMain.handle('vk:login', async (e) => {
    if (loginBusy) return { ok: false, error: 'Sign-in is already in progress' };
    loginBusy = true;
    try { return await login(winOf(e)); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } finally { loginBusy = false; }
  });
}

module.exports = { register, _test: { pickStream, unmask, toTrack, parsePlaylists, decode, art, loadSection, collectTracks, AuthError, NoLinkError, stream, streamCache, like, inVkPage, playlistPage } };
