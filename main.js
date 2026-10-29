const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Папка со шрифтами: всё, что в неё положить, появится в настройках «Внешний вид → Шрифт».
// Шрифт — это либо папка (fonts/Имя шрифта/regular.woff2, bold.woff2 ...), либо один файл прямо в fonts/.
const FONTS_DIR = path.join(__dirname, 'fonts');
const FONT_FILE = /\.(woff2?|ttf|otf)$/i;
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

function listFonts() {
  let entries = [];
  try { entries = fs.readdirSync(FONTS_DIR, { withFileTypes: true }); } catch (e) { return []; }

  const families = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      let files = [];
      try { files = fs.readdirSync(path.join(FONTS_DIR, entry.name)).filter((f) => FONT_FILE.test(f)); } catch (e) { /* пропускаем */ }
      const faces = files.map((f) => ({
        url: 'fonts/' + encodeURIComponent(entry.name) + '/' + encodeURIComponent(f), // путь от index.html
        ...parseFace(f),
      }));
      if (faces.length) families.push({ family: entry.name, faces });
    } else if (FONT_FILE.test(entry.name)) {
      families.push({
        family: entry.name.replace(FONT_FILE, '').replace(/[-_]+/g, ' '),
        faces: [{ url: 'fonts/' + encodeURIComponent(entry.name), ...parseFace(entry.name) }],
      });
    }
  }
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

// Языки интерфейса: каждый файл locales/*.json — отдельный язык { "name", "code", "strings": { "русская фраза": "перевод" } }.
// Английский встроен в приложение, поэтому файл для него не нужен.
const LOCALES_DIR = path.join(__dirname, 'locales');

function listLocales() {
  let names = [];
  try { names = fs.readdirSync(LOCALES_DIR).filter((f) => /\.json$/i.test(f)); } catch (e) { return []; }
  const out = [];
  for (const file of names) {
    try {
      const full = path.join(LOCALES_DIR, file);
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
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const winOf = (event) => BrowserWindow.fromWebContents(event.sender);

// значок приложения: окно, панель задач, Alt+Tab (icon.ico для Windows, icon.png для остальных систем)
const ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

function createWindow() {
  const win = new BrowserWindow({
    icon: fs.existsSync(ICON) ? ICON : undefined,
    width: 1200,
    height: 760,
    minWidth: 960,
    minHeight: 560,
    backgroundColor: '#161616',
    autoHideMenuBar: true,
    title: 'Music Player',

    // системный бар убран целиком, включая кнопки окна: их рисует само приложение (см. renderer.js)
    titleBarStyle: 'hidden',
    titleBarOverlay: false, // системных кнопок окна нет вообще
    trafficLightPosition: { x: 14, y: 11 }, // только macOS: там остаются системные кнопки

    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });

  // сообщаем окну приложения, развёрнуто ли оно, чтобы кнопка меняла значок
  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));

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
ipcMain.handle('wallpaper:pick', async (e) => {
  const options = {
    title: 'Выберите картинку для обоев',
    properties: ['openFile'],
    filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'] }],
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
ipcMain.handle('locales:list', () => listLocales());
ipcMain.handle('locales:open-folder', async () => {
  await fs.promises.mkdir(LOCALES_DIR, { recursive: true });
  return shell.openPath(LOCALES_DIR);
});
ipcMain.handle('fonts:list', () => listFonts());
ipcMain.handle('fonts:open-folder', async () => {
  await fs.promises.mkdir(FONTS_DIR, { recursive: true });
  return shell.openPath(FONTS_DIR);
});
ipcMain.handle('app:support', () => readSupport());
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

app.setAppUserModelId('com.musicplayer.app'); // чтобы Windows показывала значок приложения в панели задач и в уведомлениях

app.whenReady().then(() => {
  // защищённый DNS (DoH), как в браузере: провайдерский DNS может подменять адреса заблокированных сайтов,
  // и тогда окно приложения видит чужой сертификат (ERR_CERT_COMMON_NAME_INVALID). Если DoH недоступен, остаётся обычный DNS
  try {
    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: 'automatic',
      secureDnsServers: ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'],
    });
  } catch (e) { /* ничего */ }
  // hls.js читает звук VK через XHR, а сервера VK не разрешают это странице из файла: добавляем разрешение к их ответам
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*.vkuser.net/*', 'https://*.vkuseraudio.net/*', 'https://*.vkuseraudio.ru/*', 'https://*.vk-cdn.net/*'] }, (d, done) => {
    const h = { ...d.responseHeaders };
    Object.keys(h).filter((k) => /^access-control-allow-origin$/i.test(k)).forEach((k) => delete h[k]);
    h['Access-Control-Allow-Origin'] = ['*'];
    done({ responseHeaders: h });
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
