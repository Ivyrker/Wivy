// Безопасный мост между окном приложения и главным процессом.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  // свои кнопки окна
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    onMaximizeChange: (callback) => ipcRenderer.on('win:maximized', (_event, value) => callback(!!value)),
  },

  // шрифты из локальной папки fonts
  listFonts: () => ipcRenderer.invoke('fonts:list'),
  openFontsFolder: () => ipcRenderer.invoke('fonts:open-folder'),

  // SoundCloud: вход, выход и библиотека (токены остаются в основном процессе)
  soundcloud: {
    status: () => ipcRenderer.invoke('sc:status'),
    login: () => ipcRenderer.invoke('sc:login'),
    logout: () => ipcRenderer.invoke('sc:logout'),
    library: () => ipcRenderer.invoke('sc:library'),
    stream: (trackId) => ipcRenderer.invoke('sc:stream', trackId), // ссылка на звук трека
    // страницы; ref = { id } или { url } (адрес на soundcloud.com)
    track: (ref) => ipcRenderer.invoke('sc:track', ref),
    user: (ref) => ipcRenderer.invoke('sc:user', ref),
    playlist: (ref) => ipcRenderer.invoke('sc:playlist', ref),
    search: (query) => ipcRenderer.invoke('sc:search', query),
    openLink: (url) => ipcRenderer.invoke('sc:open-link', url),
  },


  // VK Музыка: вход через окно сайта; cookie остаются в основном процессе
  vk: {
    status: () => ipcRenderer.invoke('vk:status'),
    login: () => ipcRenderer.invoke('vk:login'),
    logout: () => ipcRenderer.invoke('vk:logout'),
    library: () => ipcRenderer.invoke('vk:library'),
    stream: (vkId, hash) => ipcRenderer.invoke('vk:stream', vkId, hash), // свежая ссылка на звук трека
  },

  // языки интерфейса из локальной папки locales
  listLocales: () => ipcRenderer.invoke('locales:list'),
  openLocalesFolder: () => ipcRenderer.invoke('locales:open-folder'),

  // масштаб всего интерфейса (1 = 100%)
  setZoom: (factor) => { const f = Number(factor); if (f >= 0.5 && f <= 3) webFrame.setZoomFactor(f); },

  // обои
  getWallpaper: () => ipcRenderer.invoke('wallpaper:get'),
  readWallpaper: () => ipcRenderer.invoke('wallpaper:read'),
  pickWallpaper: () => ipcRenderer.invoke('wallpaper:pick'),
  clearWallpaper: () => ipcRenderer.invoke('wallpaper:clear'),

  appInfo: () => ipcRenderer.invoke('app:info'),

  // ссылки для раздела «Поддержать проект» (из support.json)
  supportConfig: () => ipcRenderer.invoke('app:support'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
});
