(() => {
  const $ = (id) => document.getElementById(id);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const I = window.ICONS;

  /* ---------- Язык интерфейса ---------- */
  // Русский встроен: русские фразы в коде служат ключами. Другие языки — файлы .json в папке locales:
  // { "name": "English", "code": "en", "strings": { "русская фраза": "перевод" } }. Фраза без перевода остаётся русской.
  const lang = { code: 'ru', strings: {}, list: [] };
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
    lang.code = l ? l.code : 'ru';
    lang.strings = l ? l.strings : {};
    document.documentElement.lang = lang.code;
    localize();
  }
  async function loadLocales() {
    let list = [];
    try { if (window.api && window.api.listLocales) list = await window.api.listLocales(); } catch (e) { list = []; }
    const seen = new Set(['ru']);
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
    { id: 'all',        name: 'Все треки',     accent: '#9b8cff', bg: 'linear-gradient(135deg,#7a5cff,#c45cff)', fg: '#ffffff', icon: 'all',
      tabs: ['home', 'liked', 'playlists'] },
    { id: 'soundcloud', name: 'SoundCloud',    accent: '#ff5500', bg: '#ff5500', fg: '#ffffff', icon: 'soundcloud', pastel: '#ffb38a', deep: '#d4601c',
      tabs: ['home', 'liked', 'playlists', 'following'] },
    { id: 'vk',         name: 'VK Музыка',     accent: '#2787f5', bg: '#0077ff', fg: '#ffffff', icon: 'vk', pastel: '#9cc7ff', deep: '#2f7be0',
      tabs: ['home', 'liked', 'playlists', 'following'] },
    { id: 'ytmusic',    name: 'YouTube Music', accent: '#ff3d3d', bg: '#e00000', fg: '#ffffff', icon: 'ytmusic', pastel: '#ff9c9c', deep: '#d93a3a',
      tabs: ['home', 'liked', 'playlists', 'following'] },
    { id: 'yandex',     name: 'Яндекс Музыка', accent: '#ffcc00', bg: '#ffcc00', fg: '#14141a', icon: 'yandex', pastel: '#ffe58a', deep: '#b8900a',
      tabs: ['home', 'liked', 'playlists', 'following'] },
  ];
  const TAB_NAMES = { home: 'Главная', liked: 'Понравившиеся', playlists: 'Плейлисты', following: 'Подписки' };
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
    light: { name: 'Светлая',
      rail: '#eceef2', main: '#fafafc', panel: '#f0f1f5', hover: '#e4e6ec', line: '#dcdee5', text: '#1a1a21', muted: '#6a6a77',
      k: { rail: .28, main: .10, panel: .22, hover: .30, line: .34 } },
    gray: { name: 'Серая',
      rail: '#c9cacf', main: '#e3e4e8', panel: '#d5d6db', hover: '#c8c9cf', line: '#b9bac1', text: '#1c1c22', muted: '#5a5a66',
      k: { rail: .24, main: .20, panel: .24, hover: .30, line: .32 } },
    ash: { name: 'Пепельная',            // фон ровно #a7a7a7
      rail: '#8c8c8c', main: '#a7a7a7', panel: '#9d9d9d', hover: '#929292', line: '#7f7f7f', text: '#141414', muted: '#323232',
      k: { rail: .20, main: .20, panel: .20, hover: .22, line: .24 } },
    graphite: { name: 'Графитовая', dark: true, lift: .3,   // фон #5a5a5a
      rail: '#484848', main: '#5a5a5a', panel: '#666666', hover: '#727272', line: '#808080', text: '#f5f5f5', muted: '#dcdcdc',
      k: { rail: .16, main: .16, panel: .18, hover: .20, line: .22 } },
    dark: { name: 'Тёмная', dark: true, lift: 0,
      rail: fromGray(.13), main: fromGray(.18), panel: fromGray(.23), hover: fromGray(.29), line: fromGray(.37), text: '#f2f2f2', muted: GRAY,
      k: { rail: .08, main: .09, panel: .13, hover: .18, line: .20 } },
    black: { name: 'Чёрная', dark: true, lift: 0,   // настоящий чёрный: фон #000000
      rail: '#000000', main: '#000000', panel: '#0b0b0b', hover: '#171717', line: '#2b2b2b', text: '#f0f0f0', muted: '#9a9a9a',
      k: { rail: .05, main: .05, panel: .08, hover: .12, line: .14 } },
  };
  const THEME_ORDER = ['light', 'gray', 'ash', 'graphite', 'dark', 'black'];
  const SURFACES = ['rail', 'main', 'panel', 'hover', 'line'];

  /* ---------- Цвета: 20 насыщенных оттенков с шагом 18° по кругу ---------- */
  const TINT_NAMES = ['Коралл', 'Персик', 'Абрикос', 'Лимон', 'Лайм', 'Фисташка', 'Салат', 'Мята', 'Морская пена', 'Аквамарин',
                      'Бирюза', 'Небо', 'Лазурь', 'Василёк', 'Барвинок', 'Лаванда', 'Орхидея', 'Фуксия', 'Жвачка', 'Роза'];
  // у жёлто-зелёных оттенков при той же яркости цвет кажется светлее, у синих темнее, поэтому L разная
  const tintL = (h) => (h >= 36 && h <= 180 ? 50 : h > 180 && h <= 260 ? 58 : 54);   // при насыщенности 100% цвета чистые и яркие
  const TINTS = TINT_NAMES.map((name, i) => ({ id: 'c' + i, name, h: i * 18, l: tintL(i * 18) }));
  const TEXT_FIXED = { white: { name: 'Белый', hex: '#ffffff' }, black: { name: 'Чёрный', hex: '#000000' } };

  /* ---------- Узоры на панелях (боковая панель, бар окна, плеер) ---------- */
  // каждый узор — маленькая SVG-плитка, цвет берётся из цвета текста темы
  const PATTERNS = {
    none:    { name: 'Без узора' },
    dots:    { name: 'Точки', size: 8,  tile: (c, a) => `<circle cx='4' cy='4' r='1' fill='${c}' fill-opacity='${a}'/>` },
    polka:   { name: 'Крупные точки', size: 16, tile: (c, a) => `<circle cx='8' cy='8' r='2.2' fill='${c}' fill-opacity='${a}'/>` },
    grid:    { name: 'Сетка', size: 12, tile: (c, a) => `<path d='M0 .5H12M.5 0V12' fill='none' stroke='${c}' stroke-opacity='${a}'/>` },
    crosses: { name: 'Крестики', size: 16, tile: (c, a) => `<path d='M8 5v6M5 8h6' fill='none' stroke='${c}' stroke-opacity='${a}'/>` },
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
    stretch: { name: 'Растянуть на весь размер (с деформацией)', size: '100% 100%', repeat: 'no-repeat' },
    contain: { name: 'Вписать целиком (без деформации)',         size: 'contain',   repeat: 'no-repeat' },
    cover:   { name: 'Заполнить до краёв (с обрезкой)',          size: 'cover',     repeat: 'no-repeat' },
    center:  { name: 'Оригинальный размер',                      size: 'auto',      repeat: 'no-repeat' },
    tile:    { name: 'Плиткой',                                  size: 'auto',      repeat: 'repeat' },
  };
  // 3 x 3: углы, края и центр
  const WP_POS = {
    tl: ['left top', 'Левый верхний угол'],   t: ['center top', 'Верхний край'],     tr: ['right top', 'Правый верхний угол'],
    l:  ['left center', 'Левый край'],        c: ['center center', 'По центру'],     r:  ['right center', 'Правый край'],
    bl: ['left bottom', 'Левый нижний угол'], b: ['center bottom', 'Нижний край'],   br: ['right bottom', 'Правый нижний угол'],
  };
  // элементы интерфейса, у которых есть свой ползунок прозрачности
  const OPACITY = [
    ['aTitle', 'Бар окна'], ['aRail', 'Боковая панель'], ['aMain', 'Фон окна и верхняя панель'],
    ['aCanvas', 'Основное полотно'], ['aCards', 'Карточки и строки'], ['aControls', 'Кнопки, поля и заголовки'],
    ['aPlayer', 'Нижний плеер'], ['aModal', 'Окно настроек'], ['aLines', 'Линии и рамки'],
  ];

  const SOURCE_MODES = {
    icon:  { name: 'Значок слева',      hint: 'Значок перед обложкой.' },
    title: { name: 'Значок у названия', hint: 'Маленький значок перед названием.' },
    label: { name: 'Подпись справа',    hint: 'Название платформы справа.' },
  };

  /* ---------- Настройки (сохраняются между запусками) ---------- */
  const STORE_KEY = 'music-player-settings';
  // tint — цвет оформления (null = без цвета); textColor — 'auto' | 'white' | 'black' | id оттенка
  const DEFAULTS = {
    theme: 'dark', tint: null, sat: 80, textColor: 'auto', textSat: 70, sourceMode: 'icon',
    font: 'auto', fontSize: 14, pattern: 'dots', patternAlpha: 70, lang: 'ru', uiScale: 100,
    aTitle: 100, aRail: 100, aMain: 100, aCanvas: 100, aCards: 100, aControls: 100, aPlayer: 100, aModal: 100, aLines: 100,
    glassBlur: 10, wpFit: 'cover', wpPos: 'c', wpBlur: 0, textOutline: 50,
    bgColor: 'auto', bgSat: 60, outlineColor: 'auto', outlineIcons: true, outlineStyle: 'soft',
    notifyTrack: false, notifyUnfocused: true, notifySilent: false,
    autoplay: true, rememberVolume: true, volume: 70,
  };
  const BOOLS = ['notifyTrack', 'notifyUnfocused', 'notifySilent', 'autoplay', 'rememberVolume', 'outlineIcons'];
  // числовые настройки и их допустимые границы
  const NUMS = { aTitle: [0, 100], aRail: [0, 100], aMain: [0, 100], aCanvas: [0, 100], aCards: [0, 100],
                 aPlayer: [0, 100], aModal: [0, 100], aControls: [0, 100], aLines: [0, 100], glassBlur: [0, 24], wpBlur: [0, 40], textOutline: [0, 100], bgSat: [0, 100], uiScale: [75, 150] };
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
  const textName = () => settings.textColor === 'auto' ? L('Авто')
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

  /* ---------- Данные (демо, потом заменим на реальные API) ---------- */
  const MOCK = {
    soundcloud: {
      liked: [
        ['Night Drive', 'Luna Wave', 204], ['Neon Rain', 'Kito Rae', 187], ['Paper Planes', 'Soft Static', 231],
        ['Glass Garden', 'Mono Fox', 176], ['Velvet Hours', 'Velvet Echo', 245], ['8-Bit Heart', 'Pixel Heart', 162],
        ['After Midnight', 'Dusk Club', 219], ['Slow Orbit', 'Nova Lane', 198], ['Cherry Static', 'Soft Static', 173],
        ['Blue Hour', 'Luna Wave', 256], ['Tape Hiss', 'Mono Fox', 141], ['Last Train Home', 'Dusk Club', 228],
      ],
      playlists: [['Ночной город', 24], ['Для работы', 58], ['Phonk & Drift', 31], ['Lo-fi', 112], ['Старое доброе', 40], ['Новые находки', 17]],
      following: ['Luna Wave', 'Kito Rae', 'Soft Static', 'Mono Fox', 'Velvet Echo', 'Pixel Heart', 'Dusk Club', 'Nova Lane'],
    },
    vk: {
      liked: [
        ['Вечерний город', 'Северный ветер', 193], ['Танцы на крыше', 'Лето в сети', 208], ['Тихий свет', 'Альма', 221],
        ['Метро', 'Полночь', 184], ['Снег в апреле', 'Альма', 236], ['Кассета', 'Лето в сети', 167],
        ['Новый день', 'Северный ветер', 202], ['Дым и неон', 'Полночь', 215],
      ],
      playlists: [['Моё', 120], ['Для дороги', 45], ['Тренировка', 33]],
      following: ['Северный ветер', 'Лето в сети', 'Альма', 'Полночь'],
    },
    ytmusic: {
      liked: [
        ['Moonlight Loop', 'Aya Sato', 189], ['City Pop Dreams', 'Neon Tokyo', 214], ['Sunset Boulevard', 'The Hollows', 242],
        ['Chrome Heart', 'Neon Tokyo', 178], ['Quiet Hours', 'Aya Sato', 226], ['Rewind', 'The Hollows', 195],
        ['Paper Moon', 'Mika Wen', 207], ['Afterglow', 'Mika Wen', 233],
      ],
      playlists: [['Supermix', 50], ['Chill', 72], ['Любимое', 64]],
      following: ['Aya Sato', 'Neon Tokyo', 'The Hollows', 'Mika Wen'],
    },
    yandex: {
      liked: [
        ['Утренний кофе', 'Мира', 198], ['Дождь за окном', 'Тоня и Лис', 212], ['Зелёный чай', 'Мира', 181],
        ['Ночной автобус', 'Белый шум', 239], ['Лето внутри', 'Тоня и Лис', 172], ['Радио 404', 'Белый шум', 204],
        ['Город спит', 'Мира', 226], ['Сквозь стекло', 'Тоня и Лис', 191],
      ],
      playlists: [['Плейлист дня', 30], ['Мне нравится', 210], ['Дежавю', 25]],
      following: ['Мира', 'Тоня и Лис', 'Белый шум'],
    },
  };

  // по одному элементу из каждого списка по кругу, чтобы «Все треки» выглядели смешанными
  const interleave = (lists) => {
    const out = [];
    const max = Math.max(...lists.map((l) => l.length));
    for (let i = 0; i < max; i++) lists.forEach((l) => l[i] && out.push(l[i]));
    return out;
  };

  const DATA = {};
  let uid = 0;
  PLATFORMS.filter((p) => p.id !== 'all').forEach((p) => {
    const m = MOCK[p.id];
    DATA[p.id] = {
      liked: m.liked.map(([title, artist, dur]) => ({ id: ++uid, title, artist, dur, source: p.id })),
      playlists: m.playlists.map(([name, count]) => ({ name, count, source: p.id })),
      following: m.following,
    };
  });
  const parts = Object.values(DATA);
  DATA.all = {
    liked: interleave(parts.map((d) => d.liked)),
    playlists: interleave(parts.map((d) => d.playlists)),
    following: [...new Set(parts.flatMap((d) => d.following))],
  };

  /* ---------- Состояние ---------- */
  // у каждой платформы свой выбранный раздел: при переключении платформ они не смешиваются
  const state = {
    platform: 'soundcloud',
    tabs: Object.fromEntries(PLATFORMS.map((p) => [p.id, 'home'])),
    query: '',
  };
  const curTab = () => state.tabs[state.platform];

  // история переходов для стрелок «назад / вперёд» в верхнем баре
  const nav = { stack: [{ platform: 'soundcloud', tab: 'home' }], pos: 0 };

  const ui = { section: 'appearance', sub: 'theme', search: '' };
  const player = { queue: [], index: -1, playing: false, elapsed: 0, timer: null, liked: new Set(),
                   shuffle: false, repeat: 'off', history: [] }; // repeat: off | all | one
  let visibleTracks = [];

  /* ---------- Хелперы ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const cover = (seed) => {
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `linear-gradient(135deg,hsl(${h} 65% 55%),hsl(${(h + 55) % 360} 65% 28%))`;
  };
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
    if (wallpaper && settings.textOutline > 0) muted = mix(muted, text, 0.45);   // серый текст с обводкой выглядит грязным, поэтому он ближе к обычному

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

    // обводка текста и значков: только поверх обоев, цвет противоположен цвету текста
    const o = settings.textOutline / 100;
    if (wallpaper && o > 0) {
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
       <button class="rail-btn settings" data-settings data-tip="${L('Настройки')}" aria-label="${L('Настройки')}">
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
    $('tbTitle').innerHTML = `<span class="tb-ico">${I[p.icon]}</span><span>${esc(p.name)}</span><span class="tb-tab">${TAB_NAMES[curTab()]}</span>`;
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
        <div class="mini" style="background:${cover(t.title + t.artist)}"><span class="ico">${I.play}</span></div>
        <div class="t-meta">
          <div class="t-title">${mode === 'title' ? srcIcon(src, 'sm') : ''}<span class="t-text">${esc(t.title)}</span></div>
          <div class="t-artist">${esc(t.artist)}</div>
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
        <div class="cover" style="background:${cover(t.title + t.artist)}">
          ${mode === 'icon' ? `<span class="cover-ico" style="${srcVars(src)}" title="${esc(src.name)}">${I[src.icon]}</span>` : ''}
          <span class="fab">${I.play}</span>
        </div>
        <div class="card-title">${mode === 'title' ? srcIcon(src, 'sm') : ''}<span class="t-text">${esc(t.title)}</span></div>
        <div class="card-sub">${esc(t.artist)}</div>
        ${mode === 'label' ? `<div class="card-src" style="${srcVars(src)}"><i class="dot"></i>${esc(src.name)}</div>` : ''}
      </div>`;
  };

  const trackList = (list) => list.map(trackRow).join('');

  function renderContent() {
    const el = $('content');
    const data = DATA[state.platform];
    const q = state.query;
    const tab = curTab();

    if (q) {
      const found = data.liked.filter((t) => (t.title + ' ' + t.artist).toLowerCase().includes(q));
      visibleTracks = found;
      el.innerHTML = `
        <div class="section">
          <div class="section-title">${L('Результаты поиска')}</div>
          ${found.length ? trackList(found) : `<div class="empty">${L('Ничего не найдено. Попробуйте другое название или исполнителя.')}</div>`}
        </div>`;
      return;
    }

    if (tab === 'home') {
      visibleTracks = data.liked;
      const recent = data.liked.slice(0, 6);
      const more = data.liked.slice(6);
      el.innerHTML = `
        ${state.platform === 'all' ? '' : `
          <div class="notice">
            <p><b>${L('Демо-данные')}</b>${esc(L('Аккаунт {0} пока не подключён.', platform(state.platform).name))}</p>
            <button class="btn primary" disabled title="${L('Скоро')}">${L('Подключить аккаунт')}</button>
          </div>`}
        <div class="section">
          <div class="section-title">${L('Недавно слушали')}</div>
          <div class="grid">${recent.map(trackCard).join('')}</div>
        </div>
        ${more.length ? `<div class="section"><div class="section-title">${L('Рекомендуем')}</div>${trackList(more)}</div>` : ''}`;
    } else if (tab === 'liked') {
      visibleTracks = data.liked;
      el.innerHTML = `<div class="section"><div class="section-title">${L('Понравившиеся')}</div>${trackList(data.liked)}</div>`;
    } else if (tab === 'playlists') {
      visibleTracks = [];
      el.innerHTML = `
        <div class="section">
          <div class="section-title">${L('Плейлисты')}</div>
          <div class="grid">${data.playlists.map((pl) => `
            <div class="card">
              <div class="cover" style="background:${cover(pl.name)}"><span class="fab">${I.play}</span></div>
              <div class="card-title"><span class="t-text">${esc(pl.name)}</span></div>
              <div class="card-sub">${state.platform === 'all' ? esc(platform(pl.source).name) + ', ' : ''}${esc(L('{0} тр.', pl.count))}</div>
            </div>`).join('')}</div>
        </div>`;
    } else {
      visibleTracks = [];
      el.innerHTML = `
        <div class="section">
          <div class="section-title">${L('Подписки')}</div>
          <div class="grid">${data.following.map((name) => `
            <div class="card artist">
              <div class="cover" style="background:${cover(name)}"></div>
              <div class="card-title"><span class="t-text">${esc(name)}</span></div>
            </div>`).join('')}</div>
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
  function show(platformId, tabId) {
    state.platform = platformId;
    state.tabs[platformId] = tabId;
    state.query = '';
    $('searchInput').value = '';
    document.querySelector('.scroller').scrollTop = 0;
    document.querySelector('.main').classList.remove('scrolled');
    renderAll();
  }

  // обычный переход пользователя: запоминаем в истории и обрезаем «будущее»
  function go(platformId, tabId) {
    const here = nav.stack[nav.pos];
    if (here.platform === platformId && here.tab === tabId) return;
    nav.stack = nav.stack.slice(0, nav.pos + 1);
    nav.stack.push({ platform: platformId, tab: tabId });
    if (nav.stack.length > 50) nav.stack.shift();
    nav.pos = nav.stack.length - 1;
    show(platformId, tabId);
  }

  function stepHistory(delta) {
    const to = nav.pos + delta;
    if (to < 0 || to >= nav.stack.length) return;
    nav.pos = to;
    show(nav.stack[to].platform, nav.stack[to].tab);
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
      { id: 'accounts', name: 'Аккаунты', icon: 'person', subs: [{ id: 'platforms', name: 'Платформы' }, { id: 'sync', name: 'Синхронизация' }] },
      { id: 'privacy', name: 'Данные и конфиденциальность', icon: 'shield' },
      { id: 'notifications', name: 'Уведомления', icon: 'bell' },
    ] },
    { title: 'Приложение', items: [
      { id: 'playback', name: 'Воспроизведение', icon: 'play' },
      { id: 'appearance', name: 'Внешний вид', icon: 'palette', subs: [
        { id: 'theme', name: 'Тема и цвета' }, { id: 'wall', name: 'Обои и прозрачность' },
        { id: 'font', name: 'Шрифт и размер' }, { id: 'panels', name: 'Панели и отметки' } ] },
      { id: 'language', name: 'Язык', icon: 'globe' },
      { id: 'integrations', name: 'Интеграции', icon: 'plug' },
      { id: 'hotkeys', name: 'Горячие клавиши', icon: 'keyboard' },
    ] },
    { title: 'Справка', items: [
      { id: 'support', name: 'Поддержать проект', icon: 'heartFill', subs: [{ id: 'author', name: 'Автор' }, { id: 'more', name: 'Другие способы' }] },
      { id: 'about', name: 'Подробнее', icon: 'info' },
    ] },
  ];

  // единый список настроек: из него берутся и заголовки на страницах, и поиск
  const DEFS = [
    { id: 'acc-platforms', section: 'accounts', sub: 'platforms', title: 'Подключённые платформы',
      desc: 'Привязка аккаунтов SoundCloud, VK Музыки, YouTube Music и Яндекс Музыки. Подключение появится позже.' },
    { id: 'acc-sync', section: 'accounts', sub: 'sync', title: 'Автообновление библиотеки',
      desc: 'Подтягивать новые понравившиеся треки и плейлисты в фоне. Появится вместе с подключением аккаунтов.' },
    { id: 'priv-local', section: 'privacy', sub: null, title: 'Локальные данные',
      desc: 'Настройки, тема и громкость хранятся только на этом компьютере и никуда не отправляются.' },
    { id: 'priv-reset', section: 'privacy', sub: null, title: 'Сбросить настройки',
      desc: 'Вернуть тему, шрифт, уведомления и остальные параметры к значениям по умолчанию.' },
    { id: 'notif-track', section: 'notifications', sub: null, title: 'Уведомление о смене трека',
      desc: 'Показывать системное уведомление с названием и исполнителем, когда начинает играть новый трек.' },
    { id: 'notif-unfocused', section: 'notifications', sub: null, title: 'Только в свёрнутом окне',
      desc: 'Не показывать уведомления, пока окно приложения активно.' },
    { id: 'notif-silent', section: 'notifications', sub: null, title: 'Беззвучные уведомления',
      desc: 'Отключить системный звук при показе уведомления.' },
    { id: 'notif-test', section: 'notifications', sub: null, title: 'Проверить уведомление',
      desc: 'Показать тестовое уведомление с текущими настройками.' },
    { id: 'play-auto', section: 'playback', sub: null, title: 'Автовоспроизведение',
      desc: 'Сразу включать следующий трек, когда текущий закончился. Если выключить, воспроизведение остановится.' },
    { id: 'play-volume', section: 'playback', sub: null, title: 'Запоминать громкость',
      desc: 'Сохранять положение ползунка громкости между запусками.' },
    { id: 'ap-theme', section: 'appearance', sub: 'theme', title: 'Тема',
      desc: 'От светлой до тёмной: потяните ползунок или нажмите на название.' },
    { id: 'ap-tint', section: 'appearance', sub: 'theme', title: 'Цвет оформления',
      desc: 'Подкрашивает фон и акценты. Без цвета интерфейс остаётся нейтральным, а акцент берётся от платформы.' },
    { id: 'ap-bg', section: 'appearance', sub: 'theme', title: 'Цвет фона',
      desc: 'Цвет самого фона: он виден за обоями и под прозрачными панелями, а сами панели не перекрашивает. Насыщенность своя, яркость зависит от темы.' },
    { id: 'ap-text', section: 'appearance', sub: 'theme', title: 'Цвет текста',
      desc: 'Основной цвет текста и значков. «Авто» подбирается под тему.' },
    { id: 'ap-font', section: 'appearance', sub: 'font', title: 'Шрифт',
      desc: 'Список берётся из папки fonts в папке проекта: положите туда файл или папку со шрифтом, и он появится здесь.' },
    { id: 'ap-fontsize', section: 'appearance', sub: 'font', title: 'Размер шрифта',
      desc: 'Базовый размер текста интерфейса, остальные размеры меняются пропорционально.' },
    { id: 'ap-wallpaper', section: 'appearance', sub: 'wall', title: 'Обои',
      desc: 'Свой файл картинки для фона приложения (PNG, JPG, WebP, GIF, BMP, AVIF). Файл копируется в папку данных приложения, исходный можно удалить.' },
    { id: 'ap-wp-fit', section: 'appearance', sub: 'wall', title: 'Размещение обоев',
      desc: 'Растянуть на весь размер, вписать без деформации, заполнить до краёв с обрезкой, оригинальный размер или плиткой. Ниже положение: углы, края и центр.' },
    { id: 'ap-wp-blur', section: 'appearance', sub: 'wall', title: 'Размытие обоев',
      desc: 'Размывает картинку, чтобы текст на ней читался лучше.' },
    { id: 'ap-glass', section: 'appearance', sub: 'wall', title: 'Эффект стекла',
      desc: 'Панели слегка размывают и искажают обои под собой. Виден, когда панели полупрозрачны. 0 выключает эффект.' },
    { id: 'ap-outline', section: 'appearance', sub: 'wall', title: 'Обводка текста и значков',
      desc: 'Тонкая обводка, чтобы текст и значки не терялись на пёстрых обоях: сила, цвет и применение к значкам. 0 выключает обводку.' },
    { id: 'ap-opacity', section: 'appearance', sub: 'wall', title: 'Прозрачность элементов',
      desc: 'Отдельный ползунок для каждого элемента: бар окна, боковая панель, фон окна (с ним общая верхняя панель), основное полотно, карточки и строки, кнопки, поля и заголовки, плеер, окно настроек и линии. Элементы независимы: карточка может быть прозрачной, даже если полотно нет. 100% непрозрачно (так по умолчанию), 0% полностью прозрачно.' },
    { id: 'ap-pattern', section: 'appearance', sub: 'panels', title: 'Узор на панелях',
      desc: 'Фоновый узор на боковой панели, верхнем баре и плеере: точки, сетка, крестики или без узора. Ползунок настраивает заметность.' },
    { id: 'ap-marks', section: 'appearance', sub: 'panels', title: 'Откуда трек',
      desc: 'Как отмечать платформу у треков в списке «Все треки» и в плеере внизу.' },
    { id: 'ap-scale', section: 'appearance', sub: 'font', title: 'Масштаб интерфейса',
      desc: 'Увеличивает или уменьшает весь интерфейс целиком: текст, значки и отступы. Применяется, когда вы отпускаете ползунок. Размер шрифта выше меняет только текст.' },
    { id: 'lang-select', section: 'language', sub: null, title: 'Язык интерфейса',
      desc: 'Русский встроен. Остальные языки берутся из файлов .json в папке locales: положите туда файл, нажмите «Обновить список», и язык появится в списке.' },
    { id: 'lang-custom', section: 'language', sub: null, title: 'Свой перевод',
      desc: 'Скопируйте en.json, переведите значения справа от двоеточия (русские ключи слева не меняйте), поменяйте name и code и сохраните файл в той же папке. Фразы без перевода остаются на русском.' },
    { id: 'int-rpc', section: 'integrations', sub: null, title: 'Статус в Discord',
      desc: 'Показывать в профиле Discord, какой трек сейчас играет.' },
    { id: 'int-lastfm', section: 'integrations', sub: null, title: 'Last.fm',
      desc: 'Отправлять прослушанные треки в Last.fm (скробблинг).' },
    { id: 'int-media', section: 'integrations', sub: null, title: 'Медиаклавиши и системный плеер',
      desc: 'Управлять воспроизведением клавишами клавиатуры и из панели Windows.' },
    { id: 'keys-list', section: 'hotkeys', sub: null, title: 'Горячие клавиши',
      desc: 'Пробел: пауза и воспроизведение. Alt+← и Alt+→: назад и вперёд по разделам. Esc: закрыть настройки.' },
    { id: 'sup-author', section: 'support', sub: 'author', title: 'Поддержать автора',
      desc: 'Если плеер вам полезен, поддержите его развитие: донатом, подпиской или любым другим способом.' },
    { id: 'sup-share', section: 'support', sub: 'more', title: 'Рассказать друзьям',
      desc: 'Скопировать короткое сообщение с рекомендацией плеера, чтобы отправить его друзьям.' },
    { id: 'sup-feedback', section: 'support', sub: 'more', title: 'Идеи и сообщения об ошибках',
      desc: 'Напишите автору, что улучшить или что работает не так.' },
    { id: 'about-app', section: 'about', sub: null, title: 'О приложении',
      desc: 'Music Player: один плеер для SoundCloud, VK Музыки, YouTube Music и Яндекс Музыки.' },
    { id: 'about-info', section: 'about', sub: null, title: 'Сведения о системе',
      desc: 'Версии приложения, Electron, Chromium и системы. Скопируйте их и приложите к сообщению об ошибке.' },
    { id: 'about-fonts', section: 'about', sub: null, title: 'Шрифты и лицензии',
      desc: 'Встроенные шрифты IBM Plex Mono, Manrope и DotGothic16 распространяются по лицензии SIL Open Font License, тексты лицензий лежат рядом со шрифтами.' },
  ];
  const def = (id) => DEFS.find((d) => d.id === id);
  const secOf = (id) => NAV.flatMap((g) => g.items).find((x) => x.id === id);
  const subOf = (secId, subId) => ((secOf(secId) || {}).subs || []).find((x) => x.id === subId);

  /* --- строительные блоки страниц --- */
  const head = (id) => `<div class="setting-text"><div class="setting-title">${esc(def(id).title)}</div><div class="setting-desc">${esc(def(id).desc)}</div></div>`;
  const switchBtn = (key, on, disabled) =>
    `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${!!on}" data-toggle="${key}" ${disabled ? 'disabled' : ''}><i></i></button>`;
  const toggleRow = (id, key) => `<div class="setting" data-setting="${id}"><div class="setting-row">${head(id)}${switchBtn(key, settings[key], false)}</div></div>`;
  const soonRow = (id) => `<div class="setting" data-setting="${id}"><div class="setting-row">${head(id)}<span class="soon">${L('Скоро')}</span>${switchBtn('', false, true)}</div></div>`;
  const buttonRow = (id, btn) => `<div class="setting" data-setting="${id}"><div class="setting-row">${head(id)}${btn}</div></div>`;
  const infoRow = (id) => `<div class="setting" data-setting="${id}">${head(id)}</div>`;
  const blockRow = (id, body) => `<div class="setting" data-setting="${id}">${head(id)}<div class="setting-body">${body}</div></div>`;

  const themeStops = () => THEME_ORDER.map((k) => palette(k).main).join(',');

  function themeSliderHtml() {
    const idx = THEME_ORDER.indexOf(settings.theme);
    return `
      <div class="theme-slider">
        <input type="range" id="themeRange" min="0" max="${THEME_ORDER.length - 1}" step="1" value="${idx}"
               style="--stops:${themeStops()}" aria-label="${L('Тема')}">
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
        <label for="patRange">${L('Заметность')}</label>
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
        <label for="${inputId}">${L('Насыщенность')}</label>
        <input type="range" id="${inputId}" min="0" max="100" value="${value}" ${enabled ? '' : 'disabled'} style="--from:${from};--to:${to}">
        <span class="sat-val" id="${valId}">${value}%</span>
      </div>`;
  }

  function tintControls() {
    const tint = TINTS.find((p) => p.id === settings.tint);
    return `
      <div class="swatches">
        <button class="swatch none ${settings.tint ? '' : 'sel'}" data-tint="none" title="${L('Без цвета')}" aria-label="${L('Без цвета')}"></button>
        ${TINTS.map((p) => `
          <button class="swatch ${settings.tint === p.id ? 'sel' : ''}" data-tint="${p.id}"
                  style="background:${tintColor(p)}" title="${p.name}" aria-label="${p.name}"></button>`).join('')}
      </div>
      <div class="swatch-name">${tint ? tint.name : L('Без цвета')}</div>
      ${satRow('satRange', 'satVal', settings.sat, tint, !!tint)}
      <div class="sat-hint">${tint ? '' : L('Выберите цвет, чтобы настроить насыщенность.')}</div>`;
  }

  function textControls() {
    const hueP = TINTS.find((p) => p.id === settings.textColor);
    return `
      <div class="swatches">
        <button class="swatch auto ${settings.textColor === 'auto' ? 'sel' : ''}" data-text="auto" title="${L('Авто')}" aria-label="${L('Авто')}"
                style="color:${THEMES[settings.theme].text}">${L('Аа')}</button>
        <button class="swatch ${settings.textColor === 'white' ? 'sel' : ''}" data-text="white" title="${L('Белый')}" aria-label="${L('Белый')}" style="background:#ffffff"></button>
        <button class="swatch ${settings.textColor === 'black' ? 'sel' : ''}" data-text="black" title="${L('Чёрный')}" aria-label="${L('Чёрный')}" style="background:#000000"></button>
        ${TINTS.map((p) => `
          <button class="swatch ${settings.textColor === p.id ? 'sel' : ''}" data-text="${p.id}"
                  style="background:${textHue(p)}" title="${p.name}" aria-label="${p.name}"></button>`).join('')}
      </div>
      <div class="swatch-name" id="textName">${textName()}</div>
      ${satRow('textSatRange', 'textSatVal', settings.textSat, hueP, !!hueP)}
      <div class="sat-hint">${hueP ? '' : L('Насыщенность настраивается для цветного текста.')}</div>`;
  }

  // плитки выбора цвета: авто, белый, чёрный и 20 оттенков (для фона и обводки)
  const colorTiles = (attr, current) => `
    <div class="swatches">
      <button class="swatch auto ${current === 'auto' ? 'sel' : ''}" data-${attr}="auto" title="${L('Авто')}" aria-label="${L('Авто')}" style="color:${THEMES[settings.theme].text}">${L('Аа')}</button>
      <button class="swatch ${current === 'white' ? 'sel' : ''}" data-${attr}="white" title="${L('Белый')}" aria-label="${L('Белый')}" style="background:#ffffff"></button>
      <button class="swatch ${current === 'black' ? 'sel' : ''}" data-${attr}="black" title="${L('Чёрный')}" aria-label="${L('Чёрный')}" style="background:#000000"></button>
      ${TINTS.map((p) => `<button class="swatch ${current === p.id ? 'sel' : ''}" data-${attr}="${p.id}" style="background:${hsl(p.h, 100, 50)}" title="${p.name}" aria-label="${p.name}"></button>`).join('')}
    </div>`;
  const colorName = (c) => (c === 'auto' ? L('Авто') : TEXT_FIXED[c] ? TEXT_FIXED[c].name : (TINTS.find((x) => x.id === c) || {}).name);

  const bgControls = () => colorTiles('bg', settings.bgColor) + `<div class="swatch-name">${colorName(settings.bgColor)}</div>`
    + sliderRow('bgSat', L('Насыщенность'), settings.bgSat, 0, 100, '%');

  const outlineControls = () => sliderRow('textOutline', L('Сила обводки'), settings.textOutline, 0, 100, '%')
    + `<div class="btn-row" style="margin-top:14px"><button class="btn ${settings.outlineStyle === 'soft' ? 'primary' : ''}" data-ol-style="soft">${L('Размытая')}</button><button class="btn ${settings.outlineStyle === 'sharp' ? 'primary' : ''}" data-ol-style="sharp">${L('Чёткая')}</button></div>`
    + `<div class="swatch-name" style="margin-top:14px">${L('Цвет обводки')}</div>` + colorTiles('outline', settings.outlineColor)
    + `<div class="swatch-name">${colorName(settings.outlineColor)}</div>`
    + `<div class="setting-row" style="margin-top:12px"><div class="setting-text">${L('Применять к значкам')}</div>${switchBtn('outlineIcons', settings.outlineIcons, false)}</div>`;

  function fontControls() {
    const exists = fonts.list.some((f) => f.family === settings.font);
    const selected = settings.font === 'system' || exists ? settings.font : 'auto';
    const opts = [['auto', L('Авто (по стилю)')], ['system', L('Системный')], ...fonts.list.map((f) => [f.family, f.family])];
    return `
      <select class="select" id="fontSelect" aria-label="${L('Шрифт')}">
        ${opts.map(([v, n]) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
      <p class="font-preview">${L('Съешь ещё этих мягких французских булок, да выпей чаю. The quick brown fox 0123456789')}</p>
      <div class="btn-row">
        <button class="btn" data-action="open-fonts">${L('Открыть папку шрифтов')}</button>
        <button class="btn" data-action="reload-fonts">${L('Обновить список')}</button>
      </div>
      ${fonts.list.length ? '' : `<p class="setting-desc">${L('Папка fonts не найдена или пуста, пока доступны только системные шрифты.')}</p>`}`;
  }

  function fontSizeControls() {
    return `
      <div class="sat">
        <label for="fsRange">${L('Размер')}</label>
        <input type="range" id="fsRange" min="12" max="18" step="1" value="${settings.fontSize}" style="--from:var(--line);--to:var(--muted)">
        <span class="sat-val" id="fsVal">${settings.fontSize} px</span>
      </div>`;
  }

  function scaleControls() {
    return `
      <div class="sat">
        <label for="scaleRange">${L('Масштаб')}</label>
        <input type="range" id="scaleRange" min="75" max="150" step="5" value="${settings.uiScale}" style="--from:var(--line);--to:var(--muted)">
        <span class="sat-val" id="scaleVal">${settings.uiScale}%</span>
      </div>
      <div class="btn-row"><button class="btn" data-action="scale-reset" ${settings.uiScale === 100 ? 'disabled' : ''}>${L('Сбросить масштаб')}</button></div>`;
  }

  function languageControls() {
    const opts = [{ code: 'ru', name: 'Русский' }, ...lang.list];
    return `
      <select class="select" id="langSelect" aria-label="${L('Язык интерфейса')}">
        ${opts.map((o) => `<option value="${esc(o.code)}" ${o.code === lang.code ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}
      </select>
      ${lang.list.length ? '' : `<p class="setting-desc">${L('Папка locales не найдена или в ней нет языков, пока доступен только русский.')}</p>`}`;
  }

  const customLangControls = () => `
    <div class="btn-row" style="margin-top:0">
      <button class="btn" data-action="open-locales">${L('Открыть папку языков')}</button>
      <button class="btn" data-action="reload-locales">${L('Обновить список')}</button>
    </div>`;

  const platformRows = () => PLATFORMS.filter((p) => p.id !== 'all').map((p) => `
    <div class="row">
      ${badge(p)}
      <div class="grow">${esc(p.name)}<small>${L('Не подключено')}</small></div>
      <button class="btn" disabled title="${L('Скоро')}">${L('Подключить')}</button>
    </div>`).join('');

  const hotkeys = () => `
    <dl class="keys">
      <div><dt><kbd>${L('Пробел')}</kbd></dt><dd>${L('Пауза и воспроизведение')}</dd></div>
      <div><dt><kbd>Alt</kbd> + <kbd>←</kbd></dt><dd>${L('Назад по разделам')}</dd></div>
      <div><dt><kbd>Alt</kbd> + <kbd>→</kbd></dt><dd>${L('Вперёд по разделам')}</dd></div>
      <div><dt><kbd>Esc</kbd></dt><dd>${L('Закрыть настройки')}</dd></div>
    </dl>`;

  const versions = () => {
    const rows = [[L('Версия'), info.version], ['Electron', info.electron], ['Chromium', info.chrome], ['Node.js', info.node],
                  [L('Система'), info.platform ? `${info.platform} ${info.arch || ''}`.trim() : '']].filter((r) => r[1]);
    return rows.length ? `<dl class="meta">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '';
  };

  /* --- раздел «Поддержать проект»: ссылки автора лежат в support.json --- */
  let wallpaper = null; // { url, name, size } из главного процесса
  let supportCfg = { author: '', message: '', share: '', feedback: '', links: [] };

  function supportAuthorHtml() {
    const links = supportCfg.links || [];
    const msg = supportCfg.message ? `<p class="support-msg">${esc(L(supportCfg.message))}</p>` : '';
    const by = supportCfg.author ? `<p class="setting-desc">${L('Автор:')} ${esc(supportCfg.author)}</p>` : '';
    const rows = links.length ? links.map((l, i) => `
      <div class="row">
        <span class="badge heart">${I.heartFill}</span>
        <div class="grow">${esc(L(l.title))}<small>${esc(L(l.note))}</small></div>
        ${l.url ? `<button class="btn primary" data-open="${i}">${L('Открыть')}</button>` : `<span class="soon">${L('Ссылка не задана')}</span>`}
      </div>`).join('')
      : `<p class="setting-desc">${L('Ссылки пока не добавлены: автор может указать их в файле support.json.')}</p>`;
    return msg + by + rows;
  }

  /* --- обои и прозрачность --- */
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' ' + L('МБ') : Math.max(1, Math.round(n / 1024)) + ' ' + L('КБ'));

  function wallpaperControls() {
    return `
      <div class="wp-box">
        <div class="wp-thumb" id="wpThumb" style="${wallpaper ? `background-image:${esc(`url("${wallpaper.url}")`)}` : ''}">${wallpaper ? '' : L('Нет обоев')}</div>
        <div>
          <div class="wp-name" id="wpName">${wallpaper ? esc(wallpaper.name) + ', ' + fmtSize(wallpaper.size) : L('Файл не выбран')}</div>
          <div class="btn-row" style="margin-top:0">
            <button class="btn primary" data-action="wp-pick">${L('Выбрать файл…')}</button>
            <button class="btn" data-action="wp-clear" ${wallpaper ? '' : 'disabled'}>${L('Убрать обои')}</button>
          </div>
        </div>
      </div>`;
  }

  function fitControls() {
    const stretch = settings.wpFit === 'stretch';
    return `
      <div class="wp-fit-row">
        <div class="field"><span>${L('Размещение')}</span>
          <select class="select" id="wpFit" aria-label="${L('Размещение обоев')}">
            ${Object.keys(WP_FITS).map((k) => `<option value="${k}" ${settings.wpFit === k ? 'selected' : ''}>${WP_FITS[k].name}</option>`).join('')}
          </select>
        </div>
        <div class="field"><span>${L('Положение')}</span>
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
    + `<div class="btn-row"><button class="btn" data-action="op-reset">${L('Сделать всё непрозрачным')}</button></div>`;

  function pageHtml(id) {
    const S = secOf(id);
    const wrap = (subId, inner) =>
      `<section class="sub" id="sub-${subId}" data-sub="${subId}"><h4 class="sub-title">${esc(subOf(id, subId).name)}</h4>${inner}</section>`;
    let inner = '';
    switch (id) {
      case 'accounts':
        inner = wrap('platforms', blockRow('acc-platforms', platformRows())) + wrap('sync', soonRow('acc-sync'));
        break;
      case 'privacy':
        inner = infoRow('priv-local') + buttonRow('priv-reset', `<button class="btn danger" data-action="reset">${L('Сбросить')}</button>`);
        break;
      case 'notifications':
        inner = toggleRow('notif-track', 'notifyTrack') + toggleRow('notif-unfocused', 'notifyUnfocused') + toggleRow('notif-silent', 'notifySilent')
              + buttonRow('notif-test', `<button class="btn" data-action="test-notify">${L('Показать')}</button>`);
        break;
      case 'playback':
        inner = toggleRow('play-auto', 'autoplay') + toggleRow('play-volume', 'rememberVolume');
        break;
      case 'appearance':
        inner = wrap('theme', blockRow('ap-theme', themeSliderHtml()) + blockRow('ap-tint', tintControls()) + blockRow('ap-bg', bgControls()) + blockRow('ap-text', textControls()))
              + wrap('wall', blockRow('ap-wallpaper', wallpaperControls()) + blockRow('ap-wp-fit', fitControls())
                           + blockRow('ap-wp-blur', sliderRow('wpBlur', L('Размытие'), settings.wpBlur, 0, 40, ' px'))
                           + blockRow('ap-glass', sliderRow('glassBlur', L('Сила эффекта'), settings.glassBlur, 0, 24, ' px'))
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
              + wrap('more', buttonRow('sup-share', `<button class="btn" data-action="share">${L('Скопировать')}</button>`)
                           + buttonRow('sup-feedback', (noFeedback ? `<span class="soon">${L('Ссылка не задана')}</span>` : '')
                                     + `<button class="btn" data-action="open-feedback" ${noFeedback ? 'disabled' : ''}>${L('Написать')}</button>`));
        break;
      }
      case 'about':
        inner = blockRow('about-app', versions()) + buttonRow('about-info', `<button class="btn" data-action="copy-info">${L('Копировать')}</button>`) + infoRow('about-fonts');
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
      <h3 class="set-title">${L('Результаты поиска')}</h3>
      ${found.length ? found.map((d) => `
        <button class="result" data-goto="${d.id}">
          <span class="crumb">${esc(crumb(d))}</span>
          <span class="r-title">${hl(d.title, terms)}</span>
          <span class="r-desc">${hl(d.desc, terms)}</span>
        </button>`).join('') : `<div class="empty">${L('Ничего не найдено. Попробуйте другое слово.')}</div>`}`;
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
        btn.textContent = L('Нажмите ещё раз');
        setTimeout(() => { if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = L('Сбросить'); } }, 3000);
        return;
      }
      await resetSettings();
    } else if (a === 'test-notify') {
      notify(current() || DATA.all.liked[0], true);
    } else if (a === 'copy-info') {
      const lines = [`Music Player ${info.version || ''}`.trim(), `Electron ${info.electron || '?'}, Chromium ${info.chrome || '?'}, Node ${info.node || '?'}`,
                     `${L('Система')}: ${info.platform || '?'} ${info.arch || ''}`.trim(), `${L('Тема')}: ${settings.theme}, ${L('шрифт')}: ${settings.font}, ${settings.fontSize} px`];
      try { await navigator.clipboard.writeText(lines.join('\n')); btn.textContent = L('Скопировано'); } catch (e) { btn.textContent = L('Не удалось'); }
      setTimeout(() => { if (btn.isConnected) btn.textContent = L('Копировать'); }, 1500);
    } else if (a === 'share') {
      const text = L(supportCfg.share || 'Попробуй Music Player: один плеер для SoundCloud, VK Музыки, YouTube Music и Яндекс Музыки.');
      try { await navigator.clipboard.writeText(text); btn.textContent = L('Скопировано'); } catch (e) { btn.textContent = L('Не удалось'); }
      setTimeout(() => { if (btn.isConnected) btn.textContent = L('Скопировать'); }, 1500);
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

  const REPEAT_TITLES = { off: 'Повтор выключен', all: 'Повторять плейлист', one: 'Повторять трек' };

  function updatePlayer() {
    const t = current();
    // отметка платформы у играющего трека: так же, как на карточках (значок на обложке, у названия или подпись)
    const src = t ? platform(t.source) : null;
    const mode = settings.sourceMode;
    $('npCover').style.background = t ? cover(t.title + t.artist) : '';
    $('npCover').innerHTML = src && mode === 'icon'
      ? `<span class="cover-ico np-ico" style="${srcVars(src)}" title="${esc(src.name)}">${I[src.icon]}</span>` : '';
    $('npTitle').innerHTML = (src && mode === 'title' ? srcIcon(src, 'sm') : '')
      + `<span class="t-text">${esc(t ? t.title : L('Ничего не играет'))}</span>`;
    $('npArtist').textContent = t ? t.artist : L('Выберите трек');
    $('npSrc').setAttribute('style', src ? srcVars(src) : '');
    $('npSrc').innerHTML = src && mode === 'label' ? `<i class="dot"></i>${esc(src.name)}` : '';
    $('playBtn').innerHTML = player.playing ? I.pause : I.play;
    $('playBtn').title = L(player.playing ? 'Пауза' : 'Играть');
    $('likeBtn').classList.toggle('on', !!t && player.liked.has(t.id));

    $('shuffleBtn').classList.toggle('on', player.shuffle);
    $('shuffleBtn').title = L(player.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено');
    $('repeatBtn').classList.toggle('on', player.repeat !== 'off');
    $('repeatBtn').innerHTML = player.repeat === 'one' ? I.repeatOne : I.repeat;
    $('repeatBtn').title = L(REPEAT_TITLES[player.repeat]);

    updateProgress();
    markPlaying();
  }

  function startTimer() {
    clearInterval(player.timer);
    player.timer = setInterval(() => {
      const t = current();
      if (!player.playing || !t) return;
      player.elapsed += 1;
      if (player.elapsed >= t.dur) onTrackEnd();
      else updateProgress();
    }, 1000);
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
    startTimer();
    updatePlayer();
    if (changed) notify(current(), false);
  }

  function toggle() {
    if (!current()) return;
    player.playing = !player.playing;
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
    if (player.repeat === 'one') { player.elapsed = 0; updatePlayer(); return; }
    if (!settings.autoplay) { player.playing = false; player.elapsed = 0; updatePlayer(); return; }
    const isLast = player.index === player.queue.length - 1;
    if (isLast && !player.shuffle && player.repeat === 'off') {
      player.playing = false;
      player.elapsed = 0;
      updatePlayer();
      return;
    }
    next();
  }

  function playTrack(id) {
    if (current() && current().id === id) return toggle();
    player.queue = visibleTracks.slice();
    player.history = [];
    playAt(player.queue.findIndex((t) => t.id === id), false);
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
    renderContent();
  });

  $('content').addEventListener('click', (e) => {
    const row = e.target.closest('[data-track]');
    if (row) playTrack(Number(row.dataset.track));
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
    updateProgress();
  });
  $('vol').addEventListener('input', (e) => { setFill(e.target); settings.volume = Number(e.target.value); saveSettings(); });

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
    const maxText = L(winMaxed ? 'Свернуть в окно' : 'Развернуть');
    [['wcMin', L('Свернуть')], ['wcMax', maxText], ['wcClose', L('Закрыть')]].forEach(([id, text]) => {
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
  collectStatic();
  applyScale();
  // сначала подгружаем языки, потом рисуем интерфейс: так при запуске не мелькает русский текст
  const boot = () => { renderWindowControls(); renderAll(); updatePlayer(); };
  loadLocales().then(boot, boot);
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
