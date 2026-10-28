(() => {
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const I = window.ICONS;

  /* ---------- Язык интерфейса ---------- */
  // Английский встроен: английские фразы в коде служат ключами. Другие языки — файлы .json в папке locales:
  // { "name": "Русский", "code": "ru", "strings": { "English phrase": "перевод" } }. Фраза без перевода остаётся английской.
  const lang = { code: 'en', strings: {}, list: [] };
  const L = (s, ...args) => {
    const v = Object.prototype.hasOwnProperty.call(lang.strings, s) ? lang.strings[s] : s;
    return args.length ? v.replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? args[i] : m)) : v;
  };
  const ruOf = new WeakMap();   // исходные русские тексты объектов: перевод всегда делается от них
  function tr(obj, key) {
    let o = ruOf.get(obj);
    if (!o) { o = {}; ruOf.set(obj, o); }
    if (!(key in o)) o[key] = obj[key];
    obj[key] = L(o[key]);
  }
  // подписи из index.html (title, placeholder, aria-label): запоминаем русский оригинал
  const staticTexts = [];
  function collectStatic() {
    document.querySelectorAll('[title],[placeholder],[aria-label]').forEach((el) => {
      ['title', 'placeholder', 'aria-label'].forEach((a) => { if (el.hasAttribute(a)) staticTexts.push([el, a, el.getAttribute(a)]); });
    });
  }
  function localize() {
    PLATFORMS.forEach((p) => tr(p, 'name'));
    Object.keys(TAB_NAMES).forEach((k) => tr(TAB_NAMES, k));
    Object.values(THEMES).forEach((x) => tr(x, 'name'));
    TINTS.forEach((p) => tr(p, 'name'));
    Object.values(TEXT_FIXED).forEach((x) => tr(x, 'name'));
    Object.values(PATTERNS).forEach((x) => tr(x, 'name'));
    Object.values(WP_FITS).forEach((x) => tr(x, 'name'));
    Object.values(WP_POS).forEach((x) => tr(x, 1));
    OPACITY.forEach((x) => tr(x, 1));
    Object.values(SOURCE_MODES).forEach((x) => { tr(x, 'name'); tr(x, 'hint'); });
    NAV.forEach((g) => { if (g.title) tr(g, 'title'); g.items.forEach((s) => { tr(s, 'name'); (s.subs || []).forEach((x) => tr(x, 'name')); }); });
    DEFS.forEach((d) => { tr(d, 'title'); tr(d, 'desc'); });
    staticTexts.forEach(([el, a, ru]) => el.setAttribute(a, L(ru)));
  }
  function setLanguage(code) {
    const l = lang.list.find((x) => x.code === code);
    lang.code = l ? l.code : 'en';
    lang.strings = l ? l.strings : {};
    document.documentElement.lang = lang.code;
    localize();
  }
  async function loadLocales() {
    let list = [];
    try { if (window.api && window.api.listLocales) list = await window.api.listLocales(); } catch (e) { list = []; }
    const seen = new Set(['en']);
    lang.list = (Array.isArray(list) ? list : []).filter((l) => l && l.code && l.strings && !seen.has(l.code) && seen.add(l.code));
    setLanguage(settings.lang);
  }
  // масштаб всего интерфейса: настоящий зум окна, раскладка и обои пересчитываются сами
  function applyScale() {
    const f = settings.uiScale / 100;
    try { if (window.api && window.api.setZoom) { window.api.setZoom(f); document.documentElement.style.zoom = ''; return; } } catch (e) { /* ничего */ }
    document.documentElement.style.zoom = f === 1 ? '' : String(f);
  }

  /* ---------- Платформы ---------- */
  // pastel — цвет отметки на тёмных темах, deep — на светлых и «Пепельной»
  const PLATFORMS = [
    { id: 'all',        name: 'All tracks',     accent: '#9b8cff', bg: 'linear-gradient(135deg,#7a5cff,#c45cff)', fg: '#ffffff', icon: 'all',
      tabs: ['home', 'liked', 'playlists'] },
    { id: 'soundcloud', name: 'SoundCloud',    accent: '#ff5500', bg: '#ff5500', fg: '#ffffff', icon: 'soundcloud', pastel: '#ffb38a', deep: '#d4601c',
      tabs: ['home', 'liked', 'playlists', 'following'] },
    { id: 'vk',         name: 'VK Music',     accent: '#2787f5', bg: '#0077ff', fg: '#ffffff', icon: 'vk', pastel: '#9cc7ff', deep: '#2f7be0',
      tabs: ['home', 'liked', 'playlists', 'following'] },
    { id: 'ytmusic',    name: 'YouTube Music', accent: '#ff3d3d', bg: '#e00000', fg: '#ffffff', icon: 'ytmusic', pastel: '#ff9c9c', deep: '#d93a3a',
      tabs: ['home', 'liked', 'playlists', 'following'] },
    { id: 'yandex',     name: 'Yandex Music', accent: '#ffcc00', bg: '#ffcc00', fg: '#14141a', icon: 'yandex', pastel: '#ffe58a', deep: '#b8900a',
      tabs: ['home', 'liked', 'playlists', 'following'] },
  ];
  const TAB_NAMES = { home: 'Home', liked: 'Liked', playlists: 'Playlists', following: 'Following' };
  const platform = (id) => PLATFORMS.find((p) => p.id === id);

  /* ---------- Цвет ---------- */
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = rgb(a), B = rgb(b); return toHex(A.map((v, i) => v * (1 - t) + B[i] * t)); };
  const lum = (h) => {
    const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const hsl = (h, s, l) => {
    s /= 100; l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return toHex([f(0) * 255, f(8) * 255, f(4) * 255]);
  };

  /* ---------- Темы (от светлой к тёмной) ---------- */
  // k — насколько сильно цвет оформления подмешивается в каждую поверхность
  const GRAY = '#a7a7a7';
  const fromGray = (t) => mix('#000000', GRAY, t);

  const THEMES = {
    light: { name: 'Light',
      rail: '#eceef2', main: '#fafafc', panel: '#f0f1f5', hover: '#e4e6ec', line: '#dcdee5', text: '#1a1a21', muted: '#6a6a77',
      k: { rail: .28, main: .10, panel: .22, hover: .30, line: .34 } },
    gray: { name: 'Gray',
      rail: '#c9cacf', main: '#e3e4e8', panel: '#d5d6db', hover: '#c8c9cf', line: '#b9bac1', text: '#1c1c22', muted: '#5a5a66',
      k: { rail: .24, main: .20, panel: .24, hover: .30, line: .32 } },
    ash: { name: 'Ash',            // фон ровно #a7a7a7
      rail: '#8c8c8c', main: '#a7a7a7', panel: '#9d9d9d', hover: '#929292', line: '#7f7f7f', text: '#141414', muted: '#323232',
      k: { rail: .20, main: .20, panel: .20, hover: .22, line: .24 } },
    graphite: { name: 'Graphite', dark: true, lift: .3,   // фон #5a5a5a
      rail: '#484848', main: '#5a5a5a', panel: '#666666', hover: '#727272', line: '#808080', text: '#f5f5f5', muted: '#dcdcdc',
      k: { rail: .16, main: .16, panel: .18, hover: .20, line: .22 } },
    dark: { name: 'Dark', dark: true, lift: 0,
      rail: fromGray(.13), main: fromGray(.18), panel: fromGray(.23), hover: fromGray(.29), line: fromGray(.37), text: '#f2f2f2', muted: GRAY,
      k: { rail: .08, main: .09, panel: .13, hover: .18, line: .20 } },
    black: { name: 'Jet black', dark: true, lift: 0,   // настоящий чёрный: фон #000000
      rail: '#000000', main: '#000000', panel: '#0b0b0b', hover: '#171717', line: '#2b2b2b', text: '#f0f0f0', muted: '#9a9a9a',
      k: { rail: .05, main: .05, panel: .08, hover: .12, line: .14 } },
  };
  const THEME_ORDER = ['light', 'gray', 'ash', 'graphite', 'dark', 'black'];
  const SURFACES = ['rail', 'main', 'panel', 'hover', 'line'];

  /* ---------- Цвета: 20 насыщенных оттенков с шагом 18° по кругу ---------- */
  const TINT_NAMES = ['Coral', 'Peach', 'Apricot', 'Lemon', 'Lime', 'Pistachio', 'Lettuce', 'Mint', 'Sea foam', 'Aquamarine',
                      'Turquoise', 'Sky', 'Azure', 'Cornflower', 'Periwinkle', 'Lavender', 'Orchid', 'Fuchsia', 'Bubblegum', 'Rose'];
  // у жёлто-зелёных оттенков при той же яркости цвет кажется светлее, у синих темнее, поэтому L разная
  const tintL = (h) => (h >= 36 && h <= 180 ? 50 : h > 180 && h <= 260 ? 58 : 54);   // при насыщенности 100% цвета чистые и яркие
  const TINTS = TINT_NAMES.map((name, i) => ({ id: 'c' + i, name, h: i * 18, l: tintL(i * 18) }));
  const TEXT_FIXED = { white: { name: 'White', hex: '#ffffff' }, black: { name: 'Black', hex: '#000000' } };

  /* ---------- Узоры на панелях (боковая панель, бар окна, плеер) ---------- */
  // каждый узор — маленькая SVG-плитка, цвет берётся из цвета текста темы
  const PATTERNS = {
    none:    { name: 'No pattern' },
    dots:    { name: 'Dots', size: 8,  tile: (c, a) => `<circle cx='4' cy='4' r='1' fill='${c}' fill-opacity='${a}'/>` },
    polka:   { name: 'Large dots', size: 16, tile: (c, a) => `<circle cx='8' cy='8' r='2.2' fill='${c}' fill-opacity='${a}'/>` },
    grid:    { name: 'Grid', size: 12, tile: (c, a) => `<path d='M0 .5H12M.5 0V12' fill='none' stroke='${c}' stroke-opacity='${a}'/>` },
    crosses: { name: 'Crosses', size: 16, tile: (c, a) => `<path d='M8 5v6M5 8h6' fill='none' stroke='${c}' stroke-opacity='${a}'/>` },
  };
  const patternCss = (key, color, alpha) => {
    const P = PATTERNS[key];
    if (!P || !P.tile) return 'none';
    const svgText = `<svg xmlns='http://www.w3.org/2000/svg' width='${P.size}' height='${P.size}'>${P.tile(encodeURIComponent(color), alpha.toFixed(3))}</svg>`;
    return `url("data:image/svg+xml,${svgText}")`;
  };
  const patternAlpha = () => (0.15 + 0.85 * (settings.patternAlpha / 100)) * (settings.aLines / 100);   // цвет узора = цвет линий, прозрачность общая с линиями

  /* ---------- Обои: размещение и положение ---------- */
  const WP_FITS = {
    stretch: { name: 'Stretch to fill (distorts)', size: '100% 100%', repeat: 'no-repeat' },
    contain: { name: 'Fit inside (no distortion)',         size: 'contain',   repeat: 'no-repeat' },
    cover:   { name: 'Fill the window (crops)',          size: 'cover',     repeat: 'no-repeat' },
    center:  { name: 'Original size',                      size: 'auto',      repeat: 'no-repeat' },
    tile:    { name: 'Tiled',                                  size: 'auto',      repeat: 'repeat' },
  };
  // 3 x 3: углы, края и центр
  const WP_POS = {
    tl: ['left top', 'Top left corner'],   t: ['center top', 'Top edge'],     tr: ['right top', 'Top right corner'],
    l:  ['left center', 'Left edge'],        c: ['center center', 'Center'],     r:  ['right center', 'Right edge'],
    bl: ['left bottom', 'Bottom left corner'], b: ['center bottom', 'Bottom edge'],   br: ['right bottom', 'Bottom right corner'],
  };
  // элементы интерфейса, у которых есть свой ползунок прозрачности
  const OPACITY = [
    ['aTitle', 'Title bar'], ['aRail', 'Side panel'], ['aMain', 'Window background and top bar'],
    ['aCanvas', 'Main canvas'], ['aCards', 'Cards and rows'], ['aControls', 'Buttons, fields and headings'],
    ['aPlayer', 'Bottom player'], ['aModal', 'Settings window'], ['aLines', 'Lines and borders'],
  ];

  const SOURCE_MODES = {
    icon:  { name: 'Icon on the left',      hint: 'An icon before the cover.' },
    title: { name: 'Icon by the title', hint: 'A small icon before the title.' },
    label: { name: 'Label on the right',    hint: 'The platform name on the right.' },
  };

  /* ---------- Настройки (сохраняются между запусками) ---------- */
  const STORE_KEY = 'music-player-settings';
  // tint — цвет оформления (null = без цвета); textColor — 'auto' | 'white' | 'black' | id оттенка
  const DEFAULTS = {
    theme: 'dark', tint: null, sat: 80, textColor: 'auto', textSat: 70, sourceMode: 'icon',
    font: 'auto', fontSize: 14, pattern: 'dots', patternAlpha: 70, lang: 'en', uiScale: 100,
    aTitle: 100, aRail: 100, aMain: 100, aCanvas: 100, aCards: 100, aControls: 100, aPlayer: 100, aModal: 100, aLines: 100,
    glassBlur: 10, wpFit: 'cover', wpPos: 'c', wpBlur: 0, textOutline: 50,
    bgColor: 'auto', bgSat: 60, outlineColor: 'auto', outlineIcons: true, outlineStyle: 'soft',
    notifyTrack: false, notifyUnfocused: true, notifySilent: false,
    autoplay: true, rememberVolume: true, volume: 70, autoSync: true, syncEvery: 15,
  };
  const BOOLS = ['notifyTrack', 'notifyUnfocused', 'notifySilent', 'autoplay', 'rememberVolume', 'outlineIcons', 'autoSync'];
  // числовые настройки и их допустимые границы
  const NUMS = { aTitle: [0, 100], aRail: [0, 100], aMain: [0, 100], aCanvas: [0, 100], aCards: [0, 100],
                 aPlayer: [0, 100], aModal: [0, 100], aControls: [0, 100], aLines: [0, 100], glassBlur: [0, 24], wpBlur: [0, 40], textOutline: [0, 100], bgSat: [0, 100], uiScale: [75, 150], syncEvery: [1, 240] };
  const settings = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    const pct = (v) => Number.isFinite(v) && v >= 0 && v <= 100;
    if (THEMES[saved.theme]) settings.theme = saved.theme;
    if (TINTS.some((p) => p.id === saved.tint)) settings.tint = saved.tint;
    if (pct(saved.sat)) settings.sat = Math.round(saved.sat);
    if (saved.textColor === 'auto' || TEXT_FIXED[saved.textColor] || TINTS.some((p) => p.id === saved.textColor)) settings.textColor = saved.textColor;
    if (pct(saved.textSat)) settings.textSat = Math.round(saved.textSat);
    if (SOURCE_MODES[saved.sourceMode]) settings.sourceMode = saved.sourceMode;
    if (PATTERNS[saved.pattern]) settings.pattern = saved.pattern;
    if (pct(saved.patternAlpha)) settings.patternAlpha = Math.round(saved.patternAlpha);
    if (typeof saved.font === 'string' && saved.font.length < 80) settings.font = saved.font;
    if (Number.isFinite(saved.fontSize) && saved.fontSize >= 12 && saved.fontSize <= 18) settings.fontSize = Math.round(saved.fontSize);
    if (pct(saved.volume)) settings.volume = Math.round(saved.volume);
    if (typeof saved.lang === 'string' && saved.lang.length < 20) settings.lang = saved.lang;
    BOOLS.forEach((k) => { if (typeof saved[k] === 'boolean') settings[k] = saved[k]; });
    Object.keys(NUMS).forEach((k) => { const [lo, hi] = NUMS[k]; if (Number.isFinite(saved[k]) && saved[k] >= lo && saved[k] <= hi) settings[k] = Math.round(saved[k]); });
    ['bgColor', 'outlineColor'].forEach((k) => { if (saved[k] === 'auto' || TEXT_FIXED[saved[k]] || TINTS.some((p) => p.id === saved[k])) settings[k] = saved[k]; });
    if (saved.outlineStyle === 'soft' || saved.outlineStyle === 'sharp') settings.outlineStyle = saved.outlineStyle;
    if (WP_FITS[saved.wpFit]) settings.wpFit = saved.wpFit;
    if (WP_POS[saved.wpPos]) settings.wpPos = saved.wpPos;
  } catch (e) { /* первый запуск или хранилище недоступно */ }
  const saveSettings = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ничего */ } };

  const tintColor = (p) => hsl(p.h, settings.sat, p.l);
  const tintHex = () => { const p = TINTS.find((x) => x.id === settings.tint); return p ? tintColor(p) : null; };

  // цвет текста: на тёмных темах оттенок светлый, на светлых тёмный, чтобы его можно было читать
  const textHue = (p) => hsl(p.h, settings.textSat, THEMES[settings.theme].dark ? 62 : 38);
  function customText() {
    if (settings.textColor === 'auto') return null;
    if (TEXT_FIXED[settings.textColor]) return TEXT_FIXED[settings.textColor].hex;
    const p = TINTS.find((x) => x.id === settings.textColor);
    return p ? textHue(p) : null;
  }
  const textName = () => settings.textColor === 'auto' ? L('Auto')
    : TEXT_FIXED[settings.textColor] ? TEXT_FIXED[settings.textColor].name
    : (TINTS.find((x) => x.id === settings.textColor) || {}).name;

  // отдельный цвет фона: поверхности строятся из выбранного оттенка (яркость берётся у текущей темы)
  const lightnessOf = (hex) => { const [r, g, b] = rgb(hex).map((v) => v / 255); return ((Math.max(r, g, b) + Math.min(r, g, b)) / 2) * 100; };
  // цвет фона: то, что видно за обоями и под прозрачными панелями (поверхности панелей он не меняет);
  // насыщенность своя, не зависит от цвета оформления, яркость берётся у темы
  function bgBase() {
    const c = settings.bgColor;
    if (c === 'white') return '#ffffff';
    if (c === 'black') return '#000000';
    const p = TINTS.find((x) => x.id === c);
    return p ? hsl(p.h, settings.bgSat, Math.max(7, lightnessOf(THEMES[settings.theme].rail))) : null;
  }

  // поверхности темы с учётом выбранного цвета оформления
  function palette(themeKey) {
    const th = THEMES[themeKey];
    const tint = tintHex();
    const out = { text: th.text, muted: th.muted };
    // чем выше насыщенность, тем сильнее цвет оформления проявляется в самих поверхностях
    const strength = 0.5 + 1.7 * (settings.sat / 100);
    SURFACES.forEach((k) => { out[k] = tint ? mix(th[k], tint, Math.min(0.7, th.k[k] * strength)) : th[k]; });
    return out;
  }

  /* ---------- Данные ---------- */
  // Пока подключён только SoundCloud: его библиотека приходит из основного процесса (soundcloud.js).
  // У остальных платформ данных нет, поэтому вместо треков показывается плашка «Demo data».
  const emptyData = () => ({ connected: false, recent: [], recommended: [], liked: [], playlists: [], following: [] });
  const DATA = {};
  PLATFORMS.forEach((p) => { DATA[p.id] = emptyData(); });
  const trackIds = new Map();   // один и тот же трек всегда получает один и тот же внутренний номер
  let uid = 0;
  const idFor = (key) => { if (!trackIds.has(key)) trackIds.set(key, ++uid); return trackIds.get(key); };

  // по одному элементу из каждого списка по кругу, чтобы «Все треки» выглядели смешанными
  const interleave = (lists) => {
    const out = [];
    const max = Math.max(0, ...lists.map((l) => l.length));
    for (let i = 0; i < max; i++) lists.forEach((l) => l[i] && out.push(l[i]));
    return out;
  };

  // «Все треки» собираются из подключённых платформ
  function rebuildAll() {
    const parts = PLATFORMS.filter((p) => p.id !== 'all').map((p) => DATA[p.id]).filter((d) => d.connected);
    const mix = (key) => interleave(parts.map((d) => d[key]));
    DATA.all = { connected: parts.length > 0, recent: mix('recent'), recommended: mix('recommended'), liked: mix('liked'), playlists: mix('playlists'), following: mix('following') };
  }

  // трек и остальные объекты берут все поля, что прислал основной процесс (исполнитель, счётчики, дата…)
  const mapTrack = (t) => ({ ...t, id: idFor('soundcloud:' + t.scId), source: 'soundcloud' });
  const mapEntity = (x) => ({ ...x, source: 'soundcloud' });

  function applyLibrary(lib) {
    const track = mapTrack;
    const tag = (x) => ({ ...x, source: 'soundcloud' });
    DATA.soundcloud = {
      connected: true,
      recent: lib.recent.map(track),
      recommended: lib.recommended.map(track),
      liked: lib.liked.map(track),
      playlists: lib.playlists.map(tag),
      following: lib.following.map(tag),
    };
    rebuildAll();
  }
  rebuildAll();

  /* ---------- Состояние ---------- */
  // у каждой платформы свой выбранный раздел: при переключении платформ они не смешиваются
  const state = {
    platform: 'soundcloud',
    tabs: Object.fromEntries(PLATFORMS.map((p) => [p.id, 'home'])),
    query: '',
    view: null,            // открытая страница: { kind: 'track' | 'artist' | 'playlist', src, id, url } или null
    expanded: new Set(),   // раскрытые списки «Показать ещё» на странице
  };
  const curTab = () => state.tabs[state.platform];

  // история переходов для стрелок «назад / вперёд» в верхнем баре
  const nav = { stack: [{ platform: 'soundcloud', tab: 'home' }], pos: 0 };

  const ui = { section: 'appearance', sub: 'theme', search: '' };
  const player = { queue: [], index: -1, playing: false, elapsed: 0, timer: null, liked: new Set(),
                   shuffle: false, repeat: 'off', history: [], loading: false, error: '' }; // repeat: off | all | one
  let visibleTracks = [];

  /* ---------- Хелперы ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const cover = (seed) => {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `linear-gradient(135deg,hsl(${h} 65% 55%),hsl(${(h + 55) % 360} 65% 28%))`;
  };
  // настоящая обложка поверх градиента: пока картинка грузится (или её нет), виден градиент
  const coverBg = (seed, art) => (art ? `url(${art}) center/cover no-repeat, ${cover(seed)}` : cover(seed));
  const current = () => player.queue[player.index];
  const srcVars = (p) => `--p:${p.pastel};--d:${p.deep}`;
  const badge = (p) => `<span class="badge" style="background:${p.bg};color:${p.fg}">${I[p.icon]}</span>`;

  /* ---------- Применение темы ---------- */
  /* ---------- Слои обоев ---------- */
  // Фон каждой панели — её заливка поверх общего слоя обоев, прибитого к окну. Чтобы этот слой можно было размыть и «исказить
  // стеклом», обои рисуются в canvas под размер окна: один слой для фона окна (размытие обоев), второй для панелей (размытие + стекло).
  const wp = { bitmap: null, key: '', timer: null, seq: 0, urls: { bg: null, glass: null }, sig: '' };
  const POS_F = { tl: [0, 0], t: [.5, 0], tr: [1, 0], l: [0, .5], c: [.5, .5], r: [1, .5], bl: [0, 1], b: [.5, 1], br: [1, 1] };

  // размер и положение картинки в окне W x H: то же, что делают background-size и background-position
  function fitRect(fit, pos, iw, ih, W, H) {
    const [px, py] = POS_F[pos];
    let w = iw, h = ih;
    if (fit === 'stretch') { w = W; h = H; }
    else if (fit === 'contain') { const k = Math.min(W / iw, H / ih); w = iw * k; h = ih * k; }
    else if (fit === 'cover') { const k = Math.max(W / iw, H / ih); w = iw * k; h = ih * k; }
    return { x: (W - w) * px, y: (H - h) * py, w, h };
  }

  // m — запас по краям на размытие, чтобы края не светлели
  function drawWallpaper(ctx, img, W, H, fit, pos, m) {
    ctx.imageSmoothingQuality = 'high';
    if (fit === 'tile') {
      const r = fitRect('center', pos, img.width, img.height, W, H);
      const ox = ((r.x % img.width) + img.width) % img.width - img.width;
      const oy = ((r.y % img.height) + img.height) % img.height - img.height;
      for (let y = oy; y < H; y += img.height) for (let x = ox; x < W; x += img.width) ctx.drawImage(img, m + x, m + y);
    } else if (fit === 'stretch' || fit === 'cover') {
      const r = fitRect(fit, pos, img.width, img.height, W + 2 * m, H + 2 * m);
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    } else {
      const r = fitRect(fit, pos, img.width, img.height, W, H);
      ctx.drawImage(img, m + r.x, m + r.y, r.w, r.h);
    }
  }

  const toBlob = (canvas) => new Promise((resolve) => {
    canvas.toBlob((b) => { if (b) resolve(b); else canvas.toBlob((p) => resolve(p), 'image/png'); }, 'image/webp', 0.9);
  });

  function renderLayer(img, W, H, scale, fit, pos, blur, saturate) {
    const m = blur > 0 ? Math.ceil(blur * 2) : 0;
    const tmp = document.createElement('canvas');
    tmp.width = Math.max(1, Math.round((W + 2 * m) * scale));
    tmp.height = Math.max(1, Math.round((H + 2 * m) * scale));
    const t = tmp.getContext('2d');
    t.scale(scale, scale);
    drawWallpaper(t, img, W, H, fit, pos, m);

    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(W * scale));
    out.height = Math.max(1, Math.round(H * scale));
    const o = out.getContext('2d');
    const filter = [blur > 0 ? `blur(${(blur * scale).toFixed(1)}px)` : '', saturate !== 1 ? `saturate(${saturate})` : ''].filter(Boolean).join(' ');
    if (filter) o.filter = filter;
    o.drawImage(tmp, -m * scale, -m * scale);
    return toBlob(out);
  }

  async function loadWallpaperBitmap() {
    if (wp.bitmap && wp.bitmap.close) wp.bitmap.close();
    wp.bitmap = null;
    wp.key = '';
    if (!wallpaper || !(window.api && window.api.readWallpaper)) return;
    try {
      const res = await window.api.readWallpaper();
      if (!res) return;
      wp.bitmap = await createImageBitmap(new Blob([res.bytes], { type: res.mime || 'image/png' }));
      wp.key = wallpaper.url;
    } catch (e) { wp.bitmap = null; }
  }

  function setWpLayers(bgBlob, glassBlob) {
    const root = document.documentElement.style;
    const old = [wp.urls.bg, wp.urls.glass];
    const bg = bgBlob ? URL.createObjectURL(bgBlob) : null;
    const glass = glassBlob === bgBlob ? bg : (glassBlob ? URL.createObjectURL(glassBlob) : null);
    wp.urls = { bg, glass };
    root.setProperty('--wp-bg', bg ? `url("${bg}")` : 'none');
    root.setProperty('--wp-glass', glass ? `url("${glass}")` : 'none');
    setTimeout(() => [...new Set(old.filter(Boolean))].forEach((u) => URL.revokeObjectURL(u)), 1500); // старые картинки освобождаем с запасом
  }

  const wallpaperSig = () => [wallpaper ? wallpaper.url : '', settings.wpFit, settings.wpPos, settings.wpBlur, settings.glassBlur,
                              window.innerWidth, window.innerHeight, window.devicePixelRatio || 1].join('|');

  async function rebuildWallpaper() {
    const seq = ++wp.seq;
    if (!wallpaper) { setWpLayers(null, null); wp.sig = wallpaperSig(); return; }
    if (!wp.bitmap || wp.key !== wallpaper.url) await loadWallpaperBitmap();
    if (seq !== wp.seq) return;
    if (!wp.bitmap) { setWpLayers(null, null); return; }
    const W = Math.max(1, window.innerWidth);
    const H = Math.max(1, window.innerHeight);
    const scale = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(W, H));
    const bg = await renderLayer(wp.bitmap, W, H, scale, settings.wpFit, settings.wpPos, settings.wpBlur, 1);
    if (seq !== wp.seq) return;
    const glass = settings.glassBlur > 0
      ? await renderLayer(wp.bitmap, W, H, scale, settings.wpFit, settings.wpPos, settings.wpBlur + settings.glassBlur, 1.15)
      : bg;
    if (seq !== wp.seq) return;
    setWpLayers(bg, glass);
    wp.sig = wallpaperSig();
  }
  const scheduleWallpaper = (delay = 120) => { clearTimeout(wp.timer); wp.timer = setTimeout(rebuildWallpaper, delay); };

  let lineHex = '#3e3e3e';

  // цвет обводки: «Авто» — контрастный к тексту, иначе белый, чёрный или выбранный оттенок
  function outlineRgb(text) {
    const c = settings.outlineColor;
    if (c === 'white') return '255,255,255';
    if (c === 'black') return '0,0,0';
    const p = TINTS.find((x) => x.id === c);
    if (p) return rgb(hsl(p.h, 100, 50)).join(',');
    return lum(text) > 0.4 ? '0,0,0' : '255,255,255';
  }

  function applyTheme() {
    const root = document.documentElement;
    const th = THEMES[settings.theme];
    const pal = palette(settings.theme);
    const custom = customText();
    const text = custom || pal.text;
    let muted = custom ? mix(custom, pal.main, 0.4) : pal.muted;
    if (settings.textOutline > 0) muted = mix(muted, text, 0.45);   // серый текст с обводкой выглядит грязным, поэтому он ближе к обычному

    SURFACES.forEach((k) => root.style.setProperty(k === 'line' ? '--line-solid' : '--' + k, pal[k]));
    lineHex = pal.line;
    const bgc = bgBase();
    if (bgc) root.style.setProperty('--bgc', bgc); else root.style.removeProperty('--bgc');
    root.style.setProperty('--text', text);
    root.style.setProperty('--muted', muted);
    root.style.setProperty('--on-text', lum(text) > 0.38 ? '#14141a' : '#ffffff');

    // с цветом оформления акцент берётся из него, без цвета — от платформы
    const accent = tintHex() || platform(state.platform).accent;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-ink', th.dark ? mix(accent, '#ffffff', th.lift) : mix(accent, '#000000', 0.5));
    root.style.setProperty('--on-accent', lum(accent) > 0.38 ? '#14141a' : '#ffffff');

    root.dataset.theme = settings.theme;
    root.dataset.glass = settings.glassBlur > 0 ? 'on' : 'off';
    root.dataset.wp = wallpaper ? 'on' : 'off';
    root.style.colorScheme = th.dark ? 'dark' : 'light';

    // прозрачность каждого элемента
    OPACITY.forEach(([key]) => root.style.setProperty('--' + key.replace(/^a/, 'a-').toLowerCase(), settings[key] + '%'));

    // обои: слои пересобираем только когда поменялось то, от чего они зависят; без обоев слои убираем сразу
    if (!wallpaper) { if (root.style.getPropertyValue('--wp-bg') !== 'none') { clearTimeout(wp.timer); wp.seq++; setWpLayers(null, null); } wp.sig = wallpaperSig(); }
    else if (wallpaperSig() !== wp.sig) scheduleWallpaper();

    // обводка текста и значков: работает и с обоями, и без них; цвет противоположен цвету текста
    const o = settings.textOutline / 100;
    if (o > 0) {
      const c = outlineRgb(text);
      if (settings.outlineStyle === 'sharp') {   // чёткая: сплошная тонкая кайма без размытия
        const t = Math.max(1, Math.round(0.5 + o * 1.5));
        const col = `rgba(${c},${+(0.6 + 0.4 * o).toFixed(2)})`;
        const dirs = [[t, 0], [-t, 0], [0, t], [0, -t], [t, t], [-t, t], [t, -t], [-t, -t]];
        root.style.setProperty('--ol-text', dirs.map(([x, y]) => `${x}px ${y}px 0 ${col}`).join(', '));
        root.style.setProperty('--ol-icon', settings.outlineIcons ? dirs.slice(0, 4).map(([x, y]) => `drop-shadow(${x}px ${y}px 0 ${col})`).join(' ') : 'none');
      } else {                                   // размытая
        const a = +(0.35 + 0.55 * o).toFixed(2);
        const r = +(1 + 3 * o).toFixed(1);
        root.style.setProperty('--ol-text', `0 0 1px rgba(${c},${a}), 0 0 ${r}px rgba(${c},${a}), 0 0 ${+(r * 2).toFixed(1)}px rgba(${c},${+(a * 0.6).toFixed(2)})`);
        root.style.setProperty('--ol-icon', settings.outlineIcons ? `drop-shadow(0 0 1px rgba(${c},${a})) drop-shadow(0 0 ${r}px rgba(${c},${a}))` : 'none');
      }
    } else {
      root.style.setProperty('--ol-text', 'none');
      root.style.setProperty('--ol-icon', 'none');
    }

    root.style.setProperty('--pattern-img', patternCss(settings.pattern, pal.line, patternAlpha()));
    root.style.setProperty('--pattern-size', (PATTERNS[settings.pattern].size || 8) + 'px');
    root.style.setProperty('--font', fontStack());
    root.style.setProperty('--fs', settings.fontSize + 'px');
    if ($('tabs') && $('tabs').firstChild) schedulePosition();
  }

  /* ---------- Левая панель ---------- */
  function renderRail() {
    $('rail').innerHTML =
      PLATFORMS.map((p, i) => `
        <button class="rail-btn ${state.platform === p.id ? 'active' : ''}" data-platform="${p.id}" data-tip="${esc(p.name)}" aria-label="${esc(p.name)}">
          ${badge(p)}
        </button>${i === 0 ? '<div class="rail-sep"></div>' : ''}`).join('') +
      `<div class="spacer"></div>
       <div class="rail-sep"></div>
       <button class="rail-btn settings" data-settings data-tip="${L('Settings')}" aria-label="${L('Settings')}">
         <span class="badge">${I.settings}</span>
       </button>`;
  }

  /* ---------- Верхняя панель и бар окна ---------- */
  function renderTopbar() {
    const p = platform(state.platform);
    // логотип платформы (тот же значок, что на левой панели) и её название: отдельная кнопка
    $('title').innerHTML = `<span class="chip-ico">${badge(p)}</span><span class="chip-name">${esc(p.name)}</span>`;
    $('title').title = p.name;
    $('tabs').innerHTML = p.tabs
      .map((t) => `<button class="tab ${curTab() === t ? 'active' : ''}" data-tab="${t}">${TAB_NAMES[t]}${curTab() === t ? '<i class="slash" aria-hidden="true">/</i>' : ''}</button>`).join('');
    renderTitlebar();
    schedulePosition();
  }

  // контур выбранной вкладки с внутренними скруглёнными стыками (SVG точно по размеру вкладки, без лишних линий внутри)
  function tabOutline(W, H, R) {
    const r = R + 0.5;               // радиус внутреннего стыка (с учётом полуширины линии)
    const k = R + 0.5;               // радиус верхних углов
    const y = H + 0.5;               // линия верхнего края полотна
    const right = r + W - 1;
    const d = `M0 ${y}A${r} ${r} 0 0 0 ${r} ${y - r}V${0.5 + k}A${k} ${k} 0 0 1 ${r + k} 0.5H${right - k}A${k} ${k} 0 0 1 ${right} ${0.5 + k}V${y - r}A${r} ${r} 0 0 0 ${right + r} ${y}`;
    return `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='${W + 2 * R + 1}' height='${H + 1}'>`
         + `<path d='${d}' fill='none' stroke='${encodeURIComponent(lineHex)}' stroke-opacity='${(settings.aLines / 100).toFixed(2)}'/></svg>")`;
  }

  // выбранная вкладка срастается с полотном: в рамке полотна вырезается просвет ровно под ней, а контур вкладки рисуется отдельно
  function positionTabGap() {
    const main = document.querySelector('.main');
    const canvas = $('content');
    const active = $('tabs').querySelector('.tab.active');
    if (!main || !canvas || !active) return;
    const c = canvas.getBoundingClientRect();
    const t = active.getBoundingClientRect();
    main.style.setProperty('--tab-l', (t.left - c.left) + 'px');
    main.style.setProperty('--tab-w', t.width + 'px');
    const R = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--r-3')) || 6;
    active.style.setProperty('--tab-outline', tabOutline(t.width, t.height, R));
  }
  const schedulePosition = () => (window.requestAnimationFrame || ((f) => setTimeout(f, 0)))(positionTabGap);

  function renderTitlebar() {
    const p = platform(state.platform);
    $('tbTitle').innerHTML = `<span class="tb-ico">${I[p.icon]}</span><span>${esc(p.name)}</span><span class="tb-tab">${esc(viewTitle() || TAB_NAMES[curTab()])}</span>`;
    $('tbBack').disabled = nav.pos === 0;
    $('tbForward').disabled = nav.pos >= nav.stack.length - 1;
  }

  /* ---------- Содержимое ---------- */
  // отметка платформы показывается только в «Все треки»
  const markMode = () => (state.platform === 'all' ? settings.sourceMode : null);
  const srcIcon = (src, size) =>
    `<span class="src-ico ${size}" style="${srcVars(src)}" title="${esc(src.name)}">${I[src.icon]}</span>`;

  const trackRow = (t) => {
    const src = platform(t.source);
    const mode = markMode();
    const cls = mode === 'icon' ? 'with-ico' : mode === 'label' ? 'with-src' : '';
    return `
      <div class="track ${cls} ${current() && current().id === t.id ? 'playing' : ''}" data-track="${t.id}">
        ${mode === 'icon' ? srcIcon(src, '') : ''}
        <div class="mini" style="background:${esc(coverBg(t.title + t.artist, t.art))}"><span class="ico">${I.play}</span></div>
        <div class="t-meta">
          <div class="t-title">${mode === 'title' ? srcIcon(src, 'sm') : ''}${titleLink(t)}</div>
          <div class="t-artist">${artistLink(t)}</div>
        </div>
        ${mode === 'label' ? `<div class="src" style="${srcVars(src)}"><i class="dot"></i>${esc(src.name)}</div>` : ''}
        <div class="t-dur">${fmt(t.dur)}</div>
      </div>`;
  };

  const trackCard = (t) => {
    const src = platform(t.source);
    const mode = markMode();
    return `
      <div class="card ${mode === 'label' ? 'with-label' : ''}" data-track="${t.id}">
        <div class="cover" style="background:${esc(coverBg(t.title + t.artist, t.art))}">
          ${mode === 'icon' ? `<span class="cover-ico" style="${srcVars(src)}" title="${esc(src.name)}">${I[src.icon]}</span>` : ''}
          <span class="fab">${I.play}</span>
        </div>
        <div class="card-title">${mode === 'title' ? srcIcon(src, 'sm') : ''}${titleLink(t)}</div>
        <div class="card-sub">${artistLink(t)}</div>
        ${mode === 'label' ? `<div class="card-src" style="${srcVars(src)}"><i class="dot"></i>${esc(src.name)}</div>` : ''}
      </div>`;
  };

  const trackList = (list) => list.map(trackRow).join('');

  // плашка вместо содержимого: платформа не подключена, идёт вход или загрузка
  function noticeHtml() {
    const id = state.platform;
    const isSc = id === 'soundcloud';
    const text = id === 'all' ? L('No platforms are connected yet.')
      : isSc && sc.loading ? L('Loading your SoundCloud library…')
      : L('The {0} account is not connected yet.', platform(id).name);
    let btn = `<button class="btn primary" disabled title="${L('Soon')}">${L('Connect account')}</button>`;
    if (id === 'all' || isSc) {
      if (sc.busy) btn = `<button class="btn primary" disabled>${L('Connecting…')}</button>`;
      else if (sc.loading) btn = '';
      else btn = `<button class="btn primary" data-sc="connect">${L(id === 'all' ? 'Connect SoundCloud' : 'Connect account')}</button>`;
    }
    const err = sc.error && (id === 'all' || isSc) ? `<small class="err">${esc(sc.error)}</small>` : '';
    return `<div class="notice"><p><b>${L('Demo data')}</b>${esc(text)}${err}</p>${btn}</div>`;
  }

  // верхняя строка раздела «Главная» у подключённого SoundCloud: чей аккаунт и кнопки обновления и выхода
  const accountBar = () => `
    <div class="notice">
      <p><b>${esc(sc.user && sc.user.name ? sc.user.name : 'SoundCloud')}</b>${esc(sc.loading ? L('Updating your library…') : L('Library synced with SoundCloud.'))}${sc.error ? `<small class="err">${esc(sc.error)}</small>` : ''}</p>
      <div class="btn-row">
        <button class="btn" data-sc="refresh" ${sc.loading ? 'disabled' : ''}>${L('Refresh')}</button>
        <button class="btn" data-sc="disconnect">${L('Disconnect')}</button>
      </div>
    </div>`;

  const emptyHtml = () => `<div class="empty">${L('Nothing here yet.')}</div>`;

  function renderContent() {
    const el = $('content');
    const data = DATA[state.platform];
    const q = state.query;
    const tab = curTab();

    // нет подключения: в любом разделе остаётся только плашка
    if (!data.connected) {
      visibleTracks = [];
      el.innerHTML = noticeHtml();
      return;
    }

    if (q) return renderSearch(el, data, q);
    if (state.view) return renderPage(el);

    if (tab === 'home') {
      const recent = data.recent.slice(0, 6);
      const more = data.recommended;
      visibleTracks = recent.concat(more);
      el.innerHTML = `
        ${state.platform === 'soundcloud' ? accountBar() : ''}
        ${recent.length ? `<div class="section"><div class="section-title">${L('Recently played')}</div><div class="grid">${recent.map(trackCard).join('')}</div></div>` : ''}
        ${more.length ? `<div class="section"><div class="section-title">${L('Recommended')}</div>${trackList(more)}</div>` : ''}
        ${recent.length || more.length ? '' : emptyHtml()}`;
    } else if (tab === 'liked') {
      visibleTracks = data.liked;
      el.innerHTML = `<div class="section"><div class="section-title">${L('Liked')}</div>${data.liked.length ? trackList(data.liked) : emptyHtml()}</div>`;
    } else if (tab === 'playlists') {
      visibleTracks = [];
      el.innerHTML = `
        <div class="section">
          <div class="section-title">${L('Playlists')}</div>
          ${data.playlists.length ? `<div class="grid">${data.playlists.map(playlistCard).join('')}</div>` : emptyHtml()}
        </div>`;
    } else {
      visibleTracks = [];
      el.innerHTML = `
        <div class="section">
          <div class="section-title">${L('Following')}</div>
          ${data.following.length ? `<div class="grid">${data.following.map(userCard).join('')}</div>` : emptyHtml()}
        </div>`;
    }
  }

  function renderAll() {
    applyTheme();
    renderRail();
    renderTopbar();
    renderContent();
  }

  /* ---------- Переходы и история (стрелки назад / вперёд) ---------- */
  function show(platformId, tabId, view) {
    state.platform = platformId;
    state.tabs[platformId] = tabId;
    state.view = view || null;
    state.expanded = new Set();
    state.query = '';
    remoteSearch.q = '';
    $('searchInput').value = '';
    document.querySelector('.scroller').scrollTop = 0;
    document.querySelector('.main').classList.remove('scrolled');
    if (state.view) loadPage(state.view);
    renderAll();
  }

  // обычный переход пользователя: запоминаем в истории и обрезаем «будущее»; false — переходить было некуда
  function go(platformId, tabId, view) {
    const here = nav.stack[nav.pos];
    if (here.platform === platformId && here.tab === tabId && viewKey(here.view) === viewKey(view)) return false;
    nav.stack = nav.stack.slice(0, nav.pos + 1);
    nav.stack.push({ platform: platformId, tab: tabId, view: view || null });
    if (nav.stack.length > 50) nav.stack.shift();
    nav.pos = nav.stack.length - 1;
    show(platformId, tabId, view);
    return true;
  }

  function stepHistory(delta) {
    const to = nav.pos + delta;
    if (to < 0 || to >= nav.stack.length) return;
    nav.pos = to;
    const s = nav.stack[to];
    show(s.platform, s.tab, s.view);
  }

  /* ---------- Шрифты из локальной папки fonts ---------- */
  const SYSTEM_STACK = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';
  const MONO_STACK = 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace';
  const fonts = { list: [], loaded: new Set() };
  let info = {}; // сведения о приложении из главного процесса

  async function loadFonts() {
    let list = [];
    try { if (window.api && window.api.listFonts) list = await window.api.listFonts(); } catch (e) { list = []; }
    const ok = [];
    for (const f of list) {
      let count = 0;
      await Promise.all(f.faces.map(async (face) => {
        try {
          if (!fonts.loaded.has(face.url)) {
            const ff = new FontFace(f.family, `url("${face.url}")`, { weight: face.weight, style: face.style });
            await ff.load();
            document.fonts.add(ff);
            fonts.loaded.add(face.url);
          }
          count++;
        } catch (e) { /* битый файл пропускаем */ }
      }));
      if (count) ok.push(f);
    }
    fonts.list = ok;
  }

  function fontStack() {
    const quote = (n) => '"' + String(n).replace(/["\\]/g, '') + '"';
    const has = (name) => fonts.list.some((f) => f.family === name);
    if (settings.font === 'system') return SYSTEM_STACK;
    if (settings.font !== 'auto' && has(settings.font)) {
      return quote(settings.font) + ', ' + (/mono|pixel|gothic/i.test(settings.font) ? MONO_STACK : SYSTEM_STACK);
    }
    // «Авто»: первый моноширинный шрифт из папки, как в ретро-оформлении
    const mono = fonts.list.find((f) => /mono/i.test(f.family));
    return (mono ? quote(mono.family) + ', ' : '') + MONO_STACK;
  }

  /* ---------- Окно настроек ---------- */
  // дерево разделов слева; у некоторых есть подразделы, как в Discord
  const NAV = [
    { items: [
      { id: 'accounts', name: 'Accounts', icon: 'person', subs: [{ id: 'platforms', name: 'Platforms' }, { id: 'sync', name: 'Sync' }] },
      { id: 'privacy', name: 'Data and privacy', icon: 'shield' },
      { id: 'notifications', name: 'Notifications', icon: 'bell' },
    ] },
    { title: 'App', items: [
      { id: 'playback', name: 'Playback', icon: 'play' },
      { id: 'appearance', name: 'Appearance', icon: 'palette', subs: [
        { id: 'theme', name: 'Theme and colors' }, { id: 'wall', name: 'Wallpaper and transparency' },
        { id: 'font', name: 'Font and size' }, { id: 'panels', name: 'Panels and marks' } ] },
      { id: 'language', name: 'Language', icon: 'globe' },
      { id: 'integrations', name: 'Integrations', icon: 'plug' },
      { id: 'hotkeys', name: 'Hotkeys', icon: 'keyboard' },
    ] },
    { title: 'Help', items: [
      { id: 'support', name: 'Support the project', icon: 'heartFill', subs: [{ id: 'author', name: 'Author' }, { id: 'more', name: 'Other ways' }] },
      { id: 'about', name: 'About', icon: 'info' },
    ] },
  ];

  // единый список настроек: из него берутся и заголовки на страницах, и поиск
  const DEFS = [
    { id: 'acc-platforms', section: 'accounts', sub: 'platforms', title: 'Connected platforms',
      desc: 'Connect your music accounts. SoundCloud signs in through a window inside the app; VK Music, YouTube Music and Yandex Music will be added later.' },
    { id: 'acc-sync', section: 'accounts', sub: 'sync', title: 'Library auto-update',
      desc: 'Keeps your library fresh: while the app is open, it checks SoundCloud in the background for new liked tracks, playlists and follows.' },
    { id: 'acc-sync-every', section: 'accounts', sub: 'sync', title: 'Update interval',
      desc: 'How often the app checks SoundCloud for changes.' },
    { id: 'priv-local', section: 'privacy', sub: null, title: 'Local data',
      desc: 'Settings, theme and volume are stored only on this computer and are never sent anywhere.' },
    { id: 'priv-reset', section: 'privacy', sub: null, title: 'Reset settings',
      desc: 'Return the theme, font, notifications and all other options to their defaults.' },
    { id: 'notif-track', section: 'notifications', sub: null, title: 'Track change notification',
      desc: 'Show a system notification with the title and artist when a new track starts.' },
    { id: 'notif-unfocused', section: 'notifications', sub: null, title: 'Only when the window is in the background',
      desc: 'Do not show notifications while the app window is active.' },
    { id: 'notif-silent', section: 'notifications', sub: null, title: 'Silent notifications',
      desc: 'Turn off the system sound when a notification appears.' },
    { id: 'notif-test', section: 'notifications', sub: null, title: 'Test notification',
      desc: 'Show a test notification with the current settings.' },
    { id: 'play-auto', section: 'playback', sub: null, title: 'Autoplay',
      desc: 'Start the next track as soon as the current one ends. When off, playback stops.' },
    { id: 'play-volume', section: 'playback', sub: null, title: 'Remember volume',
      desc: 'Keep the volume slider position between launches.' },
    { id: 'ap-theme', section: 'appearance', sub: 'theme', title: 'Theme',
      desc: 'From light to dark: drag the slider or click a name.' },
    { id: 'ap-tint', section: 'appearance', sub: 'theme', title: 'Accent color',
      desc: 'Tints the background and accents. With no color the interface stays neutral and the accent comes from the platform.' },
    { id: 'ap-bg', section: 'appearance', sub: 'theme', title: 'Background color',
      desc: 'The color of the background itself: it shows behind the wallpaper and under transparent panels, and does not recolor the panels. It has its own saturation, brightness depends on the theme.' },
    { id: 'ap-text', section: 'appearance', sub: 'theme', title: 'Text color',
      desc: 'The main color of text and icons. "Auto" follows the theme.' },
    { id: 'ap-font', section: 'appearance', sub: 'font', title: 'Font',
      desc: 'The list comes from the fonts folder in the project folder: put a font file or folder there and it will appear here.' },
    { id: 'ap-fontsize', section: 'appearance', sub: 'font', title: 'Font size',
      desc: 'The base text size of the interface; other sizes scale proportionally.' },
    { id: 'ap-wallpaper', section: 'appearance', sub: 'wall', title: 'Wallpaper',
      desc: 'Your own image file for the app background (PNG, JPG, WebP, GIF, BMP, AVIF). The file is copied to the app data folder, so the original can be deleted.' },
    { id: 'ap-wp-fit', section: 'appearance', sub: 'wall', title: 'Wallpaper placement',
      desc: 'Stretch to fill, fit without distortion, fill the window with cropping, original size or tiled. Below is the position: corners, edges and center.' },
    { id: 'ap-wp-blur', section: 'appearance', sub: 'wall', title: 'Wallpaper blur',
      desc: 'Blurs the picture so the text on top is easier to read.' },
    { id: 'ap-glass', section: 'appearance', sub: 'wall', title: 'Glass effect',
      desc: 'Panels slightly blur and distort the wallpaper under them. Visible when panels are semi-transparent. 0 turns the effect off.' },
    { id: 'ap-outline', section: 'appearance', sub: 'wall', title: 'Text and icon outline',
      desc: 'A thin outline so text and icons do not get lost on busy wallpapers: strength, color and whether it applies to icons. 0 turns the outline off.' },
    { id: 'ap-opacity', section: 'appearance', sub: 'wall', title: 'Element transparency',
      desc: 'A separate slider for every element: title bar, side panel, window background (the top bar shares it), main canvas, cards and rows, buttons, fields and headings, player, settings window and lines. Elements are independent: a card can be transparent even if the canvas is not. 100% is opaque (the default), 0% is fully transparent.' },
    { id: 'ap-pattern', section: 'appearance', sub: 'panels', title: 'Panel pattern',
      desc: 'A background pattern on the side panel, title bar and player: dots, grid, crosses or none. The slider sets how visible it is.' },
    { id: 'ap-marks', section: 'appearance', sub: 'panels', title: 'Track source',
      desc: 'How to mark the platform on tracks in "All tracks" and in the player at the bottom.' },
    { id: 'ap-scale', section: 'appearance', sub: 'font', title: 'Interface scale',
      desc: 'Enlarges or shrinks the whole interface: text, icons and spacing. Applied when you release the slider. The font size above changes only the text.' },
    { id: 'lang-select', section: 'language', sub: null, title: 'Interface language',
      desc: 'English is built in. Other languages come from .json files in the locales folder: put a file there, click "Refresh list" and the language will appear in the list.' },
    { id: 'lang-custom', section: 'language', sub: null, title: 'Your own translation',
      desc: 'Copy ru.json, translate the values to the right of the colon (do not change the English keys on the left), change name and code, and save the file in the same folder. Phrases without a translation stay in English.' },
    { id: 'int-rpc', section: 'integrations', sub: null, title: 'Discord status',
      desc: 'Show the track that is playing in your Discord profile.' },
    { id: 'int-lastfm', section: 'integrations', sub: null, title: 'Last.fm',
      desc: 'Send played tracks to Last.fm (scrobbling).' },
    { id: 'int-media', section: 'integrations', sub: null, title: 'Media keys and system player',
      desc: 'Control playback with keyboard keys and from the Windows panel.' },
    { id: 'keys-list', section: 'hotkeys', sub: null, title: 'Hotkeys',
      desc: 'Space: pause and play. Alt+← and Alt+→: back and forward through sections. Esc: close settings.' },
    { id: 'sup-author', section: 'support', sub: 'author', title: 'Support the author',
      desc: 'If the player is useful to you, support its development: with a donation, a subscription or any other way.' },
    { id: 'sup-share', section: 'support', sub: 'more', title: 'Tell your friends',
      desc: 'Copy a short message recommending the player to send to your friends.' },
    { id: 'sup-feedback', section: 'support', sub: 'more', title: 'Ideas and bug reports',
      desc: 'Tell the author what to improve or what does not work.' },
    { id: 'about-app', section: 'about', sub: null, title: 'About the app',
      desc: 'Music Player: one player for SoundCloud, VK Music, YouTube Music and Yandex Music.' },
    { id: 'about-info', section: 'about', sub: null, title: 'System information',
      desc: 'App, Electron, Chromium and system versions. Copy them and attach them to a bug report.' },
    { id: 'about-fonts', section: 'about', sub: null, title: 'Fonts and licenses',
      desc: 'The bundled fonts IBM Plex Mono, Manrope and DotGothic16 are distributed under the SIL Open Font License; the license texts are next to the fonts.' },
  ];
  const def = (id) => DEFS.find((d) => d.id === id);
  const secOf = (id) => NAV.flatMap((g) => g.items).find((x) => x.id === id);
  const subOf = (secId, subId) => ((secOf(secId) || {}).subs || []).find((x) => x.id === subId);

  /* --- строительные блоки страниц --- */
  const head = (id) => `<div class="setting-text"><div class="setting-title">${esc(def(id).title)}</div><div class="setting-desc">${esc(def(id).desc)}</div></div>`;
  const switchBtn = (key, on, disabled) =>
    `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${!!on}" data-toggle="${key}" ${disabled ? 'disabled' : ''}><i></i></button>`;
  const toggleRow = (id, key) => `<div class="setting" data-setting="${id}"><div class="setting-row">${head(id)}${switchBtn(key, settings[key], false)}</div></div>`;
  const soonRow = (id) => `<div class="setting" data-setting="${id}"><div class="setting-row">${head(id)}<span class="soon">${L('Soon')}</span>${switchBtn('', false, true)}</div></div>`;
  const buttonRow = (id, btn) => `<div class="setting" data-setting="${id}"><div class="setting-row">${head(id)}${btn}</div></div>`;
  const infoRow = (id) => `<div class="setting" data-setting="${id}">${head(id)}</div>`;
  const blockRow = (id, body) => `<div class="setting" data-setting="${id}">${head(id)}<div class="setting-body">${body}</div></div>`;

  const themeStops = () => THEME_ORDER.map((k) => palette(k).main).join(',');

  function themeSliderHtml() {
    const idx = THEME_ORDER.indexOf(settings.theme);
    return `
      <div class="theme-slider">
        <input type="range" id="themeRange" min="0" max="${THEME_ORDER.length - 1}" step="1" value="${idx}"
               style="--stops:${themeStops()}" aria-label="${L('Theme')}">
        <div class="stops">${THEME_ORDER.map((k, i) => `
          <button class="stop ${i === idx ? 'on' : ''}" data-theme-step="${i}"
                  style="left:calc(9px + (100% - 18px) * ${i / (THEME_ORDER.length - 1)})">${THEMES[k].name}</button>`).join('')}
        </div>
      </div>`;
  }

  function choice(mode) {
    const sc = platform('soundcloud');
    const cov = '<i class="sk-cover"></i>';
    const line = (thin) => `<i class="sk-line ${thin ? 'thin' : ''}"></i>`;
    const meta = (withIcon) => `<span class="sk-meta"><span class="sk-row">${withIcon ? srcIcon(sc, 'sm') : ''}${line()}</span>${line(true)}</span>`;
    const label = `<span class="src" style="${srcVars(sc)}"><i class="dot"></i>SoundCloud</span>`;
    const preview = mode === 'icon' ? srcIcon(sc, 'sm') + cov + meta(false)
                  : mode === 'title' ? cov + meta(true)
                  : cov + meta(false) + label;
    return `
      <button class="choice ${settings.sourceMode === mode ? 'sel' : ''}" data-source-mode="${mode}">
        <div class="choice-prev">${preview}</div>
        <b>${SOURCE_MODES[mode].name}</b>
        <small>${SOURCE_MODES[mode].hint}</small>
      </button>`;
  }

  function patternChoice(key) {
    const css = patternCss(key, lineHex, patternAlpha());
    const size = PATTERNS[key].size || 8;
    return `
      <button class="choice ${settings.pattern === key ? 'sel' : ''}" data-pattern="${key}">
        <div class="choice-prev pat" style="background-image:${esc(css)};background-size:${size}px ${size}px"></div>
        <b>${PATTERNS[key].name}</b>
      </button>`;
  }

  function patternControls() {
    const on = settings.pattern !== 'none';
    return `
      <div class="choices">${Object.keys(PATTERNS).map(patternChoice).join('')}</div>
      <div class="sat ${on ? '' : 'off'}">
        <label for="patRange">${L('Visibility')}</label>
        <input type="range" id="patRange" min="0" max="100" value="${settings.patternAlpha}" ${on ? '' : 'disabled'} style="--from:var(--line);--to:var(--muted)">
        <span class="sat-val" id="patVal">${settings.patternAlpha}%</span>
      </div>`;
  }

  // ряд ползунка насыщенности под плитками
  function satRow(inputId, valId, value, hue, enabled) {
    const from = hue ? hsl(hue.h, 0, hue.l) : '#808080';
    const to = hue ? hsl(hue.h, 100, hue.l) : '#b0b0b0';
    return `
      <div class="sat ${enabled ? '' : 'off'}">
        <label for="${inputId}">${L('Saturation')}</label>
        <input type="range" id="${inputId}" min="0" max="100" value="${value}" ${enabled ? '' : 'disabled'} style="--from:${from};--to:${to}">
        <span class="sat-val" id="${valId}">${value}%</span>
      </div>`;
  }

  function tintControls() {
    const tint = TINTS.find((p) => p.id === settings.tint);
    return `
      <div class="swatches">
        <button class="swatch none ${settings.tint ? '' : 'sel'}" data-tint="none" title="${L('No color')}" aria-label="${L('No color')}"></button>
        ${TINTS.map((p) => `
          <button class="swatch ${settings.tint === p.id ? 'sel' : ''}" data-tint="${p.id}"
                  style="background:${tintColor(p)}" title="${p.name}" aria-label="${p.name}"></button>`).join('')}
      </div>
      <div class="swatch-name">${tint ? tint.name : L('No color')}</div>
      ${satRow('satRange', 'satVal', settings.sat, tint, !!tint)}
      <div class="sat-hint">${tint ? '' : L('Pick a color to adjust its saturation.')}</div>`;
  }

  function textControls() {
    const hueP = TINTS.find((p) => p.id === settings.textColor);
    return `
      <div class="swatches">
        <button class="swatch auto ${settings.textColor === 'auto' ? 'sel' : ''}" data-text="auto" title="${L('Auto')}" aria-label="${L('Auto')}"
                style="color:${THEMES[settings.theme].text}">${L('Aa')}</button>
        <button class="swatch ${settings.textColor === 'white' ? 'sel' : ''}" data-text="white" title="${L('White')}" aria-label="${L('White')}" style="background:#ffffff"></button>
        <button class="swatch ${settings.textColor === 'black' ? 'sel' : ''}" data-text="black" title="${L('Black')}" aria-label="${L('Black')}" style="background:#000000"></button>
        ${TINTS.map((p) => `
          <button class="swatch ${settings.textColor === p.id ? 'sel' : ''}" data-text="${p.id}"
                  style="background:${textHue(p)}" title="${p.name}" aria-label="${p.name}"></button>`).join('')}
      </div>
      <div class="swatch-name" id="textName">${textName()}</div>
      ${satRow('textSatRange', 'textSatVal', settings.textSat, hueP, !!hueP)}
      <div class="sat-hint">${hueP ? '' : L('Saturation can be adjusted for colored text.')}</div>`;
  }

  // плитки выбора цвета: авто, белый, чёрный и 20 оттенков (для фона и обводки)
  const colorTiles = (attr, current) => `
    <div class="swatches">
      <button class="swatch auto ${current === 'auto' ? 'sel' : ''}" data-${attr}="auto" title="${L('Auto')}" aria-label="${L('Auto')}" style="color:${THEMES[settings.theme].text}">${L('Aa')}</button>
      <button class="swatch ${current === 'white' ? 'sel' : ''}" data-${attr}="white" title="${L('White')}" aria-label="${L('White')}" style="background:#ffffff"></button>
      <button class="swatch ${current === 'black' ? 'sel' : ''}" data-${attr}="black" title="${L('Black')}" aria-label="${L('Black')}" style="background:#000000"></button>
      ${TINTS.map((p) => `<button class="swatch ${current === p.id ? 'sel' : ''}" data-${attr}="${p.id}" style="background:${hsl(p.h, 100, 50)}" title="${p.name}" aria-label="${p.name}"></button>`).join('')}
    </div>`;
  const colorName = (c) => (c === 'auto' ? L('Auto') : TEXT_FIXED[c] ? TEXT_FIXED[c].name : (TINTS.find((x) => x.id === c) || {}).name);

  const bgControls = () => colorTiles('bg', settings.bgColor) + `<div class="swatch-name">${colorName(settings.bgColor)}</div>`
    + sliderRow('bgSat', L('Saturation'), settings.bgSat, 0, 100, '%');

  const outlineControls = () => sliderRow('textOutline', L('Outline strength'), settings.textOutline, 0, 100, '%')
    + `<div class="btn-row" style="margin-top:14px"><button class="btn ${settings.outlineStyle === 'soft' ? 'primary' : ''}" data-ol-style="soft">${L('Soft')}</button><button class="btn ${settings.outlineStyle === 'sharp' ? 'primary' : ''}" data-ol-style="sharp">${L('Sharp')}</button></div>`
    + `<div class="swatch-name" style="margin-top:14px">${L('Outline color')}</div>` + colorTiles('outline', settings.outlineColor)
    + `<div class="swatch-name">${colorName(settings.outlineColor)}</div>`
    + `<div class="setting-row" style="margin-top:12px"><div class="setting-text">${L('Apply to icons')}</div>${switchBtn('outlineIcons', settings.outlineIcons, false)}</div>`;

  function fontControls() {
    const exists = fonts.list.some((f) => f.family === settings.font);
    const selected = settings.font === 'system' || exists ? settings.font : 'auto';
    const opts = [['auto', L('Auto (by style)')], ['system', L('System font')], ...fonts.list.map((f) => [f.family, f.family])];
    return `
      <select class="select" id="fontSelect" aria-label="${L('Font')}">
        ${opts.map(([v, n]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
      <p class="font-preview">${L('Pack my box with five dozen liquor jugs. The quick brown fox 0123456789')}</p>
      <div class="btn-row">
        <button class="btn" data-action="open-fonts">${L('Open fonts folder')}</button>
        <button class="btn" data-action="reload-fonts">${L('Refresh list')}</button>
      </div>
      ${fonts.list.length ? '' : `<p class="setting-desc">${L('The fonts folder was not found or is empty, so only system fonts are available.')}</p>`}`;
  }

  function fontSizeControls() {
    return `
      <div class="sat">
        <label for="fsRange">${L('Size')}</label>
        <input type="range" id="fsRange" min="12" max="18" step="1" value="${settings.fontSize}" style="--from:var(--line);--to:var(--muted)">
        <span class="sat-val" id="fsVal">${settings.fontSize} px</span>
      </div>`;
  }

  function scaleControls() {
    return `
      <div class="sat">
        <label for="scaleRange">${L('Scale')}</label>
        <input type="range" id="scaleRange" min="75" max="150" step="5" value="${settings.uiScale}" style="--from:var(--line);--to:var(--muted)">
        <span class="sat-val" id="scaleVal">${settings.uiScale}%</span>
      </div>
      <div class="btn-row"><button class="btn" data-action="scale-reset" ${settings.uiScale === 100 ? 'disabled' : ''}>${L('Reset scale')}</button></div>`;
  }

  function languageControls() {
    const opts = [{ code: 'en', name: 'English' }, ...lang.list];
    return `
      <select class="select" id="langSelect" aria-label="${L('Interface language')}">
        ${opts.map((o) => `<option value="${esc(o.code)}" ${o.code === lang.code ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
      </select>
      ${lang.list.length ? '' : `<p class="setting-desc">${L('The locales folder was not found or has no languages, so only English is available.')}</p>`}`;
  }

  const customLangControls = () => `
    <div class="btn-row" style="margin-top:0">
      <button class="btn" data-action="open-locales">${L('Open languages folder')}</button>
      <button class="btn" data-action="reload-locales">${L('Refresh list')}</button>
    </div>`;

  const platformRows = () => PLATFORMS.filter((p) => p.id !== 'all').map((p) => {
    if (p.id !== 'soundcloud') {
      return `
    <div class="row">
      ${badge(p)}
      <div class="grow">${esc(p.name)}<small>${L('Not connected')}</small></div>
      <button class="btn" disabled title="${L('Soon')}">${L('Connect')}</button>
    </div>`;
    }
    const status = sc.loading ? L('Loading…')
      : sc.connected ? (sc.user && sc.user.name ? L('Signed in as {0}', sc.user.name) : L('Connected'))
      : L('Not connected');
    const btns = sc.connected
      ? `<button class="btn" data-sc="refresh" ${sc.loading ? 'disabled' : ''}>${L('Refresh')}</button><button class="btn" data-sc="disconnect">${L('Disconnect')}</button>`
      : `<button class="btn primary" data-sc="connect" ${sc.busy ? 'disabled' : ''}>${sc.busy ? L('Connecting…') : L('Connect')}</button>`;
    return `
    <div class="row">
      ${badge(p)}
      <div class="grow">${esc(p.name)}<small>${esc(status)}</small>${sc.error ? `<small class="err">${esc(sc.error)}</small>` : ''}</div>
      <div class="btn-row" style="margin:0">${btns}</div>
    </div>`;
  }).join('');

  const syncControls = () => `
    <select class="select" id="syncSelect" aria-label="${L('Update interval')}">
      ${[5, 15, 30, 60].map((m) => `<option value="${m}" ${m === settings.syncEvery ? 'selected' : ''}>${esc(L('Every {0} minutes', m))}</option>`).join('')}
    </select>`;

  const hotkeys = () => `
    <dl class="keys">
      <div><dt><kbd>${L('Space')}</kbd></dt><dd>${L('Pause and play')}</dd></div>
      <div><dt><kbd>Alt</kbd> + <kbd>←</kbd></dt><dd>${L('Back through sections')}</dd></div>
      <div><dt><kbd>Alt</kbd> + <kbd>→</kbd></dt><dd>${L('Forward through sections')}</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>${L('Close settings')}</dd></div>
    </dl>`;

  const versions = () => {
    const rows = [[L('Version'), info.version], ['Electron', info.electron], ['Chromium', info.chrome], ['Node.js', info.node],
                  [L('System'), info.platform ? `${info.platform} ${info.arch || ''}`.trim() : '']].filter((r) => r[1]);
    return rows.length ? `<dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
  };

  /* --- раздел «Поддержать проект»: ссылки автора лежат в support.json --- */
  let wallpaper = null; // { url, name, size } из главного процесса
  let supportCfg = { author: '', message: '', share: '', feedback: '', links: [] };

  function supportAuthorHtml() {
    const links = supportCfg.links || [];
    const msg = supportCfg.message ? `<p class="support-msg">${esc(L(supportCfg.message))}</p>` : '';
    const by = supportCfg.author ? `<p class="setting-desc">${L('Author:')} ${esc(supportCfg.author)}</p>` : '';
    const rows = links.length ? links.map((l, i) => `
      <div class="row">
        <span class="badge heart">${I.heartFill}</span>
        <div class="grow">${esc(L(l.title))}<small>${esc(L(l.note))}</small></div>
        ${l.url ? `<button class="btn primary" data-open="${i}">${L('Open')}</button>` : `<span class="soon">${L('Link not set')}</span>`}
      </div>`).join('')
      : `<p class="setting-desc">${L('No links yet: the author can add them in support.json.')}</p>`;
    return msg + by + rows;
  }

  /* --- обои и прозрачность --- */
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' ' + L('MB') : Math.max(1, Math.round(n / 1024)) + ' ' + L('KB'));

  function wallpaperControls() {
    return `
      <div class="wp-box">
        <div class="wp-thumb" id="wpThumb" style="${wallpaper ? `background-image:${esc(`url("${wallpaper.url}")`)}` : ''}">${wallpaper ? '' : L('No wallpaper')}</div>
        <div>
          <div class="wp-name" id="wpName">${wallpaper ? esc(wallpaper.name) + ', ' + fmtSize(wallpaper.size) : L('No file selected')}</div>
          <div class="btn-row" style="margin-top:0">
            <button class="btn primary" data-action="wp-pick">${L('Choose file…')}</button>
            <button class="btn" data-action="wp-clear" ${wallpaper ? '' : 'disabled'}>${L('Remove wallpaper')}</button>
          </div>
        </div>
      </div>`;
  }

  function fitControls() {
    const stretch = settings.wpFit === 'stretch';
    return `
      <div class="wp-fit-row">
        <div class="field"><span>${L('Placement')}</span>
          <select class="select" id="wpFit" aria-label="${L('Wallpaper placement')}">
            ${Object.keys(WP_FITS).map((k) => `<option value="${k}" ${settings.wpFit === k ? 'selected' : ''}>${WP_FITS[k].name}</option>`).join('')}
          </select>
        </div>
        <div class="field"><span>${L('Position')}</span>
          <div class="pos-grid ${stretch ? 'off' : ''}" id="posGrid">
            ${Object.keys(WP_POS).map((k) => `<button class="pos ${settings.wpPos === k ? 'sel' : ''}" data-wp-pos="${k}" title="${WP_POS[k][1]}" aria-label="${WP_POS[k][1]}"></button>`).join('')}
          </div>
        </div>
      </div>`;
  }

  // общий ряд ползунка: подпись, ползунок, значение
  const sliderRow = (key, label, value, min, max, unit) => `
    <div class="srow">
      <label for="sl-${key}">${label}</label>
      <input type="range" id="sl-${key}" data-set="${key}" data-unit="${unit}" min="${min}" max="${max}" value="${value}">
      <span class="val" id="val-${key}">${value}${unit}</span>
    </div>`;

  const opacityControls = () => OPACITY.map(([k, name]) => sliderRow(k, name, settings[k], 0, 100, '%')).join('')
    + `<div class="btn-row"><button class="btn" data-action="op-reset">${L('Make everything opaque')}</button></div>`;

  function pageHtml(id) {
    const S = secOf(id);
    const wrap = (subId, inner) =>
      `<section class="sub" id="sub-${subId}" data-sub="${subId}"><h4 class="sub-title">${esc(subOf(id, subId).name)}</h4>${inner}</section>`;
    let inner = '';
    switch (id) {
      case 'accounts':
        inner = wrap('platforms', blockRow('acc-platforms', platformRows())) + wrap('sync', toggleRow('acc-sync', 'autoSync') + blockRow('acc-sync-every', syncControls()));
        break;
      case 'privacy':
        inner = infoRow('priv-local') + buttonRow('priv-reset', `<button class="btn danger" data-action="reset">${L('Reset')}</button>`);
        break;
      case 'notifications':
        inner = toggleRow('notif-track', 'notifyTrack') + toggleRow('notif-unfocused', 'notifyUnfocused') + toggleRow('notif-silent', 'notifySilent')
              + buttonRow('notif-test', `<button class="btn" data-action="test-notify">${L('Show')}</button>`);
        break;
      case 'playback':
        inner = toggleRow('play-auto', 'autoplay') + toggleRow('play-volume', 'rememberVolume');
        break;
      case 'appearance':
        inner = wrap('theme', blockRow('ap-theme', themeSliderHtml()) + blockRow('ap-tint', tintControls()) + blockRow('ap-bg', bgControls()) + blockRow('ap-text', textControls()))
              + wrap('wall', blockRow('ap-wallpaper', wallpaperControls()) + blockRow('ap-wp-fit', fitControls())
                           + blockRow('ap-wp-blur', sliderRow('wpBlur', L('Blur'), settings.wpBlur, 0, 40, ' px'))
                           + blockRow('ap-glass', sliderRow('glassBlur', L('Effect strength'), settings.glassBlur, 0, 24, ' px'))
                           + blockRow('ap-outline', outlineControls())
                           + blockRow('ap-opacity', opacityControls()))
              + wrap('font', blockRow('ap-font', fontControls()) + blockRow('ap-fontsize', fontSizeControls()) + blockRow('ap-scale', scaleControls()))
              + wrap('panels', blockRow('ap-pattern', patternControls())
                             + blockRow('ap-marks', `<div class="choices">${['icon', 'title', 'label'].map(choice).join('')}</div>`));
        break;
      case 'language':
        inner = blockRow('lang-select', languageControls()) + blockRow('lang-custom', customLangControls());
        break;
      case 'integrations':
        inner = soonRow('int-rpc') + soonRow('int-lastfm') + soonRow('int-media');
        break;
      case 'hotkeys':
        inner = blockRow('keys-list', hotkeys());
        break;
      case 'support': {
        const noFeedback = !supportCfg.feedback;
        inner = wrap('author', blockRow('sup-author', supportAuthorHtml()))
              + wrap('more', buttonRow('sup-share', `<button class="btn" data-action="share">${L('Copy text')}</button>`)
                           + buttonRow('sup-feedback', (noFeedback ? `<span class="soon">${L('Link not set')}</span>` : '')
                                     + `<button class="btn" data-action="open-feedback" ${noFeedback ? 'disabled' : ''}>${L('Write')}</button>`));
        break;
      }
      case 'about':
        inner = blockRow('about-app', versions()) + buttonRow('about-info', `<button class="btn" data-action="copy-info">${L('Copy')}</button>`) + infoRow('about-fonts');
        break;
      default: break;
    }
    return S.subs ? inner : `<h3 class="set-title">${esc(S.name)}</h3>${inner}`;
  }

  // поиск по основам слов: «обои» находит и «обоев», «шрифт» находит «шрифты»
  const stem = (w) => (w.length > 4 ? w.slice(0, -1) : w.length === 4 ? w.slice(0, 3) : w);
  const searchTerms = (q) => q.toLowerCase().split(/\s+/).filter(Boolean).map(stem);

  // подсветка найденного текста (слово целиком)
  const hl = (text, terms) => {
    const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\p{L}\\d]*').join('|') + ')', 'giu');
    return text.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
  };

  // поиск идёт по названиям и описаниям настроек
  function searchHtml(q) {
    const terms = searchTerms(q);
    const found = DEFS.filter((d) => { const text = (d.title + ' ' + d.desc).toLowerCase(); return terms.every((t) => text.includes(t)); });
    const crumb = (d) => secOf(d.section).name + (d.sub ? ' › ' + subOf(d.section, d.sub).name : '');
    return `
      <h3 class="set-title">${L('Search results')}</h3>
      ${found.length ? found.map((d) => `
        <button class="result" data-goto="${d.id}">
          <span class="crumb">${esc(crumb(d))}</span>
          <span class="r-title">${hl(d.title, terms)}</span>
          <span class="r-desc">${hl(d.desc, terms)}</span>
        </button>`).join('') : `<div class="empty">${L('Nothing found. Try another word.')}</div>`}`;
  }

  /* --- левая колонка, содержимое и переходы --- */
  function renderNav() {
    const searching = !!ui.search;
    $('navTree').innerHTML = NAV.map((g) => `
      ${g.title ? `<div class="nav-group">${esc(g.title)}</div>` : ''}
      ${g.items.map((s) => {
        const active = !searching && ui.section === s.id;
        return `<button class="nav-item ${active ? 'active' : ''}" data-section="${s.id}"><span class="nav-ico">${I[s.icon]}</span>${esc(s.name)}</button>`
          + (active && s.subs ? `<div class="nav-subs">${s.subs.map((x) =>
              `<button class="nav-sub ${ui.sub === x.id ? 'active' : ''}" data-section="${s.id}" data-sub="${x.id}">${esc(x.name)}</button>`).join('')}</div>` : '');
      }).join('')}`).join('');
  }

  function renderBody(keepScroll) {
    const body = $('modalBody');
    const top = body.scrollTop;
    body.innerHTML = ui.search ? searchHtml(ui.search) : pageHtml(ui.section);
    body.querySelectorAll('.srow input').forEach(setFill);
    body.scrollTop = keepScroll ? top : 0;
  }

  function scrollToSub(subId) {
    ui.lockUntil = Date.now() + 800;   // пока идёт прокрутка, подсветка подраздела не перескакивает
    const body = $('modalBody');
    const el = $('sub-' + subId);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - body.getBoundingClientRect().top - 16;
    if (body.scrollTo) body.scrollTo({ top: body.scrollTop + delta, behavior: 'smooth' });
    else body.scrollTop += delta;
  }

  function openSection(id, subId) {
    ui.section = id;
    ui.search = '';
    $('settingsSearch').value = '';
    const S = secOf(id);
    ui.sub = subId || (S.subs ? S.subs[0].id : null);
    renderNav();
    renderBody(false);
    if (subId) scrollToSub(subId);
  }

  function flash(id) {
    const el = document.querySelector(`[data-setting="${id}"]`);
    if (!el) return;
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1700);
  }

  // переход к найденной настройке
  function gotoSetting(id) {
    const d = def(id);
    ui.section = d.section;
    ui.sub = d.sub;
    ui.search = '';
    $('settingsSearch').value = '';
    renderNav();
    renderBody(false);
    flash(id);
  }

  // при прокрутке подсвечиваем тот подраздел, который сейчас сверху
  function updateSpy() {
    if (ui.search || Date.now() < (ui.lockUntil || 0)) return;
    const body = $('modalBody');
    const subs = [...body.querySelectorAll('.sub')];
    if (!subs.length) return;
    const topY = body.getBoundingClientRect().top;
    let cur = subs[0];
    subs.forEach((el) => { if (el.getBoundingClientRect().top - topY <= 60) cur = el; });
    if (body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 4) cur = subs[subs.length - 1];
    if (cur.dataset.sub === ui.sub) return;
    ui.sub = cur.dataset.sub;
    document.querySelectorAll('.nav-sub').forEach((b) => b.classList.toggle('active', b.dataset.sub === ui.sub));
  }

  // при движении ползунков обновляем цвета на месте, не пересоздавая сами ползунки
  function refreshColors() {
    applyTheme();
    const body = $('modalBody');
    body.querySelectorAll('.swatch[data-tint]').forEach((el) => {
      const p = TINTS.find((x) => x.id === el.dataset.tint);
      if (p) el.style.background = tintColor(p);
    });
    body.querySelectorAll('.swatch[data-text]').forEach((el) => {
      const p = TINTS.find((x) => x.id === el.dataset.text);
      if (p) el.style.background = textHue(p);
    });
    const auto = body.querySelector('.swatch.auto');
    if (auto) auto.style.color = THEMES[settings.theme].text;

    const range = $('themeRange');
    if (range) {
      range.style.setProperty('--stops', themeStops());
      body.querySelectorAll('.stop').forEach((el) => el.classList.toggle('on', Number(el.dataset.themeStep) === THEME_ORDER.indexOf(settings.theme)));
    }
    if ($('satVal')) $('satVal').textContent = settings.sat + '%';
    if ($('textSatVal')) $('textSatVal').textContent = settings.textSat + '%';
  }

  const openSettings = () => {
    ui.search = '';
    $('settingsSearch').value = '';
    renderNav();
    renderBody(false);
    $('overlay').hidden = false;
    document.body.classList.add('modal-open');
    $('closeBtn').focus();
  };
  const closeSettings = () => {
    $('overlay').hidden = true;
    document.body.classList.remove('modal-open');
  };

  /* --- действия-кнопки, уведомления, сброс --- */
  function notify(t, force) {
    if (!t || !window.Notification) return;
    if (!force && (!settings.notifyTrack || (settings.notifyUnfocused && document.hasFocus()))) return;
    try {
      if (Notification.permission === 'denied') return;
      new Notification(t.title, { body: t.artist, silent: settings.notifySilent });
    } catch (e) { /* нет прав на уведомления */ }
  }

  async function resetSettings() {
    Object.assign(settings, DEFAULTS);
    setLanguage(settings.lang);
    applyScale();
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ничего */ }
    try { if (window.api && window.api.clearWallpaper) await window.api.clearWallpaper(); } catch (e) { /* ничего */ }
    wallpaper = null;
    wp.bitmap = null;
    $('vol').value = settings.volume;
    setFill($('vol'));
    audio.volume = settings.volume / 100;
    applyTheme();
    refreshLanguage();
  }

  // язык сменился (или список языков обновился): перерисовываем всё, что содержит текст
  function refreshLanguage() {
    renderAll();
    updatePlayer();
    labelWindowButtons();
    renderNav();
    renderBody(true);
  }

  async function openSupportLink(url) {
    if (!url) return;
    try { if (window.api && window.api.openExternal) await window.api.openExternal(url); } catch (e) { /* ничего */ }
  }

  async function runAction(btn) {
    const a = btn.dataset.action;
    if (a === 'reset') {
      if (!btn.dataset.armed) { // сброс подтверждается вторым нажатием
        btn.dataset.armed = '1';
        btn.textContent = L('Click again');
        setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = L('Reset'); } }, 3000);
        return;
      }
      await resetSettings();
    } else if (a === 'test-notify') {
      notify(current() || DATA.all.liked[0] || { title: 'Music Player', artist: L('Test notification') }, true);
    } else if (a === 'copy-info') {
      const lines = [`Music Player ${info.version || ''}`.trim(), `Electron ${info.electron || '?'}, Chromium ${info.chrome || '?'}, Node ${info.node || '?'}`,
                     `${L('System')}: ${info.platform || '?'} ${info.arch || ''}`.trim(), `${L('Theme')}: ${settings.theme}, ${L('font')}: ${settings.font}, ${settings.fontSize} px`];
      try { await navigator.clipboard.writeText(lines.join('\n')); btn.textContent = L('Copied'); } catch (e) { btn.textContent = L('Failed'); }
      setTimeout(() => { if (btn.isConnected) btn.textContent = L('Copy'); }, 1500);
    } else if (a === 'share') {
      const text = L(supportCfg.share || 'Try Music Player: one player for SoundCloud, VK Music, YouTube Music and Yandex Music.');
      try { await navigator.clipboard.writeText(text); btn.textContent = L('Copied'); } catch (e) { btn.textContent = L('Failed'); }
      setTimeout(() => { if (btn.isConnected) btn.textContent = L('Copy text'); }, 1500);
    } else if (a === 'open-feedback') {
      openSupportLink(supportCfg.feedback);
    } else if (a === 'wp-pick') {
      try { if (window.api && window.api.pickWallpaper) wallpaper = await window.api.pickWallpaper(); } catch (e) { /* ничего */ }
      wp.bitmap = null;
      applyTheme();
      renderBody(true);
    } else if (a === 'wp-clear') {
      try { if (window.api && window.api.clearWallpaper) await window.api.clearWallpaper(); } catch (e) { /* ничего */ }
      wallpaper = null;
      wp.bitmap = null;
      applyTheme();
      renderBody(true);
    } else if (a === 'op-reset') {
      OPACITY.forEach(([k]) => { settings[k] = 100; });
      saveSettings();
      applyTheme();
      renderBody(true);
    } else if (a === 'scale-reset') {
      settings.uiScale = 100;
      saveSettings();
      applyScale();
      renderBody(true);
    } else if (a === 'open-locales') {
      try { if (window.api && window.api.openLocalesFolder) await window.api.openLocalesFolder(); } catch (e) { /* ничего */ }
    } else if (a === 'reload-locales') {
      await loadLocales();
      refreshLanguage();
    } else if (a === 'open-fonts') {
      try { if (window.api && window.api.openFontsFolder) await window.api.openFontsFolder(); } catch (e) { /* ничего */ }
    } else if (a === 'reload-fonts') {
      await loadFonts();
      applyTheme();
      renderBody(true);
    }
  }

  /* ---------- Плеер ---------- */
  function setFill(input) {
    const max = Number(input.max) || 1;
    input.style.setProperty('--fill', `${(Number(input.value) / max) * 100}%`);
  }

  function updateProgress() {
    const t = current();
    const dur = t ? t.dur : 0;
    $('seek').max = dur || 100;
    $('seek').value = player.elapsed;
    $('curTime').textContent = fmt(player.elapsed);
    $('durTime').textContent = fmt(dur);
    setFill($('seek'));
  }

  function markPlaying() {
    const id = current() ? current().id : null;
    document.querySelectorAll('[data-track]').forEach((el) => {
      el.classList.toggle('playing', Number(el.dataset.track) === id);
    });
  }

  const REPEAT_TITLES = { off: 'Repeat off', all: 'Repeat playlist', one: 'Repeat track' };

  function updatePlayer() {
    const t = current();
    // отметка платформы у играющего трека: так же, как на карточках (значок на обложке, у названия или подпись)
    const src = t ? platform(t.source) : null;
    const mode = settings.sourceMode;
    $('npCover').style.background = t ? coverBg(t.title + t.artist, t.art) : '';
    $('npCover').innerHTML = src && mode === 'icon'
      ? `<span class="cover-ico np-ico" style="${srcVars(src)}" title="${esc(src.name)}">${I[src.icon]}</span>` : '';
    $('npTitle').innerHTML = (src && mode === 'title' ? srcIcon(src, 'sm') : '')
      + `<span class="t-text">${esc(t ? t.title : L('Nothing is playing'))}</span>`;
    $('npArtist').textContent = !t ? L('Pick a track') : player.error ? player.error : player.loading ? L('Loading…') : t.artist;
    $('npSrc').setAttribute('style', src ? srcVars(src) : '');
    $('npSrc').innerHTML = src && mode === 'label' ? `<i class="dot"></i>${esc(src.name)}` : '';
    $('playBtn').innerHTML = player.playing ? I.pause : I.play;
    $('playBtn').title = L(player.playing ? 'Pause' : 'Play');
    $('likeBtn').classList.toggle('on', !!t && player.liked.has(t.id));
    $('npTitle').classList.toggle('lnk', !!(t && t.scId));
    $('npArtist').classList.toggle('lnk', !!(t && (t.artistId || t.artistUrl) && !player.error && !player.loading));

    $('shuffleBtn').classList.toggle('on', player.shuffle);
    $('shuffleBtn').title = L(player.shuffle ? 'Shuffle on' : 'Shuffle off');
    $('repeatBtn').classList.toggle('on', player.repeat !== 'off');
    $('repeatBtn').innerHTML = player.repeat === 'one' ? I.repeatOne : I.repeat;
    $('repeatBtn').title = L(REPEAT_TITLES[player.repeat]);

    updateProgress();
    markPlaying();
    syncHero();
  }

  function playAt(index, record = true) {
    if (!player.queue.length) return;
    const target = (index + player.queue.length) % player.queue.length;
    if (record && player.index >= 0 && player.index !== target) {
      player.history.push(player.index);
      if (player.history.length > 100) player.history.shift();
    }
    const changed = player.index !== target;
    player.index = target;
    player.elapsed = 0;
    player.playing = true;
    if (changed || !audio.getAttribute('src')) loadAudio(current());
    else { audio.currentTime = 0; audio.play().catch(() => {}); updatePlayer(); }
    if (changed) notify(current(), false);
  }

  function toggle() {
    if (!current()) return;
    player.playing = !player.playing;
    if (!player.playing) audio.pause();
    else if (audio.getAttribute('src')) audio.play().catch((e) => audioFail(e.message));
    else loadAudio(current());
    updatePlayer();
  }

  function next() {
    if (player.shuffle && player.queue.length > 1) {
      let i;
      do { i = Math.floor(Math.random() * player.queue.length); } while (i === player.index);
      playAt(i);
    } else {
      playAt(player.index + 1);
    }
  }

  function prev() {
    if (player.elapsed > 3) playAt(player.index);                 // сначала перематываем текущий трек в начало
    else if (player.history.length) playAt(player.history.pop(), false);
    else playAt(player.index - 1, false);
  }

  // трек доиграл сам
  function onTrackEnd() {
    if (player.repeat === 'one') { player.elapsed = 0; audio.currentTime = 0; audio.play().catch(() => {}); updatePlayer(); return; }
    if (!settings.autoplay) { player.playing = false; player.elapsed = 0; audio.currentTime = 0; updatePlayer(); return; }
    const isLast = player.index === player.queue.length - 1;
    if (isLast && !player.shuffle && player.repeat === 'off') {
      player.playing = false;
      player.elapsed = 0;
      audio.currentTime = 0;
      updatePlayer();
      return;
    }
    next();
  }

  function playTrack(id) {
    if (current() && current().id === id) return toggle();
    player.queue = visibleTracks.slice();
    player.history = [];
    player.index = -1;   // другой список: номер мог совпасть с прежним, и звук остался бы от старого трека
    playAt(player.queue.findIndex((t) => t.id === id), false);
  }

  /* ---------- Звук ---------- */
  // Настоящее воспроизведение: ссылку на звук отдаёт основной процесс, играет обычный <audio>.
  // Прогресс и конец трека берутся от него же. HLS-треки (редко) играет hls.js, если он установлен.
  const audio = new Audio();
  audio.preload = 'auto';
  let hls = null;
  let hlsLoader = null;
  let loadToken = 0;   // ответ про прежний трек не должен перебить новый выбор

  function stopAudio() {
    if (hls) { hls.destroy(); hls = null; }
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }

  function audioFail(message, auth) {
    player.loading = false;
    player.playing = false;
    player.error = L('Could not play this track: {0}', String(message || ''));
    if (auth) { scForget(); scSchedule(); scRerender(); }
    updatePlayer();
  }

  function loadHlsLib() {
    if (window.Hls) return Promise.resolve();
    if (!hlsLoader) {
      hlsLoader = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = 'node_modules/hls.js/dist/hls.min.js';
        el.onload = resolve;
        el.onerror = () => { hlsLoader = null; reject(new Error('hls.js is not installed (run: npm install hls.js)')); };
        document.head.appendChild(el);
      });
    }
    return hlsLoader;
  }

  async function attachHls(url, token) {
    await loadHlsLib();
    if (token !== loadToken) return;
    if (!window.Hls.isSupported()) throw new Error('HLS is not supported');
    hls = new window.Hls({ enableWorker: false });   // воркер из blob: запрещён политикой безопасности страницы
    hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d && d.fatal && token === loadToken) audioFail(d.details); });
    hls.loadSource(url);
    hls.attachMedia(audio);
  }

  async function loadAudio(t) {
    const token = ++loadToken;
    stopAudio();
    player.error = '';
    player.loading = false;
    const api = scApi();
    if (!t || !t.scId || !api || !api.stream) return;
    player.loading = true;
    updatePlayer();
    let r;
    try { r = await api.stream(t.scId); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (token !== loadToken) return;
    if (!r || !r.ok) return audioFail(r && r.error, r && r.auth);
    try {
      if (r.protocol === 'hls') await attachHls(r.url, token);
      else audio.src = r.url;
    } catch (e) {
      if (token === loadToken) audioFail(e.message);
      return;
    }
    if (token !== loadToken) return;
    player.loading = false;
    if (player.playing) audio.play().catch((e) => { if (token === loadToken) audioFail(e.message); });
    updatePlayer();
  }

  audio.addEventListener('timeupdate', () => {
    if (!player.playing || player.loading) return;
    const sec = Math.floor(audio.currentTime);
    if (sec !== player.elapsed) { player.elapsed = sec; updateProgress(); }
  });
  audio.addEventListener('loadedmetadata', () => {   // настоящая длина важнее той, что пришла в списке (у превью она короче)
    const t = current();
    if (t && Number.isFinite(audio.duration) && audio.duration > 0) { t.dur = Math.round(audio.duration); updateProgress(); }
  });
  audio.addEventListener('ended', () => onTrackEnd());
  audio.addEventListener('error', () => {
    if (audio.getAttribute('src')) audioFail(audio.error ? audio.error.message || 'media error' : 'media error');
  });

  /* ---------- SoundCloud ---------- */
  // Вход и запросы к SoundCloud выполняет основной процесс (soundcloud.js). Сюда приходят только готовые списки.
  const sc = { connected: false, busy: false, loading: false, syncing: false, error: '', user: null, mode: null, sig: '' };
  const SC_CACHE = 'music-player-soundcloud-cache';
  const scApi = () => (window.api && window.api.soundcloud) || null;
  const scErrorText = (e) => String(e || '');

  function scRerender() {
    renderContent();
    markPlaying();
    const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('#modalBody input');
    if (!$('overlay').hidden && ui.section === 'accounts' && !typing) renderBody(true);
  }

  function scForget() {
    sc.connected = false;
    sc.user = null;
    DATA.soundcloud = emptyData();
    rebuildAll();
    try { localStorage.removeItem(SC_CACHE); } catch (e) { /* ничего */ }
  }

  async function scInit() {
    const api = scApi();
    if (!api) return;
    try {
      const st = await api.status();
      sc.connected = !!st.connected;
      sc.mode = st.mode;
    } catch (e) { return; }
    if (!sc.connected) return scRerender();
    try { // сначала показываем сохранённую копию, чтобы приложение не пустовало, пока грузится свежая библиотека
      const cached = JSON.parse(localStorage.getItem(SC_CACHE) || 'null');
      if (cached && Array.isArray(cached.liked) && Array.isArray(cached.recent)) { sc.user = cached.me; applyLibrary(cached); sc.sig = cached.v === 2 ? libSig(cached) : ''; }
    } catch (e) { /* копии нет */ }
    scSchedule();
    scRefresh();
  }

  // подпись только по составу списков: счётчики прослушиваний меняются постоянно и не должны каждый раз перерисовывать экран
  const libSig = (l) => JSON.stringify([l.v, ['recent', 'recommended', 'liked'].map((k) => l[k].map((x) => x.scId)),
    l.playlists.map((p) => [p.scId, p.url, p.name, p.count]), l.following.map((u) => [u.scId, u.url])]);

  // quiet = фоновая синхронизация: без «загрузки» на экране, перерисовка только если в библиотеке что-то изменилось
  async function scRefresh(quiet) {
    const api = scApi();
    if (!api || sc.loading || sc.syncing) return;
    if (quiet) sc.syncing = true;
    else { sc.loading = true; sc.error = ''; scRerender(); }
    let r;
    try { r = await api.library(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    sc.loading = false;
    sc.syncing = false;
    if (r && r.ok) {
      const changed = libSig(r.library) !== sc.sig;
      sc.connected = true;
      sc.user = r.library.me;
      if (changed) { applyLibrary(r.library); sc.sig = libSig(r.library); }
      try { localStorage.setItem(SC_CACHE, JSON.stringify(r.library)); } catch (e) { /* не влезло, не страшно */ }
      if (changed || !quiet) scRerender();
    } else if (r && r.auth) {
      scForget();
      scSchedule();
      sc.error = L('Your SoundCloud session expired. Connect again.');
      scRerender();
    } else if (!quiet) {
      sc.error = L('Could not load the library: {0}', scErrorText(r && r.error));
      scRerender();
    }
  }

  // автосинхронизация: пока приложение открыто, раз в N минут тихо обновляем библиотеку
  let syncTimer = null;
  function scSchedule() {
    clearInterval(syncTimer);
    syncTimer = null;
    if (!settings.autoSync || !sc.connected) return;
    syncTimer = setInterval(() => scRefresh(true), Math.max(1, settings.syncEvery) * 60 * 1000);
  }

  async function scConnect() {
    const api = scApi();
    if (!api || sc.busy) return;
    sc.busy = true;
    sc.error = '';
    scRerender();
    let r;
    try { r = await api.login(); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    sc.busy = false;
    if (r && r.ok) {
      sc.connected = true;
      scSchedule();
      return scRefresh();
    }
    if (r && !r.cancelled) sc.error = L('Sign-in failed: {0}', scErrorText(r.error));
    scRerender();
  }

  async function scDisconnect() {
    const api = scApi();
    if (!api) return;
    try { await api.logout(); } catch (e) { /* ничего */ }
    scForget();
    scSchedule();
    sc.error = '';
    scRerender();
  }

  function scAction(a) {
    if (a === 'connect') scConnect();
    else if (a === 'refresh') scRefresh();
    else if (a === 'disconnect') scDisconnect();
  }

  /* ---------- Страницы: трек, исполнитель, плейлист и альбом ---------- */
  // view = { kind: 'track' | 'artist' | 'playlist', src, id, url }. Данные страницы запрашивает основной процесс
  // (soundcloud.js). Чтобы подключить другую платформу, достаточно добавить её в entityApi с теми же методами.
  const pages = new Map();     // ключ страницы -> { status: 'loading' | 'ok' | 'error', data, error, at }
  let pendingPlay = '';        // страница, которую надо сразу запустить, как только она загрузится (кнопка ▶ на карточке)
  const viewKey = (v) => (v ? `${v.src}:${v.kind}:${v.id || v.url}` : '');
  const entityApi = (src) => (src === 'soundcloud' ? scApi() : null);
  const KIND_LABEL = { track: 'Track', artist: 'Artist', playlist: 'Playlist' };

  function viewTitle() {
    const v = state.view;
    if (!v) return '';
    const pg = pages.get(viewKey(v));
    const title = pg && pg.status === 'ok' ? pg.data.title : L(KIND_LABEL[v.kind]);
    return title.length > 48 ? title.slice(0, 47) + '…' : title;
  }

  function buildPage(kind, d) {
    if (kind === 'track') return { kind, title: d.track.title, track: mapTrack(d.track), related: d.related.map(mapTrack) };
    if (kind === 'artist') {
      return { kind, title: d.artist.name, artist: mapEntity(d.artist), popular: d.popular.map(mapTrack), tracks: d.tracks.map(mapTrack),
               albums: d.albums.map(mapEntity), playlists: d.playlists.map(mapEntity) };
    }
    return { kind, title: d.playlist.name, pl: mapEntity(d.playlist), tracks: d.tracks.map(mapTrack) };
  }

  async function loadPage(v, force) {
    const key = viewKey(v);
    const hit = pages.get(key);
    if (hit && (hit.status === 'loading' || (hit.status === 'ok' && !force && Date.now() - hit.at < 5 * 60 * 1000))) return;
    const api = entityApi(v.src);
    const call = api && { track: api.track, artist: api.user, playlist: api.playlist }[v.kind];
    if (!call) { pages.set(key, { status: 'error', error: L('This page is not available for this platform yet.') }); return; }
    pages.set(key, { status: 'loading' });
    if (pages.size > 60) pages.delete(pages.keys().next().value);
    let r;
    try { r = await call({ id: v.id, url: v.url }); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
    if (r && r.ok) {
      try { pages.set(key, { status: 'ok', data: buildPage(v.kind, r.data), at: Date.now() }); }
      catch (e) { pages.set(key, { status: 'error', error: String((e && e.message) || e) }); }
    } else {
      pages.set(key, { status: 'error', error: String((r && r.error) || 'Unknown error') });
      if (r && r.auth) { scForget(); scSchedule(); sc.error = L('Your SoundCloud session expired. Connect again.'); }
    }
    if (viewKey(state.view) === key) { renderTitlebar(); scRerender(); }
  }

  /* --- мелкие кирпичи страниц --- */
  const fmtNum = (n) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0);
  const fmtLong = (s) => {
    const min = Math.max(1, Math.round(s / 60));
    return min >= 60 ? `${Math.floor(min / 60)} ${L('h')} ${min % 60} ${L('min')}` : `${min} ${L('min')}`;
  };
  const yearOf = (s) => { const y = new Date(s).getFullYear(); return y > 1990 ? String(y) : ''; };

  // что открыть по клику: адрес и номер лежат в самом элементе
  const refAttrs = (src, id, url) => `data-src="${esc(src || 'soundcloud')}" data-id="${Number(id) || 0}" data-url="${esc(url || '')}"`;
  const titleLink = (t) => (t.scId
    ? `<span class="t-text lnk" data-open="track" ${refAttrs(t.source, t.scId, t.url)}>${esc(t.title)}</span>`
    : `<span class="t-text">${esc(t.title)}</span>`);
  // и у трека, и у плейлиста исполнитель лежит в полях artist / artistId / artistUrl
  const artistLink = (x) => (!x.artist ? '' : x.artistId || x.artistUrl
    ? `<span class="lnk" data-open="artist" ${refAttrs(x.source, x.artistId, x.artistUrl)}>${esc(x.artist)}</span>`
    : esc(x.artist));

  function playlistCard(pl) {
    const sub = [state.platform === 'all' ? platform(pl.source).name : '', pl.isAlbum ? L('Album') : '', L('{0} tr.', pl.count)].filter(Boolean).join(', ');
    return `
      <div class="card" data-open="playlist" ${refAttrs(pl.source, pl.scId, pl.url)}>
        <div class="cover" style="background:${esc(coverBg(pl.name, pl.art))}"><span class="fab">${I.play}</span></div>
        <div class="card-title"><span class="t-text">${esc(pl.name)}</span></div>
        <div class="card-sub">${esc(sub)}</div>
      </div>`;
  }

  const userCard = (u) => `
      <div class="card artist" data-open="artist" ${refAttrs(u.source, u.scId, u.url)}>
        <div class="cover" style="background:${esc(coverBg(u.name, u.art))}"></div>
        <div class="card-title"><span class="t-text">${esc(u.name)}</span></div>
        ${u.followers ? `<div class="card-sub">${esc(L('{0} followers', fmtNum(u.followers)))}</div>` : ''}
      </div>`;

  const sectionHtml = (title, body) => `<div class="section"><div class="section-title">${esc(title)}</div>${body}</div>`;
  const aboutHtml = (desc) => (desc ? sectionHtml(L('About'), `<div class="about">${esc(desc)}</div>`) : '');
  const actBtn = (act, icon, text, primary) => `<button class="btn ic ${primary ? 'primary' : ''}" data-act="${act}">${icon}<span>${esc(text)}</span></button>`;
  const moreBtn = (sect, shown, total) => (total > shown ? `<div class="more-row"><button class="btn" data-act="more" data-sect="${sect}">${esc(L('Show more'))}</button></div>` : '');
  const grid = (cards) => `<div class="grid">${cards}</div>`;

  function heroHtml(h) {
    return `
      <div class="hero">
        <div class="hero-cover ${h.round ? 'round' : ''}" style="background:${esc(coverBg(h.title, h.cover))}"></div>
        <div class="hero-meta">
          <div class="hero-kind">${esc(h.kind)}</div>
          <div class="hero-title">${esc(h.title)}</div>
          ${h.sub ? `<div class="hero-sub">${h.sub}</div>` : ''}
          ${h.stats ? `<div class="hero-stats">${esc(h.stats)}</div>` : ''}
          <div class="btn-row hero-actions">${h.actions}</div>
        </div>
      </div>`;
  }

  // кнопка «Играть» в шапке показывает паузу, пока играет трек с этой страницы
  function syncHero() {
    const btn = document.querySelector('#content [data-act="play"]');
    if (!btn) return;
    const on = player.playing && !!current() && visibleTracks.some((x) => x.id === current().id);
    btn.innerHTML = (on ? I.pause : I.play) + `<span>${esc(L(on ? 'Pause' : 'Play'))}</span>`;
  }

  const playShuffle = (shuffle) => actBtn('play', I.play, L('Play'), true) + (shuffle ? actBtn('shuffle', I.shuffle, L('Shuffle')) : '');
  const extBtn = (src) => actBtn('ext', I.globe, L('Open on {0}', platform(src).name));

  function trackPageHtml(d) {
    const t = d.track;
    visibleTracks = [t, ...d.related.filter((x) => x.id !== t.id)];
    const liked = player.liked.has(t.id);
    const stats = [
      t.plays ? L('{0} plays', fmtNum(t.plays)) : '', t.likes ? L('{0} likes', fmtNum(t.likes)) : '',
      t.reposts ? L('{0} reposts', fmtNum(t.reposts)) : '', t.comments ? L('{0} comments', fmtNum(t.comments)) : '',
      t.dur ? fmt(t.dur) : '',
    ].filter(Boolean).join(' · ');
    const artistBtn = t.artistId || t.artistUrl
      ? `<button class="btn ic" data-open="artist" ${refAttrs(t.source, t.artistId, t.artistUrl)}>${I.person}<span>${esc(L('Artist page'))}</span></button>` : '';
    return heroHtml({
      kind: L('Track'), cover: t.artBig || t.art, title: t.title,
      sub: [artistLink(t), t.genre && esc(t.genre), yearOf(t.date)].filter(Boolean).join(' · '),
      stats,
      actions: playShuffle(false) + actBtn('like', liked ? I.heartFill : I.heart, L(liked ? 'Liked' : 'Like')) + artistBtn + extBtn(t.source),
    })
      + aboutHtml(t.desc)
      + (t.tags && t.tags.length ? sectionHtml(L('Tags'), `<div class="chips">${t.tags.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>`) : '')
      + (d.related.length ? sectionHtml(L('Related tracks'), trackList(d.related)) : '');
  }

  function artistPageHtml(d) {
    const a = d.artist;
    const seen = new Set();
    visibleTracks = [...d.popular, ...d.tracks].filter((x) => !seen.has(x.id) && seen.add(x.id));
    const popN = state.expanded.has('popular') ? 10 : 5;
    const latN = state.expanded.has('latest') ? d.tracks.length : 10;
    return heroHtml({
      kind: L('Artist'), cover: a.artBig || a.art, round: true, title: a.name,
      sub: [a.city, a.country].filter(Boolean).map(esc).join(', '),
      stats: [a.followers ? L('{0} followers', fmtNum(a.followers)) : '', a.trackCount ? L('{0} tr.', a.trackCount) : ''].filter(Boolean).join(' · '),
      actions: playShuffle(true) + extBtn(a.source),
    })
      + aboutHtml(a.desc)
      + (d.popular.length ? sectionHtml(L('Popular'), trackList(d.popular.slice(0, popN)) + moreBtn('popular', popN, d.popular.length)) : '')
      + (d.tracks.length ? sectionHtml(L('Tracks'), trackList(d.tracks.slice(0, latN)) + moreBtn('latest', latN, d.tracks.length)) : '')
      + (d.albums.length ? sectionHtml(L('Albums'), grid(d.albums.map(playlistCard).join(''))) : '')
      + (d.playlists.length ? sectionHtml(L('Playlists'), grid(d.playlists.map(playlistCard).join(''))) : '')
      + (d.popular.length || d.tracks.length || d.albums.length || d.playlists.length ? '' : emptyHtml());
  }

  function playlistPageHtml(d) {
    const p = d.pl;
    visibleTracks = d.tracks;
    const total = p.totalDur || d.tracks.reduce((s, x) => s + (x.dur || 0), 0);
    return heroHtml({
      kind: L(p.isAlbum ? 'Album' : 'Playlist'), cover: p.artBig || p.art, title: p.name,
      sub: [artistLink(p), p.isAlbum && yearOf(p.date)].filter(Boolean).join(' · '),
      stats: [L('{0} tr.', d.tracks.length || p.count), total ? fmtLong(total) : ''].filter(Boolean).join(' · '),
      actions: playShuffle(true) + extBtn(p.source),
    })
      + aboutHtml(p.desc)
      + sectionHtml(L('Tracks'), d.tracks.length ? trackList(d.tracks) : emptyHtml());
  }

  function renderPage(el) {
    const v = state.view;
    const key = viewKey(v);
    let pg = pages.get(key);
    if (!pg) { loadPage(v); pg = pages.get(key); }
    visibleTracks = [];
    if (!pg || pg.status === 'loading') { el.innerHTML = `<div class="empty">${L('Loading…')}</div>`; return; }
    if (pg.status === 'error') {
      el.innerHTML = `<div class="notice"><p><b>${L('Could not open this page')}</b>${esc(pg.error)}</p>
        <div class="btn-row"><button class="btn" data-act="retry">${L('Try again')}</button></div></div>`;
      return;
    }
    const d = pg.data;
    el.innerHTML = d.kind === 'track' ? trackPageHtml(d) : d.kind === 'artist' ? artistPageHtml(d) : playlistPageHtml(d);
    syncHero();
    if (pendingPlay === key) { pendingPlay = ''; playAll(false); }
  }

  /* ---------- Поиск по сервису (кроме треков из вашей библиотеки) ---------- */
  const remoteSearch = { q: '', status: 'idle', data: null, error: '', cache: new Map(), timer: null };
  const mapSearch = (d) => ({ tracks: d.tracks.map(mapTrack), users: d.users.map(mapEntity), playlists: d.playlists.map(mapEntity), albums: d.albums.map(mapEntity) });

  function scheduleSearch() {
    clearTimeout(remoteSearch.timer);
    const q = state.query;
    const api = scApi();
    if (q.length < 2 || !sc.connected || !api || !api.search) { remoteSearch.q = ''; return; }
    remoteSearch.q = q;
    if (remoteSearch.cache.has(q)) { remoteSearch.status = 'ok'; remoteSearch.data = remoteSearch.cache.get(q); return; }
    remoteSearch.status = 'loading';
    remoteSearch.data = null;
    remoteSearch.timer = setTimeout(async () => {
      let r;
      try { r = await api.search(q); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
      if (remoteSearch.q !== q) return;
      if (r && r.ok) {
        remoteSearch.data = mapSearch(r.data);
        remoteSearch.status = 'ok';
        remoteSearch.cache.set(q, remoteSearch.data);
        if (remoteSearch.cache.size > 30) remoteSearch.cache.delete(remoteSearch.cache.keys().next().value);
      } else {
        remoteSearch.status = 'error';
        remoteSearch.error = String((r && r.error) || 'Unknown error');
        if (r && r.auth) { scForget(); scSchedule(); sc.error = L('Your SoundCloud session expired. Connect again.'); }
      }
      if (state.query === q) scRerender();
    }, 450);
  }

  function renderSearch(el, data, q) {
    const seen = new Set();
    const local = [...data.liked, ...data.recent, ...data.recommended]
      .filter((t) => !seen.has(t.id) && seen.add(t.id))
      .filter((t) => (t.title + ' ' + t.artist).toLowerCase().includes(q));
    const rs = remoteSearch.q === q ? remoteSearch : null;
    const d = rs && rs.status === 'ok' ? rs.data : null;
    const localIds = new Set(local.map((t) => t.id));
    const fresh = d ? d.tracks.filter((t) => !localIds.has(t.id)) : [];
    visibleTracks = local.concat(fresh);
    let html = '';
    if (local.length) html += sectionHtml(L(rs ? 'In your library' : 'Search results'), trackList(local));
    if (rs && rs.status === 'loading') html += `<div class="empty small">${esc(L('Searching…'))}</div>`;
    else if (rs && rs.status === 'error') html += `<div class="notice"><p><b>${L('Search failed')}</b>${esc(rs.error)}</p></div>`;
    else if (d) {
      if (fresh.length) html += sectionHtml(L('Tracks'), trackList(fresh));
      if (d.users.length) html += sectionHtml(L('Artists'), grid(d.users.map(userCard).join('')));
      if (d.albums.length) html += sectionHtml(L('Albums'), grid(d.albums.map(playlistCard).join('')));
      if (d.playlists.length) html += sectionHtml(L('Playlists'), grid(d.playlists.map(playlistCard).join('')));
    }
    el.innerHTML = html || `<div class="section"><div class="section-title">${L('Search results')}</div><div class="empty">${L('Nothing found. Try another title or artist.')}</div></div>`;
  }

  /* ---------- Открытие страниц и кнопки на них ---------- */
  function openEntity(kind, ref, opts, platformId) {
    const id = Math.floor(Number(ref.id)) || 0;
    const url = ref.url || '';
    if (!id && !url) return;
    const view = { kind, src: ref.src || 'soundcloud', id, url };
    const key = viewKey(view);
    pendingPlay = opts && opts.autoplay ? key : '';
    const plat = platformId || state.platform;
    if (!go(plat, state.tabs[plat], view) && pendingPlay) renderContent();   // страница уже открыта: просто запускаем
  }

  function playAll(shuffle) {
    if (!visibleTracks.length) return;
    if (!shuffle && current() && visibleTracks.some((x) => x.id === current().id)) return toggle();
    player.queue = visibleTracks.slice();
    player.history = [];
    player.index = -1;
    if (shuffle) player.shuffle = true;
    playAt(shuffle ? Math.floor(Math.random() * player.queue.length) : 0, false);
  }

  function pageAction(btn) {
    const a = btn.dataset.act;
    const pg = state.view ? pages.get(viewKey(state.view)) : null;
    const d = pg && pg.status === 'ok' ? pg.data : null;
    if (a === 'play') playAll(false);
    else if (a === 'shuffle') playAll(true);
    else if (a === 'more') { state.expanded.add(btn.dataset.sect); renderContent(); }
    else if (a === 'retry') { pages.delete(viewKey(state.view)); renderContent(); }
    else if (a === 'like' && d && d.track) {
      if (player.liked.has(d.track.id)) player.liked.delete(d.track.id); else player.liked.add(d.track.id);
      updatePlayer();
      renderContent();
    } else if (a === 'ext' && d) {
      const api = scApi();
      const url = (d.track || d.artist || d.pl || {}).url;
      if (api && api.openLink && url) api.openLink(url);
    }
  }

  /* ---------- События ---------- */
  $('rail').addEventListener('click', (e) => {
    const btn = e.target.closest('.rail-btn');
    if (!btn) return;
    if (btn.dataset.settings !== undefined) return openSettings();
    const id = btn.dataset.platform;
    go(id, state.tabs[id]); // раздел берётся тот, что был выбран именно в этой платформе
  });

  $('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) go(state.platform, tab.dataset.tab);
  });

  $('tbBack').addEventListener('click', () => stepHistory(-1));
  $('tbForward').addEventListener('click', () => stepHistory(1));

  $('searchInput').addEventListener('input', (e) => {
    state.query = e.target.value.trim().toLowerCase();
    scheduleSearch();
    renderContent();
  });

  $('content').addEventListener('click', (e) => {
    const scBtn = e.target.closest('[data-sc]');
    if (scBtn) return scAction(scBtn.dataset.sc);
    const act = e.target.closest('[data-act]');
    if (act) return pageAction(act);
    // ссылки на страницы (название, исполнитель, карточки плейлистов и исполнителей) перехватывают клик раньше, чем строка трека
    const open = e.target.closest('[data-open]');
    if (open) return openEntity(open.dataset.open, { src: open.dataset.src, id: open.dataset.id, url: open.dataset.url }, { autoplay: !!e.target.closest('.fab') });
    const row = e.target.closest('[data-track]');
    if (row) playTrack(Number(row.dataset.track));
  });

  // название, обложка и исполнитель в нижнем плеере открывают страницу играющего трека
  const npPlatform = (t) => (DATA[state.platform].connected ? state.platform : t.source);
  const openNowPlaying = () => {
    const t = current();
    if (t && t.scId) openEntity('track', { src: t.source, id: t.scId, url: t.url }, null, npPlatform(t));
  };
  $('npTitle').addEventListener('click', openNowPlaying);
  $('npCover').addEventListener('click', openNowPlaying);
  $('npArtist').addEventListener('click', () => {
    const t = current();
    if (t && (t.artistId || t.artistUrl) && !player.error && !player.loading) openEntity('artist', { src: t.source, id: t.artistId, url: t.artistUrl }, null, npPlatform(t));
  });

  // настройки
  $('closeBtn').addEventListener('click', closeSettings);
  $('overlay').addEventListener('mousedown', (e) => { if (e.target === $('overlay')) closeSettings(); });

  $('navTree').addEventListener('click', (e) => {
    const b = e.target.closest('[data-section]');
    if (!b) return;
    // подраздел той же страницы: страницу не перерисовываем, прокручиваем плавно с текущего места
    if (b.dataset.sub && b.dataset.section === ui.section && !ui.search) {
      ui.sub = b.dataset.sub;
      document.querySelectorAll('.nav-sub').forEach((x) => x.classList.toggle('active', x.dataset.sub === ui.sub));
      scrollToSub(ui.sub);
      return;
    }
    openSection(b.dataset.section, b.dataset.sub);
  });

  $('settingsSearch').addEventListener('input', (e) => {
    ui.search = e.target.value.trim();
    renderNav();
    renderBody(false);
  });

  $('modalBody').addEventListener('scroll', updateSpy);

  // масштаб применяем по отпусканию ползунка: если менять его на лету, ползунок «убегает» из-под курсора
  $('modalBody').addEventListener('change', (e) => {
    if (e.target.id !== 'scaleRange') return;
    settings.uiScale = Number(e.target.value);
    saveSettings();
    applyScale();
    renderBody(true);
  });

  $('modalBody').addEventListener('click', (e) => {
    const t = e.target;
    const result = t.closest('[data-goto]');
    if (result) return gotoSetting(result.dataset.goto);

    const stop = t.closest('[data-theme-step]');
    if (stop) { // клик по названию темы двигает ползунок
      const range = $('themeRange');
      range.value = stop.dataset.themeStep;
      range.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const sw = t.closest('[data-toggle]');
    if (sw) {
      const key = sw.dataset.toggle;
      if (!key || sw.disabled) return;
      settings[key] = !settings[key];
      saveSettings();
      sw.classList.toggle('on', settings[key]);
      sw.setAttribute('aria-checked', String(settings[key]));
      if (key === 'outlineIcons') applyTheme();
      if (key === 'autoSync') scSchedule();
      if (key === 'notifyTrack' && settings.notifyTrack && window.Notification && Notification.permission === 'default') Notification.requestPermission();
      return;
    }

    const posBtn = t.closest('[data-wp-pos]');
    if (posBtn) {
      settings.wpPos = posBtn.dataset.wpPos;
      saveSettings();
      applyTheme();
      $$('.pos').forEach((b) => b.classList.toggle('sel', b.dataset.wpPos === settings.wpPos));
      return;
    }

    const op = t.closest('[data-open]');
    if (op) return openSupportLink((supportCfg.links[Number(op.dataset.open)] || {}).url);

    const scBtn = t.closest('[data-sc]');
    if (scBtn) return scAction(scBtn.dataset.sc);

    const act = t.closest('[data-action]');
    if (act) return runAction(act);

    const tintBtn = t.closest('[data-tint]');
    const textBtn = t.closest('[data-text]');
    const modeBtn = t.closest('[data-source-mode]');
    const patBtn = t.closest('[data-pattern]');
    const bgBtn = t.closest('[data-bg]');
    const olBtn = t.closest('[data-outline]');
    const olsBtn = t.closest('[data-ol-style]');
    if (tintBtn) settings.tint = tintBtn.dataset.tint === 'none' ? null : tintBtn.dataset.tint;
    else if (textBtn) settings.textColor = textBtn.dataset.text;
    else if (modeBtn) settings.sourceMode = modeBtn.dataset.sourceMode;
    else if (patBtn) settings.pattern = patBtn.dataset.pattern;
    else if (bgBtn) settings.bgColor = bgBtn.dataset.bg;
    else if (olBtn) settings.outlineColor = olBtn.dataset.outline;
    else if (olsBtn) settings.outlineStyle = olsBtn.dataset.olStyle;
    else return;
    saveSettings();
    applyTheme();
    renderBody(true);
    renderContent();
    updatePlayer();
  });

  $('modalBody').addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'themeRange') settings.theme = THEME_ORDER[Number(e.target.value)];
    else if (id === 'satRange') settings.sat = Number(e.target.value);
    else if (id === 'textSatRange') settings.textSat = Number(e.target.value);
    else if (id === 'fsRange') {
      settings.fontSize = Number(e.target.value);
      saveSettings();
      applyTheme();
      $('fsVal').textContent = settings.fontSize + ' px';
      return;
    } else if (e.target.dataset.set) { // ползунки: размытие обоев, стекло, прозрачность элементов
      const key = e.target.dataset.set;
      settings[key] = Number(e.target.value);
      saveSettings();
      applyTheme();
      setFill(e.target);
      $('val-' + key).textContent = settings[key] + (e.target.dataset.unit || '');
      if (key === 'bgSat') refreshColors();
      return;
    } else if (id === 'wpFit') {
      settings.wpFit = e.target.value;
      saveSettings();
      applyTheme();
      $('posGrid').classList.toggle('off', settings.wpFit === 'stretch');
      return;
    } else if (id === 'patRange') {
      settings.patternAlpha = Number(e.target.value);
      saveSettings();
      applyTheme();
      $('patVal').textContent = settings.patternAlpha + '%';
      return;
    } else if (id === 'fontSelect') {
      settings.font = e.target.value;
      saveSettings();
      applyTheme();
      return;
    } else if (id === 'syncSelect') {
      settings.syncEvery = Number(e.target.value);
      saveSettings();
      scSchedule();
      return;
    } else if (id === 'langSelect') {
      settings.lang = e.target.value;
      saveSettings();
      setLanguage(settings.lang);
      refreshLanguage();
      return;
    } else if (id === 'scaleRange') {
      $('scaleVal').textContent = e.target.value + '%';   // сам масштаб применяется, когда ползунок отпущен
      return;
    } else return;
    saveSettings();
    refreshColors();
  });

  // плеер
  $('playBtn').addEventListener('click', toggle);
  $('nextBtn').addEventListener('click', next);
  $('prevBtn').addEventListener('click', prev);

  $('shuffleBtn').addEventListener('click', () => { player.shuffle = !player.shuffle; updatePlayer(); });
  $('repeatBtn').addEventListener('click', () => {
    player.repeat = player.repeat === 'off' ? 'all' : player.repeat === 'all' ? 'one' : 'off';
    updatePlayer();
  });

  $('likeBtn').addEventListener('click', () => {
    const t = current();
    if (!t) return;
    if (player.liked.has(t.id)) player.liked.delete(t.id);
    else player.liked.add(t.id);
    updatePlayer();
  });

  $('seek').addEventListener('input', (e) => {
    player.elapsed = Number(e.target.value);
    audio.currentTime = player.elapsed;
    updateProgress();
  });
  $('vol').addEventListener('input', (e) => { setFill(e.target); settings.volume = Number(e.target.value); audio.volume = settings.volume / 100; saveSettings(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('overlay').hidden) {
      if (ui.search) { ui.search = ''; $('settingsSearch').value = ''; renderNav(); renderBody(false); return; }
      return closeSettings();
    }
    if ($('overlay').hidden && e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); return stepHistory(-1); }
    if ($('overlay').hidden && e.altKey && e.key === 'ArrowRight') { e.preventDefault(); return stepHistory(1); }
    if (e.code === 'Space' && !$('overlay').hidden) return;
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      if (e.target.blur) e.target.blur(); // чтобы пробел не «нажимал» кнопку, на которой стоит фокус
      toggle();
    }
  });

  // боковые кнопки мыши (назад / вперёд), как в Discord
  document.addEventListener('mouseup', (e) => {
    if (!$('overlay').hidden) return;
    if (e.button === 3) stepHistory(-1);
    if (e.button === 4) stepHistory(1);
  });

  /* ---------- Свои кнопки окна ---------- */
  let winMaxed = false;
  function labelWindowButtons() {
    if (!$('wcMin')) return;
    const maxText = L(winMaxed ? 'Restore down' : 'Maximize');
    [['wcMin', L('Minimize')], ['wcMax', maxText], ['wcClose', L('Close')]].forEach(([id, text]) => {
      $(id).title = text;
      $(id).setAttribute('aria-label', text);
    });
  }

  function renderWindowControls() {
    const api = window.api;
    if (!api || !api.window || api.platform === 'darwin') return; // на macOS остаются системные кнопки
    const w = api.window;
    $('winControls').innerHTML = `
      <button class="wc-btn" id="wcMin">${I.winMin}</button>
      <button class="wc-btn" id="wcMax">${I.winMax}</button>
      <button class="wc-btn wc-close" id="wcClose">${I.winClose}</button>`;
    $('wcMin').addEventListener('click', () => w.minimize());
    $('wcMax').addEventListener('click', () => w.toggleMaximize());
    $('wcClose').addEventListener('click', () => w.close());
    const setMax = (isMax) => {
      winMaxed = !!isMax;
      $('wcMax').innerHTML = isMax ? I.winRestore : I.winMax;
      labelWindowButtons();
    };
    labelWindowButtons();
    Promise.resolve(w.isMaximized()).then(setMax).catch(() => {});
    w.onMaximizeChange(setMax);
  }

  /* ---------- Старт ---------- */
  document.querySelector('.scroller').addEventListener('scroll', (e) => {
    document.querySelector('.main').classList.toggle('scrolled', e.target.scrollTop > 2);
  });
  window.addEventListener('resize', () => { schedulePosition(); if (wallpaperSig() !== wp.sig) scheduleWallpaper(250); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedulePosition);
  if (window.api && window.api.platform) document.documentElement.classList.add(window.api.platform);
  $('tbBack').innerHTML = I.arrowLeft;
  $('tbForward').innerHTML = I.arrowRight;
  $('searchIcon').innerHTML = I.search;
  $('navSearchIcon').innerHTML = I.search;
  $('volIcon').innerHTML = I.volume;
  $('prevBtn').innerHTML = I.prev;
  $('nextBtn').innerHTML = I.next;
  $('shuffleBtn').innerHTML = I.shuffle;
  $('likeBtn').innerHTML = I.heart;
  $('closeBtn').innerHTML = I.close;
  $('playBtn').innerHTML = I.play;
  if (settings.rememberVolume) $('vol').value = settings.volume;
  setFill($('vol'));
  audio.volume = Number($('vol').value) / 100;
  collectStatic();
  applyScale();
  // сначала подгружаем языки, потом рисуем интерфейс: так при запуске не мелькает русский текст
  const boot = () => { renderWindowControls(); renderAll(); updatePlayer(); };
  loadLocales().then(boot, boot);
  scInit();
  if (window.api && window.api.appInfo) Promise.resolve(window.api.appInfo()).then((i) => { info = i || {}; }).catch(() => {});
  if (window.api && window.api.getWallpaper) {
    Promise.resolve(window.api.getWallpaper()).then((w) => { wallpaper = w || null; wp.bitmap = null; applyTheme(); }).catch(() => {});
  }
  if (window.api && window.api.supportConfig) Promise.resolve(window.api.supportConfig()).then((c) => { if (c) supportCfg = c; }).catch(() => {});
  // шрифты из папки fonts подгружаются после запуска и сразу применяются
  loadFonts().then(() => {
    applyTheme();
    if (!$('overlay').hidden && ui.section === 'appearance') renderBody(true);
  });
})();
