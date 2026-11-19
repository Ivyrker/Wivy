const { app, BrowserWindow, ipcMain, shell, dialog, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Папка с данными закреплена по имени: настройки, вход в аккаунты (токены, cookie), обои и размер окна лежат в ней
// и переживают любые обновления, пока имя папки не меняется. Не переименовывать.
app.setPath('userData', path.join(app.getPath('appData'), 'Wivy'));

// Шрифты берутся только из папки fonts в данных Wivy (roaming). Встроенные шрифты лежат рядом с приложением лишь как образец:
// при первом запуске они копируются в эту папку (см. seedUserData). Всё, что положить в папку, появится в настройках «Внешний вид → Шрифт».
// Шрифт — это либо папка (fonts/Имя шрифта/regular.woff2, bold.woff2 ...), либо один файл прямо в fonts/.
const FONTS_DIR = path.join(__dirname, 'fonts');
const userFontsDir = () => path.join(app.getPath('userData'), 'fonts');
const FONT_FILE = /\.(woff2?|ttf|otf)$/i;
const FONT_MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };
const MAX_USER_FONT = 12 * 1024 * 1024;
const WEIGHTS = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400,
  medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900,
};
const WEIGHT_WORDS = Object.keys(WEIGHTS).sort((a, b) => b.length - a.length); // «extrabold» раньше «bold»

// толщина и наклон берутся из имени файла: bold.woff2, Italic.ttf, variable.woff2 (переменный шрифт)
function parseFace(fileName) {
  const base = fileName.replace(FONT_FILE, '').toLowerCase();
  if (base.includes('variable')) return { weight: '100 900', style: 'normal' };
  const word = WEIGHT_WORDS.find((w) => base.includes(w));
  return { weight: String(word ? WEIGHTS[word] : 400), style: base.includes('italic') ? 'italic' : 'normal' };
}

// toUrl превращает путь к файлу в адрес для окна: встроенные шрифты отдаются относительным путём,
// свои читаются в data:-адрес (страница из файла не может открыть чужую папку напрямую)
function scanFonts(root, toUrl) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return []; }
  const families = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      let files = [];
      try { files = fs.readdirSync(path.join(root, entry.name)).filter((f) => FONT_FILE.test(f)); } catch (e) { /* пропускаем */ }
      const faces = files.map((f) => ({ url: toUrl([entry.name, f]), ...parseFace(f) })).filter((f) => f.url);
      if (faces.length) families.push({ family: entry.name, faces });
    } else if (FONT_FILE.test(entry.name)) {
      const url = toUrl([entry.name]);
      if (url) families.push({ family: entry.name.replace(FONT_FILE, '').replace(/[-_]+/g, ' '), faces: [{ url, ...parseFace(entry.name) }] });
    }
  }
  return families;
}

const fontCache = new Map(); // путь -> { stamp, url }: шрифты не читаются и не кодируются заново при каждом обновлении списка
function listFonts() {
  const families = scanFonts(userFontsDir(), (parts) => {
    const full = path.join(userFontsDir(), ...parts);
    try {
      const st = fs.statSync(full);
      if (st.size > MAX_USER_FONT) return '';
      const stamp = st.size + ':' + st.mtimeMs;
      const hit = fontCache.get(full);
      if (hit && hit.stamp === stamp) return hit.url;
      const ext = path.extname(full).slice(1).toLowerCase();
      const url = 'data:' + (FONT_MIME[ext] || 'font/ttf') + ';base64,' + fs.readFileSync(full).toString('base64');
      fontCache.set(full, { stamp, url });
      return url;
    } catch (e) { return ''; }
  });
  return families.sort((a, b) => a.family.localeCompare(b.family, 'ru'));
}

// Раздел «Поддержать проект» берёт ссылки автора из support.json (лежит рядом с main.js).
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

function readSupport() {
  const empty = { author: '', message: '', share: '', feedback: '', links: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'support.json'), 'utf8'));
    return {
      author: String(raw.author || '').slice(0, 80),
      message: String(raw.message || '').slice(0, 400),
      share: String(raw.share || '').slice(0, 400),
      feedback: isHttp(raw.feedback) ? raw.feedback.trim() : '',
      links: (Array.isArray(raw.links) ? raw.links : []).slice(0, 12).map((l) => ({
        title: String((l && l.title) || '').slice(0, 60),
        note: String((l && l.note) || '').slice(0, 120),
        url: l && isHttp(l.url) ? l.url.trim() : '',
      })).filter((l) => l.title),
    };
  } catch (e) { return empty; }
}

// Обои: выбранная картинка копируется в папку данных приложения как wallpaper.<расширение>,
// поэтому исходный файл можно потом переместить или удалить.
const WP_FILE = /^wallpaper\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const WP_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'];
const dataDir = () => app.getPath('userData');
const wallpaperFiles = () => { try { return fs.readdirSync(dataDir()).filter((n) => WP_FILE.test(n)); } catch (e) { return []; } };

function findWallpaper() {
  const name = wallpaperFiles()[0];
  if (!name) return null;
  const full = path.join(dataDir(), name);
  try {
    const st = fs.statSync(full);
    return { name, size: st.size, url: pathToFileURL(full).href + '?v=' + Math.round(st.mtimeMs) };
  } catch (e) { return null; }
}
function clearWallpaperFiles() {
  wallpaperFiles().forEach((n) => { try { fs.unlinkSync(path.join(dataDir(), n)); } catch (e) { /* ничего */ } });
}

// Языки интерфейса: каждый файл languages/*.json — отдельный язык { "name", "code", "strings": { "English phrase": "перевод" } }.
// Английский встроен в приложение, поэтому файл для него не нужен. Файлы берутся только из папки languages в данных Wivy (roaming);
// встроенный ru.json лежит рядом с приложением как образец и при первом запуске копируется туда (см. seedUserData).
const LANGUAGES_DIR = path.join(__dirname, 'languages');
const userLanguagesDir = () => path.join(app.getPath('userData'), 'languages');

function readLanguages(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /\.json$/i.test(f) && !/-template\.json$/i.test(f)); } catch (e) { return []; }
  const out = [];
  for (const file of names) {
    try {
      const full = path.join(dir, file);
      if (fs.statSync(full).size > 2 * 1024 * 1024) continue;   // перевод на пару тысяч строк весит в разы меньше
      const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
      if (!raw || typeof raw.strings !== 'object' || !raw.strings) continue;
      const strings = {};
      for (const [k, v] of Object.entries(raw.strings)) if (typeof v === 'string') strings[k] = v;
      const code = String(raw.code || file.replace(/\.json$/i, '')).trim().slice(0, 20);
      if (!code || code === 'en') continue;
      out.push({ code, name: String(raw.name || code).slice(0, 40), strings });
    } catch (e) { /* битый файл пропускаем */ }
  }
  return out;
}

function listLanguages() {
  return readLanguages(userLanguagesDir()).sort((a, b) => a.name.localeCompare(b.name));
}

const winOf = (event) => BrowserWindow.fromWebContents(event.sender);

// значок приложения: окно, панель задач, Alt+Tab (icon.ico для Windows, icon.png для остальных систем)
const ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

/* ---------- Размер и положение окна запоминаются между запусками ---------- */
const MIN_SIZE = { width: 960, height: 560 };
const DEFAULT_SIZE = { width: 1200, height: 760 };
const stateFile = () => path.join(dataDir(), 'window-state.json');

function loadWindowState() {
  const fallback = { ...DEFAULT_SIZE, maximized: false };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return fallback; }
  const num = (v) => (Number.isFinite(v) ? Math.round(v) : null);
  const st = { width: num(raw && raw.width), height: num(raw && raw.height), x: num(raw && raw.x), y: num(raw && raw.y), maximized: !!(raw && raw.maximized) };
  if (!st.width || !st.height) return fallback;

  // окно не больше экрана и не меньше минимума
  const area = screen.getPrimaryDisplay().workArea;
  st.width = Math.min(Math.max(st.width, MIN_SIZE.width), Math.max(area.width, MIN_SIZE.width));
  st.height = Math.min(Math.max(st.height, MIN_SIZE.height), Math.max(area.height, MIN_SIZE.height));

  // прежнее положение берём, только если окно всё ещё видно на одном из экранов (монитор могли отключить)
  const visible = st.x !== null && st.y !== null && screen.getAllDisplays().some(({ workArea: a }) =>
    st.x + st.width > a.x + 100 && st.x < a.x + a.width - 100 && st.y >= a.y - 20 && st.y < a.y + a.height - 100);
  if (!visible) { st.x = null; st.y = null; }
  return st;
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const b = win.getNormalBounds(); // размеры обычного окна, даже когда сейчас оно развёрнуто
  const data = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
  try { fs.writeFileSync(stateFile(), JSON.stringify(data)); } catch (e) { /* ничего */ }
}

function createWindow() {
  const st = loadWindowState();
  const win = new BrowserWindow({
    icon: fs.existsSync(ICON) ? ICON : undefined,
    width: st.width,
    height: st.height,
    ...(st.x !== null && st.y !== null ? { x: st.x, y: st.y } : {}),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    backgroundColor: '#161616',
    autoHideMenuBar: true,
    title: 'Wivy',
    show: false, // показываем, когда страница готова: без вспышки окна обычного размера перед разворачиванием

    // системный бар убран целиком, включая кнопки окна: их рисует само приложение (см. renderer.js)
    titleBarStyle: 'hidden',
    titleBarOverlay: false, // системных кнопок окна нет вообще
    trafficLightPosition: { x: 14, y: 11 }, // только macOS: там остаются системные кнопки

    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 4000); // на случай, если страница не загрузилась

  // сообщаем окну приложения, развёрнуто ли оно, чтобы кнопка меняла значок
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));

  // сохраняем размер и «развёрнуто или нет»: при изменении (с паузой, чтобы не писать файл на каждый пиксель) и при закрытии
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveWindowState(win), 400); };
  ['resize', 'move', 'maximize', 'unmaximize'].forEach((ev) => win.on(ev, saveSoon));
  win.on('close', () => { clearTimeout(saveTimer); saveWindowState(win); });

  win.loadFile('index.html');
}

// SoundCloud: вход и загрузка библиотеки (подробности в soundcloud.js)
require('./soundcloud').register(ipcMain, winOf);
// VK Музыка: вход через окно vk.com и загрузка библиотеки (подробности в vk.js)
require('./vk').register(ipcMain, winOf);

/* ---------- Кнопки окна ---------- */
ipcMain.on('win:minimize', (e) => { const w = winOf(e); if (w) w.minimize(); });
ipcMain.on('win:toggle-maximize', (e) => {
  const w = winOf(e);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
});
ipcMain.on('win:close', (e) => { const w = winOf(e); if (w) w.close(); });
ipcMain.handle('win:is-maximized', (e) => { const w = winOf(e); return !!(w && w.isMaximized()); });

/* ---------- Обои ---------- */
ipcMain.handle('wallpaper:get', () => findWallpaper());
ipcMain.handle('wallpaper:pick', async (e, labels) => {
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : fallback);
  const options = {
    title: text(labels && labels.title, 'Choose a wallpaper image'), // подписи приходят из окна приложения, на языке интерфейса
    properties: ['openFile'],
    filters: [{ name: text(labels && labels.filter, 'Images'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }],
  };
  const win = winOf(e);
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  if (res.canceled || !res.filePaths.length) return findWallpaper();
  const src = res.filePaths[0];
  const ext = path.extname(src).toLowerCase();
  if (!WP_EXT.includes(ext)) return findWallpaper();
  clearWallpaperFiles();
  await fs.promises.mkdir(dataDir(), { recursive: true });
  await fs.promises.copyFile(src, path.join(dataDir(), 'wallpaper' + ext));
  return findWallpaper();
});
// байты картинки отдаём окну приложения: из file:// canvas был бы «заражённым» и не позволил бы собрать размытые слои обоев
const WP_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' };
ipcMain.handle('wallpaper:read', () => {
  const name = wallpaperFiles()[0];
  if (!name) return null;
  try {
    const bytes = fs.readFileSync(path.join(dataDir(), name));
    return { bytes, mime: WP_MIME[path.extname(name).slice(1).toLowerCase()] || 'image/png' };
  } catch (e) { return null; }
});
ipcMain.handle('wallpaper:clear', () => { clearWallpaperFiles(); return null; });

/* ---------- Шрифты и сведения о приложении ---------- */
ipcMain.handle('languages:list', () => listLanguages());
ipcMain.handle('languages:open-folder', async () => {
  await fs.promises.mkdir(userLanguagesDir(), { recursive: true });
  return shell.openPath(userLanguagesDir());
});
ipcMain.handle('fonts:list', () => listFonts());
ipcMain.handle('fonts:open-folder', async () => {
  await fs.promises.mkdir(userFontsDir(), { recursive: true });
  return shell.openPath(userFontsDir());
});
ipcMain.handle('app:support', () => readSupport());

// Заметки об обновлениях: patchnotes.json лежит рядом с main.js, картинки к ним в папке patchnotes (подробности в patchnotes/README.txt)
const NOTES_DIR = path.join(__dirname, 'patchnotes');
const IMG_FILE = /\.(png|jpe?g|webp|gif|avif)$/i;
function readPatchNotes() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'patchnotes.json'), 'utf8')); } catch (e) { return []; }
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  return (Array.isArray(raw && raw.entries) ? raw.entries : []).slice(0, 60).map((e) => ({
    version: str(e && e.version, 30),
    date: str(e && e.date, 30),
    title: str(e && e.title, 120),
    items: (Array.isArray(e && e.items) ? e.items : []).slice(0, 40).map((t) => str(t, 300)).filter(Boolean),
    images: (Array.isArray(e && e.images) ? e.images : []).slice(0, 8)
      .map((f) => path.basename(String(f || '')))                       // только имя файла: выйти из папки нельзя
      .filter((f) => IMG_FILE.test(f) && fs.existsSync(path.join(NOTES_DIR, f)))
      .map((f) => 'patchnotes/' + encodeURIComponent(f)),
  })).filter((e) => e.version || e.title);
}
ipcMain.handle('app:patchnotes', () => readPatchNotes());
// открываем только те ссылки, которые автор указал в support.json
ipcMain.handle('app:open-external', async (_e, url) => {
  const cfg = readSupport();
  const allowed = new Set([cfg.feedback, ...cfg.links.map((l) => l.url)].filter(Boolean));
  if (!isHttp(url) || !allowed.has(url)) return false;
  await shell.openExternal(url);
  return true;
});
ipcMain.handle('app:info', () => ({
  name: app.getName(),
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
}));

/* ---------- Папки fonts и languages в данных Wivy: создаются сразу при запуске ---------- */
// Встроенные шрифты и ru.json копируются в %APPDATA%\Wivy\fonts и \languages. Недостающие файлы докладываются при каждом запуске;
// при смене версии приложения встроенные файлы обновляются (их правки теряются: свой перевод сохраняйте под новым именем).
function seedDir(src, dst, overwrite) {
  fs.mkdirSync(dst, { recursive: true });
  let entries = [];
  try { entries = fs.readdirSync(src, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    const from = path.join(src, e.name);
    const to = path.join(dst, e.name);
    try {
      if (e.isDirectory()) seedDir(from, to, overwrite);
      else if (overwrite || !fs.existsSync(to)) fs.copyFileSync(from, to);
    } catch (err) { /* файл занят или нет прав: пропускаем */ }
  }
}
function seedUserData() {
  const marker = path.join(dataDir(), 'seed-version.txt');
  let last = '';
  try { last = fs.readFileSync(marker, 'utf8').trim(); } catch (e) { /* первый запуск */ }
  const overwrite = last !== app.getVersion();
  seedDir(FONTS_DIR, userFontsDir(), overwrite);
  seedDir(LANGUAGES_DIR, userLanguagesDir(), overwrite);
  try { fs.writeFileSync(marker, app.getVersion()); } catch (e) { /* ничего */ }
}

/* ---------- Автообновление (electron-updater, релизы на GitHub) ---------- */
const updateFile = () => path.join(dataDir(), 'update-settings.json');
const upd = { auto: true, state: 'idle', version: '', percent: 0, error: '', packaged: app.isPackaged };
let autoUpdater = null;
let updTimer = null;

try { const r = JSON.parse(fs.readFileSync(updateFile(), 'utf8')); if (typeof r.auto === 'boolean') upd.auto = r.auto; } catch (e) { /* по умолчанию включено */ }
const saveUpdSettings = () => { try { fs.writeFileSync(updateFile(), JSON.stringify({ auto: upd.auto })); } catch (e) { /* ничего */ } };
const broadcastUpd = () => BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.webContents.send('updates:status', { ...upd }); });
const setUpd = (patch) => { Object.assign(upd, patch); broadcastUpd(); };

function setupUpdater() {
  if (!app.isPackaged) { upd.state = 'dev'; return; }   // из исходников обновляться нечему
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { setUpd({ state: 'error', error: 'The updater is missing' }); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = upd.auto;
  autoUpdater.on('checking-for-update', () => setUpd({ state: 'checking', error: '' }));
  autoUpdater.on('update-available', (i) => setUpd({ state: 'downloading', version: String((i && i.version) || ''), percent: 0 }));
  autoUpdater.on('update-not-available', () => setUpd({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => setUpd({ state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
  autoUpdater.on('update-downloaded', (i) => setUpd({ state: 'downloaded', version: String((i && i.version) || upd.version) }));
  autoUpdater.on('error', (e) => setUpd({ state: 'error', error: String((e && e.message) || e || 'Unknown error').split('\n')[0].slice(0, 200) }));
}
async function checkUpdates() {
  if (!autoUpdater || upd.state === 'checking' || upd.state === 'downloading') return;
  try { await autoUpdater.checkForUpdates(); } catch (e) { setUpd({ state: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }); }
}
function scheduleUpdates() {
  clearInterval(updTimer);
  updTimer = null;
  if (!upd.auto || !autoUpdater) return;
  updTimer = setInterval(checkUpdates, 4 * 60 * 60 * 1000);
  setTimeout(checkUpdates, 8000); // проверка вскоре после запуска, когда окно уже открыто
}
ipcMain.handle('updates:get', () => ({ ...upd }));
ipcMain.handle('updates:set-auto', (_e, on) => {
  upd.auto = !!on;
  saveUpdSettings();
  if (autoUpdater) autoUpdater.autoInstallOnAppQuit = upd.auto;
  scheduleUpdates();
  broadcastUpd();
  return { ...upd };
});
ipcMain.handle('updates:check', async () => { await checkUpdates(); return { ...upd }; });
ipcMain.handle('updates:install', () => { if (autoUpdater && upd.state === 'downloaded') autoUpdater.quitAndInstall(); });

app.setAppUserModelId('com.wivy.app'); // чтобы Windows показывала значок приложения в панели задач и в уведомлениях (совпадает с appId в package.json)

app.whenReady().then(() => {
  seedUserData(); // папки fonts и languages появляются сразу, ещё до открытия окна
  // Уведомления Windows берут имя и значок приложения из ярлыка в меню «Пуск» с тем же appUserModelId.
  // Установщик создаёт такой ярлык сам; если приложение запущено без установки (из исходников, из распакованной папки),
  // ярлыка нет и Windows подписывает уведомления «Electron». Поэтому при необходимости делаем ярлык сами.
  if (process.platform === 'win32') {
    try {
      const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Wivy.lnk');
      let ok = false;
      try { const cur = shell.readShortcutLink(lnk); ok = cur.appUserModelId === 'com.wivy.app' && path.resolve(cur.target || '').toLowerCase() === path.resolve(process.execPath).toLowerCase(); } catch (e) { /* ярлыка нет */ }
      if (!ok) {
        shell.writeShortcutLink(lnk, 'create', {
          target: process.execPath, args: app.isPackaged ? '' : '"' + app.getAppPath() + '"', cwd: path.dirname(process.execPath),
          icon: fs.existsSync(ICON) ? ICON : process.execPath, iconIndex: 0, appUserModelId: 'com.wivy.app', description: 'Wivy',
        });
      }
    } catch (e) { /* ничего */ }
  }
  // защищённый DNS (DoH), как в браузере: провайдерский DNS может подменять адреса заблокированных сайтов,
  // и тогда окно приложения видит чужой сертификат (ERR_CERT_COMMON_NAME_INVALID). Если DoH недоступен, остаётся обычный DNS
  try {
    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: 'automatic',
      secureDnsServers: ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query', 'https://dns.quad9.net/dns-query', 'https://common.dot.dns.yandex.net/dns-query', 'https://dns.adguard-dns.com/dns-query'],
    });
  } catch (e) { /* ничего */ }
  // hls.js читает звук VK через XHR, а сервера VK не разрешают это странице из файла: добавляем разрешение к их ответам
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*.vkuser.net/*', 'https://*.vkuseraudio.net/*', 'https://*.vkuseraudio.ru/*', 'https://*.vk-cdn.net/*'] }, (d, done) => {
    const h = { ...d.responseHeaders };
    Object.keys(h).filter((k) => /^access-control-allow-origin$/i.test(k)).forEach((k) => delete h[k]);
    h['Access-Control-Allow-Origin'] = ['*'];
    done({ responseHeaders: h });
  });
  if (process.platform === 'darwin' && app.dock && fs.existsSync(ICON)) { try { app.dock.setIcon(ICON); } catch (e) { /* ничего */ } } // значок в Dock при запуске из исходников
  setupUpdater();
  createWindow();
  scheduleUpdates();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
