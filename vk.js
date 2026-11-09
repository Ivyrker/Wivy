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

// У VK номера исполнителей длиннее 15 цифр (больше 2^53), поэтому они только строки: Number() их испортил бы.
// число, не помещающееся в безопасный диапазон, JSON.parse уже испортил: такой номер не принимаем
const idStr = (x) => ((typeof x === 'string' || (typeof x === 'number' && Number.isSafeInteger(x))) && /^\d{1,24}$/.test(String(x)) ? String(x) : '');
const artistList = (x) => (Array.isArray(x) ? x.map((e) => (e && idStr(e.id) && e.name ? { id: idStr(e.id), name: decode(e.name) } : null)).filter(Boolean) : []);

// элемент списка — массив: [0] id, [1] владелец, [3] название, [4] исполнитель, [5] длительность, [13] хэши, [14] обложки через запятую,
// [17] главные исполнители [{id, name}], [18] приглашённые, [19] альбом [владелец, номер, access_hash], [20] служебный код
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
  const extra = {};
  const main = artistList(a[17]);
  if (main.length) extra.artists = main;
  const feat = artistList(a[18]);
  if (feat.length) extra.featured = feat;
  if (Array.isArray(a[19]) && /^-?\d{1,20}$/.test(String(a[19][0])) && /^\d{1,20}$/.test(String(a[19][1]))) {
    extra.albumRef = { owner: String(a[19][0]), id: String(a[19][1]), hash: /^[A-Za-z0-9]{0,40}$/.test(String(a[19][2] || '')) ? String(a[19][2] || '') : '' };
  }
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
    ...extra,
  };
}

// плейлисты мобильный сайт отдаёт только готовой страницей, поэтому разбираем её разметку
// Мобильная страница плейлистов теперь отдаётся JSON-обёрткой {"title": …, "html": "<div …>"}, где кавычки экранированы: достаём html
function unwrapHtml(s) {
  const t = String(s == null ? '' : s);
  if (t.trimStart().startsWith('{')) {
    try { const j = JSON.parse(t); if (j && typeof j.html === 'string') return j.html; } catch (e) { /* не обёртка */ }
  }
  return t;
}

function parsePlaylists(raw) {
  const html = unwrapHtml(raw);
  const out = [];
  const item = /<div[^>]+class="[^"]*audioPlaylistsPage__item/;
  for (const block of html.split(new RegExp('(?=' + item.source + ')')).filter((b) => b.search(item) === 0)) { // кусок страницы до первой карточки отбрасываем
    const id = block.match(/act=audio_playlist(-?\d+)_(\d+)/);
    const title = block.match(/audioPlaylistsPage__title[^>]*>\s*([^<]+)/);
    if (!id || !title) continue;
    const plain = decode(block.replace(/<[^>]*>/g, ' ').replace(/&(?:nbsp|thinsp|#160|#8201|#8239);/gi, ' ')).replace(/[\u00a0\u2009\u202f]/g, ' ');   // текст карточки без разметки
    const num = (m) => (m ? Number(m[1].replace(/\D/g, '')) : 0);                                  // «6 345» → 6345
    const count = num(plain.match(/(\d[\d ]*)\s*(?:аудиозапис|аудио\b|трек|песн|track|song)/i));
    const plays = num(plain.match(/(\d[\d ]*)\s*(?:прослуш|listen|play)/i));
    const cover = block.match(/url\(\s*['"]?(https:[^'")\s]+)/);
    const hash = block.match(/access_hash=([A-Za-z0-9]{1,40})/);
    const author = block.match(/audioPlaylistsPage__author[^>]*>\s*([^<]+)/);
    out.push({ name: decode(title[1]), count, art: art(cover && cover[1]), url: `https://vk.com/music/playlist/${id[1]}_${id[2]}`,
      vkOwner: id[1], vkPlaylistId: id[2], accessHash: hash ? hash[1] : '', author: author ? decode(author[1]) : '', plays: plays ? String(plays) : '' });
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
let metaLogged = false;
const streamCache = new Map();
let flagsLogged = false;   // диагностику по флагам пишем один раз за запуск
// playlistId '-1' — основной список «Моя музыка»; для плейлиста передаются его владелец (uid), номер и access_hash (нужен чужим закрытым плейлистам)
async function loadSection(host, uid, offset, playlistId = '-1', accessHash = '') {
  const { json, res, text } = await audioJson(host, {
    act: 'load_section', owner_id: String(uid), playlist_id: String(playlistId), offset: String(offset), type: 'playlist', access_hash: String(accessHash || ''), is_loading_all: '1',
  });
  const d = findList(json);
  if (!d) {
    log('no list in response:', res.status, res.url, text.slice(0, 400).replace(/\s+/g, ' '));
    throw new Error('VK returned no track list (see the [VK] line in the terminal)');
  }
  if (playlistId !== '-1' && !metaLogged) { // что VK кладёт рядом со списком плейлиста: по этой строке видно, откуда брать название, автора и обложку
    metaLogged = true;
    log('playlist section keys:', Object.keys(d).join(','), '| scalars:', Object.entries(d).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => k + '=' + (/hash/i.test(k) ? String(v).slice(0, 6) + '…' : scrub(String(v).slice(0, 60)))).join('; '));
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

// metaOut (необязательно) получает метаданные плейлиста из первого ответа
async function collectTracks(host, uid, limit, playlistId = '-1', accessHash = '', metaOut = null) {
  const out = [];
  for (let offset = 0, guard = 0; out.length < limit && guard < 40; guard++) {
    const d = await loadSection(host, uid, offset, playlistId, accessHash);
    if (metaOut && offset === 0) Object.assign(metaOut, playlistMeta(d));
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
    safe('playlists', async () => {
      const lists = parsePlaylists((await request(host, `/audio?act=audio_playlists${uid}`)).text).slice(0, LIMITS.playlists);
      // На мобильной странице числа треков нет. Пробуем тот же раздел «Плейлисты» в формате, как у поиска (title, totalCount, coverUrl, accessHash);
      // не получилось (формат не подтверждён): остаются данные страницы, а точное число появится при открытии плейлиста.
      try {
        const r = await alAudio(host, { al: '1', act: 'section', claim: '0', is_layer: '0', owner_id: String(uid), section: 'playlists' }, 'playlists', { page: false });
        const tiles = new Map(collectPlaylists(r.payload, []).map(tileOf).filter(Boolean).map((x) => [x.vkOwner + '_' + x.vkPlaylistId, x]));
        for (const p of lists) {
          const x = tiles.get(p.vkOwner + '_' + p.vkPlaylistId);
          if (x) { if (x.count) p.count = x.count; if (!p.art && x.art) p.art = x.art; if (!p.accessHash && x.accessHash) p.accessHash = x.accessHash; if (!p.author && x.artist) p.author = x.artist; }
        }
      } catch (e) { if (e instanceof AuthError) throw e; }
      return lists;
    }, []),
    safe('profile', async () => {
      const m = (await request(host, `/id${uid}`)).text.match(/<title>\s*([^<|]+?)\s*(?:[|—–-]\s*(?:VK|ВКонтакте)[^<]*)?<\/title>/i);
      return m ? decode(m[1]) : '';
    }, ''),
  ]);
  return {
    me: { name: name || 'id' + uid, avatar: '', url: `https://vk.com/id${uid}` },
    mode: 'web',
    v: 4,                                          // версия формата списков (в кэше интерфейса): 4 — есть following и число треков плейлистов
    updated: Date.now(),
    recent: liked.slice(0, LIMITS.recent), // у VK нет истории прослушиваний, поэтому здесь последние добавленные треки
    recommended: [],
    liked,
    likedComplete: liked.length < LIMITS.liked,   // false: список обрезан лимитом, и отсутствие трека в нём ничего не доказывает
    playlists,
    following: artistsFromTracks(liked, 100),   // у VK нет списка подписок, который я мог бы подтвердить: показываем исполнителей из вашей библиотеки
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

/* ---------- Поиск, исполнители и плейлисты других людей ---------- */
// Запросы al_audio.php устроены как у лайков: сначала прямой, а если VK не принял, то изнутри скрытой страницы vk.com/audio.
// Разборы защитные: если форма ответа не совпала, запись пропускается, а в терминал попадает короткий образец (без ключей доступа).
const SAFE_CURSOR = /^[\x21-\x7e]{1,600}$/;
// Постраничность поиска по блокам (start_from = nextOffset + block_id) в пробе вернула пустой ответ, поэтому по умолчанию выключена:
// иначе кнопка «Show more» появлялась бы и ничего не давала. Включается, когда будет подтверждён рабочий запрос.
const VK_BLOCK_PAGING = false;
const ARTIST_KEY = /^[A-Za-z0-9_.-]{1,64}$/;

// образец ответа для лога: без адресов с подписями, номера пользователя и cookie
function scrub(s, uid) {
  let t = String(s == null ? '' : s)
    .replace(/https?:\/\/[^\s"'<>\\]+/g, (u) => u.replace(/[?#].*$/, '?…'))
    .replace(/remixsid[^;\s"']*/gi, 'remixsid=…');
  if (uid) t = t.split(String(uid)).join('UID');
  return t.replace(/\s+/g, ' ');
}

// VK отдаёт ответы al_*.php в windows-1251, а res.text() всегда читает UTF-8 (кириллица превращается в «���»): берём кодировку из заголовка
async function readText(res) {
  if (typeof res.arrayBuffer !== 'function') return res.text();
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = String((res.headers && res.headers.get && res.headers.get('content-type')) || '');
  const m = /charset\s*=\s*"?([\w-]+)/i.exec(ct);
  const decodeAs = (cs) => { try { return new TextDecoder(cs).decode(buf); } catch (e) { return ''; } };
  if (m) return decodeAs(m[1].toLowerCase()) || buf.toString('utf8');
  const utf = buf.toString('utf8');
  return utf.includes('\uFFFD') ? decodeAs('windows-1251') || utf : utf;   // кодировка не указана: если UTF-8 даёт «�», это windows-1251
}

// метаданные плейлиста из ответа load_section (имена полей взяты из публичных описаний, у VK они меняются: пустое значение пропускается)
function playlistMeta(d) {
  const pick = (...names) => { for (const n of names) { const v = d && d[n]; if (v !== undefined && v !== null && typeof v !== 'object' && String(v) !== '') return v; } return ''; };
  const strip = (s) => decode(String(s).replace(/<[^>]*>/g, ' '));
  const meta = {
    name: decode(pick('title', 'name')),
    desc: decode(pick('description')),
    artist: strip(pick('authorName', 'author_name', 'authorLine', 'author_line')),
    plays: Number(pick('listens')) || 0,
    art: art(pick('thumb', 'coverUrl')),
    count: Number(pick('size', 'totalCount', 'total_count')) || Number((String(pick('infoLine2')).replace(/[^\d ]/g, '').replace(/\s+/g, '').match(/\d+/) || [0])[0]) || 0,
    hash: String(pick('accessHash', 'access_hash')),
  };
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v));
}

// Треки плейлиста: тот же запрос, что и для основного списка, с номером плейлиста, его владельцем и access_hash.
async function playlistPage(ref) {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const owner = String((ref && ref.owner) || '');
  const id = String((ref && ref.id) || '');
  const hash = String((ref && ref.hash) || '');
  if (!/^-?\d+$/.test(owner) || !/^\d+$/.test(id) || !/^[A-Za-z0-9]{0,40}$/.test(hash)) throw new Error('Bad playlist id');
  const meta = {};
  const tracks = await collectTracks(host, owner, LIMITS.liked, id, hash, meta);
  return { tracks, playlist: meta };
}

// Число треков плейлиста, которого нет в списке (раздел «Плейлисты» отдаёт только первые 20, мобильная страница числа не содержит).
// Лёгкий запрос: смещение за пределом списка, метаданные приходят и с пустым списком; не пришли, тогда обычная загрузка плейлиста.
async function countOf(host, r) {
  try {
    const n = playlistMeta(await loadSection(host, r.owner, 999999, r.id, r.hash)).count;
    if (n) return n;
  } catch (e) { if (e instanceof AuthError) throw e; }
  const meta = {};
  const tracks = await collectTracks(host, r.owner, LIMITS.liked, r.id, r.hash, meta);
  return meta.count || tracks.length;
}

// refs: [{ owner, id, hash }]; ответ: { counts: { 'владелец_номер': число } }. Идёт в три потока и не дольше 30 секунд; что не успело, придёт в следующий раз
async function playlistCounts(refs) {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const list = (Array.isArray(refs) ? refs : []).slice(0, 100)
    .map((r) => ({ owner: String((r && r.owner) || ''), id: String((r && r.id) || ''), hash: String((r && r.hash) || '') }))
    .filter((r) => /^-?\d+$/.test(r.owner) && /^\d+$/.test(r.id) && /^[A-Za-z0-9]{0,40}$/.test(r.hash));
  const counts = {};
  const deadline = Date.now() + 30000;
  let next = 0;
  const worker = async () => {
    while (next < list.length && Date.now() < deadline) {
      const r = list[next++];
      try { counts[`${r.owner}_${r.id}`] = await countOf(host, r); } catch (e) {
        if (e instanceof AuthError) throw e;
        log('playlist count failed:', String((e && e.message) || e));
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { counts };
}

// Выполняется внутри страницы vk.com/audio: тот же al_audio.php, но её собственным ajax.post (со всеми служебными полями сайта)
function inVkAjax(want) {
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;
    const done = (r) => { if (!finished) { finished = true; clearTimeout(timer); resolve(r); } };
    timer = setTimeout(() => done({ ok: false, error: 'No answer from the VK page' }), 20000);
    const start = (tries) => {
      if (!(window.ajax && window.ajax.post)) {
        if (tries > 80) return done({ ok: false, error: 'The VK page did not load' });
        return setTimeout(() => start(tries + 1), 250);
      }
      window.ajax.post('al_audio.php', want.form, {
        onDone: (...args) => done({ ok: true, args: JSON.parse(JSON.stringify(args)) }),
        onFail: (m) => done({ ok: false, error: 'VK refused the request: ' + String(m || 'unknown') }),
      });
    };
    start(0);
  });
}

// Запрос к al_audio.php. Результат — массив payload[1] (в нём HTML и объект с данными), как бы он ни был получен.
async function alAudio(host, form, label, opts) {
  try {
    const res = await ses().fetch(`https://${host}/al_audio.php`, {
      method: 'POST',
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': chromeUA(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', Origin: `https://${host}`, Referer: `https://${host}/audio` },
      body: new URLSearchParams(form).toString(),
    });
    const text = await readText(res);
    if (/login|authcheck/i.test(res.url)) throw new AuthError('Session expired');
    let json = null;
    try { json = JSON.parse(text.replace(/^<!--/, '')); } catch (e) { /* ответ не в JSON */ }
    const code = payloadCode(json);
    if (res.ok && String(code) === '0' && Array.isArray(json.payload[1])) return { payload: json.payload[1], via: 'direct' };
    log(label, 'direct ->', res.status, code === undefined ? 'no payload' : 'code ' + code);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    log(label, 'direct failed:', String((e && e.message) || e));
  }
  if (opts && opts.page === false) throw new Error('VK did not accept the direct request');   // необязательный запрос: страницу ради него не открываем
  const r = await pageCall(host, inVkAjax, { form });
  if (r && r.auth) throw new AuthError('Session expired');
  if (!r || !r.ok) throw new Error((r && r.error) || 'VK did not answer');
  return { payload: r.args, via: 'page' };
}

// плитки плейлистов и альбомов из HTML (классы настольной версии из открытых описаний; не нашлись — пробуем разметку мобильной)
function parseTiles(html) {
  const text = String(html || '');
  const out = [];
  const blocks = text.split(/(?=<div[^>]+class="[^"]*audio_pl_item2)/).filter((b) => /^<div[^>]+class="[^"]*audio_pl_item2/.test(b));
  for (const b of blocks) {
    const id = b.match(/(?:\/music\/(playlist|album)\/|audio_playlist)(-?\d+)_(\d+)(?:_([A-Za-z0-9]{6,40}))?/);
    const title = b.match(/audio_pl__title[^>]*>\s*([^<]+)/) || b.match(/audio_pl_snippet__title[^>]*>\s*([^<]+)/) || b.match(/\btitle="([^"]{1,200})"/);
    if (!id || !title) continue;
    const author = b.match(/audio_pl_snippet__artist_link[^>]*>\s*([^<]+)/);
    const count = b.match(/audio_pl__stats_count[^>]*>\s*(\d+)/) || b.match(/(\d+)\s*(?:аудио|трек|песн|track|song)/i);
    const cover = b.match(/url\(\s*(?:&quot;|["'])?(https:[^'")&\s]+)/);
    const hash = (b.match(/access_hash=([A-Za-z0-9]{6,40})/) || [])[1] || id[4] || '';
    out.push({
      name: decode(title[1]), artist: author ? decode(author[1]) : '', count: count ? Number(count[1]) : 0, art: art(cover && cover[1]),
      url: `https://vk.com/music/playlist/${id[2]}_${id[3]}`, vkOwner: id[2], vkPlaylistId: id[3], accessHash: hash,
      isAlbum: id[1] === 'album' || /audio_pl_item2[^"]*album/i.test(b.slice(0, 240)),
    });
  }
  return out.length ? out : parsePlaylists(text);
}

// все data-audio="[...]" из HTML (ответ бывает и «экранированным» внутри JSON-строки)
function dataAudioItems(text) {
  const t = String(text || '');
  const norm = t.includes('\\"') ? t.replace(/\\"/g, '"').replace(/\\\//g, '/') : t;
  const out = [];
  for (const m of norm.matchAll(/data-audio="([^"]*)"/g)) {
    try { const a = JSON.parse(decode(m[1])); if (Array.isArray(a)) out.push(a); } catch (e) { /* битая запись */ }
  }
  return out;
}

// в выдаче поиска элементы бывают «короткими» (только номера): недостающее догружаем тем же reload_audio, что и для звука
async function hydrateItems(host, items) {
  const full = [];
  const short = [];
  for (const a of items) {
    if (!Array.isArray(a)) continue;
    (a.length >= 6 && a[3] ? full : short).push(a);
  }
  for (let i = 0; i < short.length; i += 10) {
    const ids = short.slice(i, i + 10).map((a) => { const h = String(a[13] || '').split('/'); return h[2] && h[5] ? [a[1], a[0], h[2], h[5]].join('_') : ''; }).filter(Boolean).join(',');
    if (!ids) continue;
    try {
      const { json } = await audioJson(host, { act: 'reload_audio', ids });
      const list = json && json.data && json.data[0];
      if (Array.isArray(list)) full.push(...list.filter(Array.isArray));
    } catch (e) {
      if (e instanceof AuthError) throw e;
      log('hydrate failed:', String((e && e.message) || e));
    }
  }
  return full;
}

// Форма элемента трека подтверждена пробами: массив от 14 элементов, [0] и [1] числа, [3] название, [13] хэши. Ищем такие массивы где угодно
// во вложенных объектах, поэтому разбор не зависит от того, как именно VK назвал поле со списком.
const looksLikeAudio = (a) => Array.isArray(a) && a.length >= 14 && typeof a[0] === 'number' && typeof a[1] === 'number' && typeof a[3] === 'string' && typeof a[13] === 'string';
function collectAudio(x, out, budget = { n: 200000 }, depth = 0) {
  if (!x || typeof x !== 'object' || depth > 9 || --budget.n < 0) return out;
  if (Array.isArray(x)) {
    if (looksLikeAudio(x)) { out.push(x); return out; }
    for (const v of x) collectAudio(v, out, budget, depth + 1);
  } else for (const v of Object.values(x)) collectAudio(v, out, budget, depth + 1);
  return out;
}
// объекты вида плейлиста или альбома: ownerId, id и title (как в ответе поиска)
function collectPlaylists(x, out, budget = { n: 200000 }, depth = 0) {
  if (!x || typeof x !== 'object' || depth > 9 || --budget.n < 0) return out;
  if (!Array.isArray(x) && x.ownerId !== undefined && x.id !== undefined && x.title) out.push(x);
  for (const v of Array.isArray(x) ? x : Object.values(x)) collectPlaylists(v, out, budget, depth + 1);
  return out;
}

// В объекте ответа поиска массив playlists содержит блоки: блок треков (в нём list) и плитки плейлистов и альбомов (list пуст).
// У плитки есть готовые поля, поэтому разбирать HTML не нужно. Альбомы каталога имеют владельца вида -2000xxxxxx.
function tileOf(p) {
  if (!p || typeof p !== 'object' || (Array.isArray(p.list) && p.list.length)) return null;   // блок треков — не плитка
  const strip = (s) => decode(String(s == null ? '' : s).replace(/<[^>]*>/g, ' '));
  const owner = String(p.ownerId === undefined || p.ownerId === null ? '' : p.ownerId);
  const id = String(p.id === undefined || p.id === null ? '' : p.id);
  if (!/^-?\d+$/.test(owner) || !/^\d+$/.test(id) || !p.title) return null;
  const hash = /^[A-Za-z0-9]{0,40}$/.test(String(p.accessHash || '')) ? String(p.accessHash || '') : '';
  return {
    name: strip(p.title), artist: strip(p.authorName || p.authorLine), count: Number(p.totalCount) || 0, art: art(p.coverUrl),
    url: `https://vk.com/music/playlist/${owner}_${id}`, vkOwner: owner, vkPlaylistId: id, accessHash: hash,
    isAlbum: String(p.type || '').toLowerCase() === 'album' || /^-2\d{9}$/.test(owner), plays: String(p.listens || ''),
  };
}
function tilesFromJson(obj) {
  const arr = obj && Array.isArray(obj.playlists) ? obj.playlists : [];
  const seen = new Set();
  return arr.map(tileOf).filter((x) => x && !seen.has(x.vkOwner + '_' + x.vkPlaylistId) && seen.add(x.vkOwner + '_' + x.vkPlaylistId));
}

// достаём из payload[1] список треков, HTML и курсор продолжения
function parseSearch(payload) {
  const p = Array.isArray(payload) ? payload : [];
  const html = typeof p[0] === 'string' ? p[0] : '';
  const obj = [p[1], p[0], p[2]].find((x) => x && typeof x === 'object' && !Array.isArray(x)) || null;
  // блоки: основной (playlist) и все из playlists; список берём из самого большого (у одного может быть пустой)
  const blocks = obj ? [obj.playlist, ...(Array.isArray(obj.playlists) ? obj.playlists : [])].filter((b) => b && typeof b === 'object') : [];
  let list = blocks.map((b) => b.list).filter((l) => Array.isArray(l)).sort((a, b) => b.length - a.length)[0] || [];
  if (!list.length) list = obj ? collectAudio(obj, []) : [];   // списка в привычных местах нет: ищем элементы треков по форме
  const scalar = (o, ...names) => { for (const n of names) if (o && o[n] !== undefined && o[n] !== null && typeof o[n] !== 'object') return String(o[n]); return ''; };
  const cur = { sectionId: scalar(obj, 'sectionId', 'section_id'), nextFrom: scalar(obj, 'nextFrom', 'next_from') };
  // продолжение: либо пара sectionId + nextFrom, либо (как отвечает поиск сейчас) блок с hasMore, nextOffset и blockId
  let cursor = SAFE_CURSOR.test(cur.sectionId) && SAFE_CURSOR.test(cur.nextFrom) ? { sectionId: cur.sectionId, nextFrom: cur.nextFrom } : null;
  if (VK_BLOCK_PAGING && !cursor && SAFE_CURSOR.test(cur.sectionId)) {
    const b = blocks.find((x) => x.hasMore && SAFE_CURSOR.test(String(x.nextOffset || '')) && SAFE_CURSOR.test(String(x.blockId || '')));
    if (b) cursor = { sectionId: cur.sectionId, startFrom: String(b.nextOffset), blockId: String(b.blockId) };
  }
  const summary = blocks.slice(0, 8).map((b) => `${Array.isArray(b.list) ? b.list.length : '-'}${b.hasMore ? '+' : ''}`).join(',');
  return { html, list: Array.isArray(list) ? list : [], cursor, keys: obj ? Object.keys(obj) : [], curRaw: cur, tiles: tilesFromJson(obj), blocks: summary };
}

// исполнители из треков выдачи: у VK в поиске отдельного блока исполнителей я не подтверждал, поэтому берём тех, кто назван в найденных треках
function artistsFromTracks(tracks, limit = 10) {
  const m = new Map();
  for (const t of tracks) {
    for (const a of t.artists || []) {
      const e = m.get(a.id) || { name: a.name, count: 0, art: '' };
      e.count++;
      if (!e.art && t.art) e.art = t.art;
      m.set(a.id, e);
    }
  }
  return [...m].sort((x, y) => y[1].count - x[1].count).slice(0, limit)
    .map(([id, e]) => ({ name: e.name, art: e.art, url: `https://vk.com/artist/${id}`, followers: 0, trackCount: e.count }));
}

let searchLogged = false;
async function finishSearch(host, uid, r, what) {
  const s = parseSearch(r.payload);
  const items = await hydrateItems(host, s.list.slice(0, 100));
  const seen = new Set();
  const tracks = items.map(toTrack).filter((x) => x && !seen.has(x.vkId) && seen.add(x.vkId)).slice(0, 50);
  const tiles = s.tiles.length ? s.tiles : parseTiles(s.html);   // сначала готовые данные из JSON, разбор HTML только как запасной
  if (!searchLogged || (!tracks.length && !tiles.length)) { // первый ответ и каждый пустой пишем в терминал: по ним уточняются разборы
    searchLogged = true;
    log(what, 'via', r.via, '| keys:', s.keys.join(',') || '-', '| cursor:', s.cursor ? (s.cursor.blockId ? 'block' : 'pair') : `no (lengths ${s.curRaw.sectionId.length}/${s.curRaw.nextFrom.length})`, '| blocks:', s.blocks || '-', '| list:', s.list.length, '| tracks:', tracks.length, '| tiles:', tiles.length, '| html:', s.html.length, '|', scrub(s.html.slice(0, 200), uid));
  }
  return { tracks, users: artistsFromTracks(tracks), playlists: tiles.filter((x) => !x.isAlbum), albums: tiles.filter((x) => x.isAlbum), cursor: s.cursor, warnings: [] };
}

async function searchVk(q) {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const query = String(q || '').trim().slice(0, 100);
  if (query.length < 2) throw new Error('Query is too short');
  const r = await alAudio(host, { al: '1', act: 'section', claim: '0', is_layer: '0', owner_id: String(uid), section: 'search', q: query }, 'search');
  return finishSearch(host, uid, r, 'search');
}

// Продолжение выдачи. Подтверждено пробой: запрос load_catalog_section с start_from = nextOffset блока и block_id отвечает по-особому
// (остальные варианты возвращают первую страницу). Где в ответе лежит список, неизвестно, поэтому parseSearch берёт самый большой.
async function searchMoreVk(cursor) {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const ok = (x) => SAFE_CURSOR.test(String(x || ''));
  if (!cursor || !ok(cursor.sectionId) || !(ok(cursor.nextFrom) || (ok(cursor.startFrom) && ok(cursor.blockId)))) throw new Error('Bad cursor');
  const form = cursor.blockId
    ? { al: '1', act: 'load_catalog_section', section_id: String(cursor.sectionId), start_from: String(cursor.startFrom), block_id: String(cursor.blockId) }
    : { al: '1', act: 'load_catalog_section', section_id: String(cursor.sectionId), start_from: String(cursor.nextFrom) };
  const r = await alAudio(host, form, 'search-more');
  const s = parseSearch(r.payload);
  log('search-more via', r.via, '| blocks:', s.blocks || '-', '| list:', s.list.length, '| cursor:', s.cursor ? 'yes' : 'no', '| keys:', s.keys.join(',') || '-');   // форма ответа нужна для уточнения
  return finishSearch(host, uid, r, 'search-more');
}

// Ответ al_artist.php приходит в обёртке parent.ajax.frame.useMeta({"payload":[0,["", "<html>"]], …}): достаём JSON и из него строки HTML
function frameParts(text) {
  const s = String(text || '');
  const i = s.indexOf('useMeta(');
  const j = i < 0 ? -1 : s.indexOf('{', i);
  if (j < 0) return [s];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let k = j; k < s.length && end < 0; k++) {   // JSON-объект до парной скобки; скобки внутри строк не считаем
    const ch = s[k];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) end = k;
  }
  if (end < 0) return [s];
  try {
    const out = [];
    const walk = (x, d) => { if (typeof x === 'string') out.push(x); else if (x && typeof x === 'object' && d < 5) Object.values(x).forEach((v) => walk(v, d + 1)); };
    walk(JSON.parse(s.slice(j, end + 1)).payload, 0);
    return out.length ? out : [s];
  } catch (e) { return [s]; }
}

// Треки и плейлисты страницы. Строки страницы без data-audio, зато в атрибутах data-exec лежат JSON (с &quot;) в той же форме, что и везде,
// поэтому сканируем все атрибуты data-* со значением-JSON и ищем в них элементы треков и объекты плейлистов по форме.
function artistDocs(text) {
  const items = [];
  const objs = [];
  let blobs = 0;
  const parts = frameParts(text);
  for (const part of parts) {
    items.push(...dataAudioItems(part));
    for (const m of part.matchAll(/\sdata-[\w-]+="([\[{][^"]*)"/g)) {
      let v;
      try { v = JSON.parse(decode(m[1])); } catch (e) { continue; }
      blobs++;
      collectAudio(v, items);
      collectPlaylists(v, objs);
    }
  }
  return { items, objs, blobs, parts: parts.length };
}

// Страница исполнителя. Адрес al_artist.php взят из описания 2020 года и мог измениться: если он не дал ни треков, ни альбомов, ищем по имени,
// а если и это ничего не дало, интерфейс остаётся на странице, собранной из вашей библиотеки.
async function artistPart(host, uid, key, part) {
  const rnd = Math.floor(Math.random() * 1e9);
  const url = `https://${host}/al_artist.php?__query=${encodeURIComponent(`artist/${key}/${part}`)}&_ref=${encodeURIComponent(`artist/${key}`)}&_rndVer=${rnd}&al=-1&al_id=${encodeURIComponent(String(uid))}`;
  const res = await ses().fetch(url, { credentials: 'include', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': chromeUA(), 'X-Requested-With': 'XMLHttpRequest', Referer: `https://${host}/artist/${key}` } });
  const text = await readText(res);
  if (/login|authcheck/i.test(res.url)) throw new AuthError('Session expired');
  return { text, status: res.status };
}

// VK отвечает на al_artist.php с номером исполнителя перенаправлением на адрес со slug (/artist/zxcursed/top_audios, код 4): повторяем запрос по slug
const slugOf = (text) => { const m = /artist[\\\/]+([A-Za-z0-9_.-]{1,64})[\\\/]+(?:top_audios|albums)/.exec(String(text || '')); return m ? m[1] : ''; };
const isRedirect = (text) => /"payload":\s*\[\s*"?4"?\s*,/.test(String(text || ''));

// Запасной путь, который подтверждён пробой: поиск по имени, а в найденных треках исполнитель определяется по НОМЕРУ (имена бывают одинаковыми).
// Если выдача большая, берём ещё две порции.
async function artistFromSearch(name, id) {
  const want = name.toLowerCase();
  const seen = new Set();
  const tracks = [];
  const tiles = [];
  const take = (s) => {
    for (const x of s.tracks) {
      const mine = id ? (x.artists || []).some((a) => a.id === id) : String(x.artist).toLowerCase() === want || (x.artists || []).some((a) => a.name.toLowerCase() === want);
      if (mine && !seen.has(x.vkId)) { seen.add(x.vkId); tracks.push(x); }
    }
    tiles.push(...[...s.albums, ...s.playlists].filter((x) => String(x.artist).toLowerCase() === want));
  };
  let s = await searchVk(name);
  take(s);
  for (let i = 0; i < 2 && s.cursor && tracks.length < 40; i++) { s = await searchMoreVk(s.cursor); take(s); }
  return { tracks, tiles };
}

async function artistPage(ref) {
  const { uid, host } = readConf();
  if (!uid) throw new AuthError('Not signed in');
  const name = String((ref && ref.name) || '').trim().slice(0, 120);
  const key = String((ref && (ref.id || ref.slug)) || '');
  const url = (k) => (k ? `https://vk.com/artist/${k}` : `https://vk.com/search?c%5Bsection%5D=audio&q=${encodeURIComponent(name)}`);
  const page = (tracks, tiles, k) => {
    const cover = (tracks.find((x) => x.art) || {}).art || '';
    return { artist: { name: name || (tracks[0] && tracks[0].artist) || '', art: cover, artBig: cover, url: url(k), followers: 0, trackCount: tracks.length, city: '', country: '', desc: '' },
      popular: tracks.slice(0, 10), tracks, albums: tiles.filter((x) => x.isAlbum), playlists: tiles.filter((x) => !x.isAlbum) };
  };
  let slug = key;
  const tracks = [];
  const seenT = new Set();
  const tiles = [];
  const seenP = new Set();
  const addTracks = (items) => items.map(toTrack).forEach((x) => { if (x && !seenT.has(x.vkId)) { seenT.add(x.vkId); tracks.push(x); } });
  const addTiles = (list) => list.forEach((x) => { const k = x && x.vkOwner + '_' + x.vkPlaylistId; if (x && !seenP.has(k)) { seenP.add(k); tiles.push(x); } });
  if (key && ARTIST_KEY.test(key)) {
    try {
      let top = await artistPart(host, uid, slug, 'top_audios');
      const to = isRedirect(top.text) ? slugOf(top.text) : '';
      if (to && to !== slug) { slug = to; top = await artistPart(host, uid, slug, 'top_audios'); }
      const albums = await artistPart(host, uid, slug, 'albums').catch(() => ({ text: '', status: 0 }));
      const docs = [artistDocs(top.text), artistDocs(albums.text)];
      docs.forEach((d) => { addTracks(d.items); addTiles(d.objs.map(tileOf).filter(Boolean)); });
      if (!tiles.length) addTiles(parseTiles(frameParts(albums.text).join(' ')).map((x) => ({ ...x, isAlbum: true })));
      log('artist', key.slice(0, 8) + '…', slug !== key ? '→ ' + slug : '', '| top:', top.status, isRedirect(top.text) ? '(redirect again)' : '', '| blobs:', docs[0].blobs + '/' + docs[1].blobs, '| tracks:', tracks.length, '| albums:', albums.status, 'tiles:', tiles.length);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      log('artist request failed:', String((e && e.message) || e));
    }
  }
  // страница дала мало треков (бывает один «первый» трек): дополняем поиском по номеру исполнителя, он подтверждён пробой
  if (tracks.length < 10 && name.length >= 2) {
    try {
      const r = await artistFromSearch(name, /^\d{5,24}$/.test(key) ? key : '');
      r.tracks.forEach((x) => { if (!seenT.has(x.vkId)) { seenT.add(x.vkId); tracks.push(x); } });   // уже готовые треки: toTrack не нужен
      addTiles(r.tiles);
    } catch (e) {
      if (e instanceof AuthError) throw e;
      log('artist search fallback failed:', String((e && e.message) || e));
    }
  }
  if (tracks.length || tiles.length) return page(tracks, tiles, slug);
  throw new Error('No data for this artist');
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
    let timer = null;
    const done = (r) => { if (!finished) { finished = true; clearTimeout(timer); resolve(r); } };
    timer = setTimeout(() => done({ ok: false, error: 'No answer from the VK page' }), 25000);
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
// скрытое окно vk.com/audio: создаётся при первой надобности и закрывается через 3 минуты без дела; null, если сессия истекла
async function vkBridgeWindow(host) {
  if (!vkBridgeWin || vkBridgeWin.isDestroyed()) {
    const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.setUserAgent(chromeUA());
    win.on('closed', () => { if (vkBridgeWin === win) vkBridgeWin = null; });
    vkBridgeWin = win;
    await win.loadURL(`https://${host}/audio`);
  }
  const win = vkBridgeWin;
  if (/login|authcheck/i.test(win.webContents.getURL())) { win.destroy(); return null; }
  clearTimeout(vkBridgeTimer);
  vkBridgeTimer = setTimeout(() => { if (vkBridgeWin && !vkBridgeWin.isDestroyed()) vkBridgeWin.destroy(); }, 3 * 60 * 1000);
  if (vkBridgeTimer.unref) vkBridgeTimer.unref();   // таймер не должен удерживать процесс
  return win;
}
async function pageCall(host, fn, want) {
  const win = await vkBridgeWindow(host);
  if (!win) return { ok: false, auth: true, error: 'Session expired' };
  return win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(want)})`);
}
const pageLike = (host, want) => pageCall(host, inVkPage, want);

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

/* ---------- Проба (этап 0 из ТЗ) ---------- */
// Запуск:  MP_PROBE=1 npm start  (в Windows PowerShell:  $env:MP_PROBE=1; npm start).
// Через несколько секунд после запуска приложение снимает образцы ответов VK с вашего аккаунта и пишет их в vk-probe.json
// в папке данных приложения (путь будет в терминале). В файле нет cookie и подписанных адресов, номер пользователя заменён на UID.
async function runProbe() {
  const { uid, host } = readConf();
  const file = path.join(app.getPath('userData'), 'vk-probe.json');
  if (!uid) { log('probe: not signed in to VK'); return; }
  const out = { when: new Date().toISOString(), host, steps: {} };
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(out, null, 1)); } catch (e) { /* ничего */ } };
  const S = (x, n = 300) => scrub(typeof x === 'string' ? x : JSON.stringify(x), uid).slice(0, n);
  const shape = (a) => a.map((x, i) => i + ':' + (Array.isArray(x) ? 'array' + x.length : typeof x === 'string' ? 's' + x.length : typeof x)).join(' ');
  const step = async (name, fn) => { try { out.steps[name] = await fn(); } catch (e) { out.steps[name] = 'FAILED: ' + String((e && e.message) || e); } save(); };

  let artistId = '';
  await step('1_track', async () => {
    const d = await loadSection(host, uid, 0);
    const items = d.list.filter(Array.isArray);
    const withArtists = items.find((x) => Array.isArray(x[17]) && x[17].length);
    if (withArtists) artistId = idStr(withArtists[17][0] && withArtists[17][0].id);
    return { count: items.length, firstShape: shape(items[0] || []), withNonEmptyA17: items.filter((x) => Array.isArray(x[17]) && x[17].length).length,
      a17: withArtists ? S(withArtists[17]) : 'none in library', a18: withArtists ? S(withArtists[18]) : '', a19: withArtists ? S(withArtists[19]) : '',
      libraryHashShape: String((items[0] && items[0][13]) || '').split('/').map((h, i) => (h ? i + ':' + h.length : '')).filter(Boolean).join(' '), a26Samples: S(items.map((x) => x[26]).filter(Boolean).slice(0, 5), 200),
      a15: S(items[0] && items[0][15]), firstToTrackKeys: Object.keys(toTrack(items[0]) || {}).join(',') };
  });

  await step('2_search', async () => {
    const q = 'imagine dragons';
    const form = { al: '1', act: 'section', claim: '0', is_layer: '0', owner_id: String(uid), section: 'search', q };
    const probe = (p) => {
      const s = parseSearch(p);
      const classes = [...new Set((s.html.match(/class="([^"]+)"/g) || []).flatMap((c) => c.slice(7, -1).split(/\s+/)).filter((c) => /pl_|playlist|album|artist|Catalog.*(Playlist|Artist|Album)/i.test(c)))].slice(0, 80);
      const o = p[1] && typeof p[1] === 'object' && !Array.isArray(p[1]) ? p[1] : {};
      const blk = (s.html.match(/<div[^>]+class="[^"]*audio_pl_item2[\s\S]{0,700}/) || [''])[0];
      const hs = (x) => String(x || '').split('/').map((h, i) => (h ? i + ':' + h.length : '')).filter(Boolean).join(' ');
      const first = s.list[0] || [];
      return { payloadLength: p.length, objKeys: s.keys.join(','), listLength: s.list.length, firstItemShape: shape(first), hasCursor: !!s.cursor,
        cursor: { sectionIdLen: s.curRaw.sectionId.length, sectionIdHead: S(s.curRaw.sectionId, 12), nextFromLen: s.curRaw.nextFrom.length, nextFromHead: S(s.curRaw.nextFrom, 12), valid: !!s.cursor },
        playlistsKeys: Array.isArray(o.playlists) ? o.playlists.slice(0, 6).map((x) => Object.keys(x || {}).join(',') + ' list=' + ((x && x.list) || []).length) : 'not an array',
        firstItemHashShape: hs(first[13]), firstItemToTrackLock: (toTrack(first) || {}).lock, a11: S(first[11], 60), a24: S(first[24], 60), a26: S(first[26], 60),
        htmlLength: s.html.length, htmlHead: S(s.html, 500), htmlClasses: classes.join(' '), tiles: parseTiles(s.html).length,
        tilesParsed: parseTiles(s.html).slice(0, 6).map((x) => ({ name: S(x.name, 40), artist: S(x.artist, 30), isAlbum: x.isAlbum, count: x.count, hasHash: !!x.accessHash, hasArt: !!x.art })), tileSample: S(blk, 700),
        jsonTiles: tilesFromJson(o).length,
        jsonTilesSample: tilesFromJson(o).slice(0, 4).map((x) => ({ name: S(x.name, 40), artist: S(x.artist, 30), count: x.count, isAlbum: x.isAlbum, hasHash: !!x.accessHash, hasArt: !!x.art, plays: S(x.plays, 12) })),
        blocks: Array.isArray(o.playlists) ? o.playlists.slice(0, 14).map((x) => ({ type: S(x && x.type, 24), listLen: ((x && x.list) || []).length, hasMore: x && x.hasMore, nextOffset: x && x.nextOffset, totalCount: x && x.totalCount, blockId: S(x && x.blockId, 14) })) : [],
        pagination: { next_from: S(o.next_from, 20), nextFrom: S(o.nextFrom, 20), blockIds: S(o.blockIds, 200), isBlockPagination: o.isBlockPagination, searchParams: o.searchParams && typeof o.searchParams === 'object' ? Object.keys(o.searchParams).join(',') : S(o.searchParams, 80) } };
    };
    const res = {};
    try {
      const r = await ses().fetch(`https://${host}/al_audio.php`, { method: 'POST', credentials: 'include', signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': chromeUA(), 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded', Origin: `https://${host}`, Referer: `https://${host}/audio` }, body: new URLSearchParams(form).toString() });
      const text = await readText(r);
      let json = null;
      try { json = JSON.parse(text.replace(/^<!--/, '')); } catch (e) { /* не JSON */ }
      res.direct = { status: r.status, finalUrl: S(r.url, 120), head: S(text, 200), code: payloadCode(json), ...(json && Array.isArray(json.payload) && Array.isArray(json.payload[1]) ? probe(json.payload[1]) : {}) };
    } catch (e) { res.direct = 'FAILED: ' + e.message; }
    try {
      const r = await pageCall(host, inVkAjax, { form });
      res.page = r && r.ok ? probe(r.args) : r;
    } catch (e) { res.page = 'FAILED: ' + e.message; }
    return res;
  });

  await step('3_playlist', async () => {
    const pg = await request(host, `/audio?act=audio_playlists${uid}`);
    const lists = parsePlaylists(pg.text);
    if (!lists.length) {   // это настоящее отсутствие плейлистов или изменилась разметка страницы: по классам видно
      const cls = [...new Set((pg.text.match(/class="([^"]+)"/g) || []).flatMap((x) => x.slice(7, -1).split(/\s+/)).filter((x) => /laylist|audioPlaylists|_pl/i.test(x)))].slice(0, 40);
      return { note: 'no playlists parsed', length: pg.text.length, classes: cls.join(' '), head: S(pg.text, 400) };
    }
    const p = lists[0];
    const blk0 = (unwrapHtml(pg.text).match(/<div[^>]+class="[^"]*audioPlaylistsPage__item[\s\S]{0,900}/) || [''])[0];
    const res = { firstBlockSample: S(blk0, 900), parsedCount: p.count, parsedPlays: p.plays, parsedFields: Object.keys(p).join(','), hasAccessHash: !!p.accessHash, author: S(p.author, 60), plays: S(p.plays, 60) };
    for (const withHash of [false, true]) {
      try {
        const d = await loadSection(host, p.vkOwner, 0, p.vkPlaylistId, withHash ? p.accessHash : '');
        res[withHash ? 'withHash' : 'withoutHash'] = { keys: Object.keys(d).join(','), tracks: d.list.length, scalars: Object.entries(d).filter(([, v]) => v !== null && typeof v !== 'object').map(([k, v]) => k + '=' + (/hash/i.test(k) ? String(v).slice(0, 6) + '…' : S(String(v), 60))).join('; ') };
      } catch (e) { res[withHash ? 'withHash' : 'withoutHash'] = 'FAILED: ' + e.message; }
    }
    return res;
  });

  await step('5_artist', async () => {
    if (!artistId) return 'skipped: no track with a non-empty a[17] in the library';
    const res = { id: artistId.slice(0, 6) + '…(' + artistId.length + ' digits, kept as string)' };
    for (const part of ['top_audios', 'albums']) {
      try {
        const r = await artistPart(host, uid, artistId, part);
        res[part] = { status: r.status, length: r.text.length, redirect: isRedirect(r.text), slug: slugOf(r.text), dataAudio: dataAudioItems(r.text).length, tiles: parseTiles(r.text).length, head: S(r.text, 300) };
        const slug = slugOf(r.text);
        if (slug && slug !== artistId) {   // за перенаправлением: что отдаёт запрос по slug
          const r2 = await artistPart(host, uid, slug, part);
          res[part + '_bySlug'] = { slug, status: r2.status, length: r2.text.length, redirectAgain: isRedirect(r2.text), dataAudio: dataAudioItems(r2.text).length, audioRows: (r2.text.match(/audio_row/g) || []).length,
            plItems: (r2.text.match(/audio_pl_item2/g) || []).length, head: S(r2.text, 700) };
        }
      } catch (e) { res[part] = 'FAILED: ' + e.message; }
    }
    return res;
  });
  // постраничность поиска: nextFrom пуст, поэтому проверяем варианты, какой из них отдаёт следующую порцию (differs = первый трек другой)
  await step('6_more', async () => {
    const q = 'imagine dragons';
    const form = { al: '1', act: 'section', claim: '0', is_layer: '0', owner_id: String(uid), section: 'search', q };
    const base = await alAudio(host, form, 'probe-more');
    const s = parseSearch(base.payload);
    const o = base.payload[1] && typeof base.payload[1] === 'object' ? base.payload[1] : {};
    const blk0 = Array.isArray(o.playlists) && o.playlists[0] ? o.playlists[0] : {};
    const firstTitle = (s.list[0] || [])[3];
    const token = ((s.html.match(/href="\/audio\?section=recoms_block&(?:amp;)?type=([A-Za-z0-9_\-]+)"[^>]*audio_page_block__show_all_link/) || [])[1]) || '';
    const brief = (p, via) => { const x = parseSearch(p); const o2 = p[1] && typeof p[1] === 'object' ? p[1] : {}; return { via, list: x.list.length, blocks: x.blocks, allAudioArraysAnywhere: collectAudio(o2, []).length, firstTitle: S((x.list[0] || [])[3], 40), differs: (x.list[0] || [])[3] !== firstTitle, keys: x.keys.join(','), cursor: !!x.cursor, htmlLength: x.html.length }; };
    const tries = {
      a_catalog_section_empty_next: { al: '1', act: 'load_catalog_section', section_id: s.curRaw.sectionId, start_from: s.curRaw.nextFrom },
      b_catalog_section_nextOffset: { al: '1', act: 'load_catalog_section', section_id: s.curRaw.sectionId, start_from: String(blk0.nextOffset || ''), block_id: String(blk0.blockId || '') },
      b2_catalog_with_query: { al: '1', act: 'load_catalog_section', section: 'search', q, section_id: s.curRaw.sectionId, start_from: String(blk0.nextOffset || ''), block_id: String(blk0.blockId || '') },
      c_search_start_from: { ...form, start_from: String(blk0.nextOffset || 20) },
      d_search_offset: { ...form, offset: String(blk0.nextOffset || 20) },
      e_show_all_link: token ? { al: '1', act: 'section', section: 'recoms_block', type: token, owner_id: String(uid), claim: '0', is_layer: '0' } : null,
    };
    const out = {};
    for (const [k, f] of Object.entries(tries)) {
      if (!f) { out[k] = 'skipped: no show-all link in the HTML'; continue; }
      try { const r = await alAudio(host, f, 'probe-more-' + k); out[k] = brief(r.payload, r.via); } catch (e) { out[k] = 'FAILED: ' + String((e && e.message) || e); }
    }
    return { baseFirstTitle: S(firstTitle, 40), blk0: { hasMore: blk0.hasMore, nextOffset: blk0.nextOffset, totalCount: blk0.totalCount, blockId: S(blk0.blockId, 14) }, showAllToken: token ? token.length + ' chars' : 'none', tries: out };
  });
  // раздел «Плейлисты» в формате поиска и рекомендации для главной (по ним уточняются число треков и главная страница VK)
  await step('7_playlists_section', async () => {
    const r = await alAudio(host, { al: '1', act: 'section', claim: '0', is_layer: '0', owner_id: String(uid), section: 'playlists' }, 'probe-playlists');
    const o = r.payload[1] && typeof r.payload[1] === 'object' ? r.payload[1] : {};
    const tiles = collectPlaylists(r.payload, []).map(tileOf).filter(Boolean);
    return { via: r.via, keys: Object.keys(o).join(','), tiles: tiles.length, sample: tiles.slice(0, 3).map((x) => ({ name: S(x.name, 30), count: x.count, hasHash: !!x.accessHash })), htmlLength: typeof r.payload[0] === 'string' ? r.payload[0].length : -1 };
  });
  await step('8_recoms', async () => {
    const r = await alAudio(host, { al: '1', act: 'section', claim: '0', is_layer: '0', owner_id: String(uid), section: 'recoms' }, 'probe-recoms');
    const o = r.payload[1] && typeof r.payload[1] === 'object' ? r.payload[1] : {};
    const p = parseSearch(r.payload);
    return { via: r.via, keys: Object.keys(o).join(','), blocks: p.blocks, tracks: collectAudio(r.payload, []).length, htmlLength: p.html.length, head: S(p.html, 300) };
  });
  log('probe done →', file);
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
  // обёртка IPC: любой отказ превращается в { ok: false }, сессия — в auth
  const wrap = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) {
      log(name.replace('vk:', '') + ' failed:', String((e && e.message) || e));
      return { ok: false, auth: e instanceof AuthError, error: String((e && e.message) || e) };
    }
  });
  wrap('vk:search', (q) => searchVk(q));
  wrap('vk:playlist-counts', (refs) => playlistCounts(refs));
  wrap('vk:search-more', (cursor) => searchMoreVk(cursor));
  wrap('vk:artist', (ref) => artistPage({ id: ref && ref.id, slug: ref && ref.slug, name: ref && ref.name }));
  if (process.env.MP_PROBE) setTimeout(() => runProbe().catch((e) => log('probe failed:', String((e && e.message) || e))), 8000);
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

module.exports = { register, _test: { pickStream, unmask, toTrack, parsePlaylists, decode, art, loadSection, collectTracks, AuthError, NoLinkError, stream, streamCache, like, inVkPage, playlistPage, parsePlaylists, parseTiles, dataAudioItems, parseSearch, artistsFromTracks, scrub, searchVk, searchMoreVk, artistPage, playlistMeta, hydrateItems, alAudio, runProbe, inVkAjax, readText, slugOf, isRedirect, artistFromSearch, tilesFromJson, finishSearch, unwrapHtml, frameParts, artistDocs, collectAudio, collectPlaylists, tileOf, fetchLibrary, playlistCounts, countOf } };
