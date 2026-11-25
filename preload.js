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
    searchMore: (cursor) => ipcRenderer.invoke('sc:search-more', cursor), // следующая порция выдачи по курсору из ответа search
    openLink: (url) => ipcRenderer.invoke('sc:open-link', url),
    like: (track, on) => ipcRenderer.invoke('sc:like', { scId: track && track.scId }, !!on), // поставить или снять лайк в аккаунте
    likePlaylist: (pl, on) => ipcRenderer.invoke('sc:like-playlist', { scId: pl && pl.scId }, !!on), // лайк плейлиста или альбома
  },


  // VK Музыка: вход через окно сайта; cookie остаются в основном процессе
  vk: {
    status: () => ipcRenderer.invoke('vk:status'),
    login: () => ipcRenderer.invoke('vk:login'),
    logout: () => ipcRenderer.invoke('vk:logout'),
    library: () => ipcRenderer.invoke('vk:library'),
    stream: (vkId, hash) => ipcRenderer.invoke('vk:stream', vkId, hash), // свежая ссылка на звук трека
    playlist: (ref) => ipcRenderer.invoke('vk:playlist', { owner: ref && ref.owner, id: ref && ref.id, hash: ref && ref.hash }), // треки и метаданные плейлиста
    search: (query) => ipcRenderer.invoke('vk:search', String(query || '')),
    playlistCounts: (refs) => ipcRenderer.invoke('vk:playlist-counts', Array.isArray(refs) ? refs.map((r) => ({ owner: r.owner, id: r.id, hash: r.hash })) : []), // число треков плейлистов списком
    searchMore: (cursor) => ipcRenderer.invoke('vk:search-more', cursor && { sectionId: cursor.sectionId, nextFrom: cursor.nextFrom, startFrom: cursor.startFrom, blockId: cursor.blockId }),
    artist: (ref) => ipcRenderer.invoke('vk:artist', { id: ref && ref.id, slug: ref && ref.slug, name: ref && ref.name }), // номер и имя передаются строками
    artistSection: (ref, section) => ipcRenderer.invoke('vk:artist-section', { id: ref && ref.id, slug: ref && ref.slug, name: ref && ref.name }, String(section || '')), // top_audios | releases | singles | albums
    openLink: (url) => ipcRenderer.invoke('vk:open-link', url),
    like: (track, on) => ipcRenderer.invoke('vk:like', { vkId: track && track.vkId, hash: track && track.hash, trackCode: track && track.trackCode }, !!on), // добавить трек в аудиозаписи или убрать
  },

  // YouTube Music: вход через окно Google; cookie остаются в основном процессе. Звук и видео играет страница сайта в <webview> под интерфейсом,
  // а здесь только команды: attach / play / state / control / video / stop
  ytmusic: {
    status: () => ipcRenderer.invoke('yt:status'),
    login: () => ipcRenderer.invoke('yt:login'),
    logout: () => ipcRenderer.invoke('yt:logout'),
    library: () => ipcRenderer.invoke('yt:library'),
    search: (query) => ipcRenderer.invoke('yt:search', String(query || '')),
    playlist: (ref) => ipcRenderer.invoke('yt:playlist', { url: ref && ref.url }),
    like: (track, on) => ipcRenderer.invoke('yt:like', { ytId: track && track.ytId }, !!on),
    user: (ref) => ipcRenderer.invoke('yt:artist', { url: ref && ref.url }), // страница исполнителя по адресу канала
    track: (ref) => ipcRenderer.invoke('yt:track', { url: ref && ref.url }), // страница трека: «Дальше», разделы, признак текста песни
    trackSection: (ref) => ipcRenderer.invoke('yt:track-section', { videoId: String((ref && ref.videoId) || ''), chip: Number(ref && ref.chip) || 0 }), // другой раздел «Дальше»
    lyrics: (ref) => ipcRenderer.invoke('yt:lyrics', { videoId: String((ref && ref.videoId) || '') }),
    attach: (webContentsId) => ipcRenderer.invoke('yt:attach', Number(webContentsId)), // сообщить главному процессу номер <webview> плеера
    play: (videoId, volume, video) => ipcRenderer.invoke('yt:play', String(videoId || ''), Number(volume), !!video), // video: клипы включены, страница сразу переключится на «Video»
    state: () => ipcRenderer.invoke('yt:state'),
    control: (cmd, arg) => ipcRenderer.invoke('yt:control', String(cmd), Number(arg) || 0), // pause | resume | seek | volume
    video: (on) => ipcRenderer.invoke('yt:video', !!on),
    stop: () => ipcRenderer.invoke('yt:stop'),
    openLink: (url) => ipcRenderer.invoke('yt:open-link', url),
    onVideo: (callback) => ipcRenderer.on('yt:video', (_event, v) => callback(v === 'none' ? 'none' : !!v)), // true: клип идёт; false: клипа пока нет; 'none': у трека нет клипа
  },

  // языки интерфейса из локальной папки languages
  listLanguages: () => ipcRenderer.invoke('languages:list'),
  openLanguagesFolder: () => ipcRenderer.invoke('languages:open-folder'),

  // масштаб всего интерфейса (1 = 100%)
  setZoom: (factor) => { const f = Number(factor); if (f >= 0.5 && f <= 3) webFrame.setZoomFactor(f); },

  // обои
  getWallpaper: () => ipcRenderer.invoke('wallpaper:get'),
  readWallpaper: () => ipcRenderer.invoke('wallpaper:read'),
  pickWallpaper: (labels) => ipcRenderer.invoke('wallpaper:pick', { title: labels && labels.title, filter: labels && labels.filter }), // подписи окна выбора файла, на языке интерфейса
  clearWallpaper: () => ipcRenderer.invoke('wallpaper:clear'),

  // оформление одним файлом: настройки внешнего вида и обои (подписи окон приходят на языке интерфейса)
  exportTheme: (look, labels) => ipcRenderer.invoke('theme:export', look, { title: labels && labels.title, filter: labels && labels.filter, name: labels && labels.name }),
  importTheme: (labels) => ipcRenderer.invoke('theme:import', { title: labels && labels.title, filter: labels && labels.filter }),

  appInfo: () => ipcRenderer.invoke('app:info'),
  patchNotes: () => ipcRenderer.invoke('app:patchnotes'),

  // поведение окна: крестик закрывает сразу или прячет в трей; подписи меню значка в трее
  windowBehavior: {
    get: () => ipcRenderer.invoke('window:get-config'),
    setCloseToTray: (on) => ipcRenderer.invoke('window:set-close-to-tray', !!on),
    setTrayLabels: (labels) => ipcRenderer.invoke('window:set-tray-labels', { open: labels && labels.open, quit: labels && labels.quit }),
  },

  // автообновление: состояние, выключатель, проверка вручную, установка скачанного
  updates: {
    get: () => ipcRenderer.invoke('updates:get'),
    setAuto: (on) => ipcRenderer.invoke('updates:set-auto', !!on),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (callback) => ipcRenderer.on('updates:status', (_event, state) => callback(state)),
  },

  // ссылки для раздела «Поддержать проект» (из support.json)
  supportConfig: () => ipcRenderer.invoke('app:support'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
});
