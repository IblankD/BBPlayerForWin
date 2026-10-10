import { app, BrowserWindow, ipcMain, protocol, safeStorage, session, dialog, globalShortcut, Tray, Menu, screen, net, shell } from 'electron';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BilibiliClient } from './api.mjs';
import { validateLibrary, validateSession } from './core.mjs';
import { ReleaseUpdater, fetchWithElectron } from './updater.mjs';
import { LibraryStorage, decodeLibrary, decodeSession, encodeSession } from './storage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const devUrl = !app.isPackaged && process.env.BBPLAYER_DEV_URL === 'http://127.0.0.1:5173' ? process.env.BBPLAYER_DEV_URL : null;
if (process.env.BBPLAYER_TEST_DATA && !app.isPackaged) app.setPath('userData', process.env.BBPLAYER_TEST_DATA);
// Support an isolated profile for diagnostics, just as Chromium does.
if (app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.resolve(app.commandLine.getSwitchValue('user-data-dir')));
protocol.registerSchemesAsPrivileged([
  { scheme: 'bbapp', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'bbmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
]);
let window;
let client;
let library;
let playerSession = validateSession();
let updater;
let storage;
let updateTimer;
let tray;
let trayMenu;
let quitting = false;
let closeDialog = false;
let captureGeometry = async () => {};
let playerInfo = { title: '', playing: false };
let flushSequence = 0;
const flushWaiters = new Map();
let writing = Promise.resolve();
const defaults = () => ({ playlists: [{ id: 'liked', name: '我喜欢的音乐', tracks: [] }], history: [], lyrics: {}, volume: 0.7, repeat: 'all' });
const location = name => path.join(app.getPath('userData'), name);
async function atomicWrite(name, content) {
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(location(`${name}.tmp`), content);
  await rename(location(`${name}.tmp`), location(name));
}
function enqueueWrite(name, content) {
  const next = writing.catch(() => {}).then(() => atomicWrite(name, content));
  writing = next;
  return next;
}
function enqueueTask(task) { const next = writing.catch(() => {}).then(task); writing = next; return next; }
const saveSession = () => enqueueWrite('session.json', encodeSession(playerSession));
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
}
function refreshTray() {
  if (!tray) return;
  tray.setToolTip((playerInfo.title ? `${playerInfo.playing ? '正在播放' : '已暂停'} · ${playerInfo.title}` : 'BBPlayer') .slice(0, 120));
  trayMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { label: playerInfo.playing ? '暂停' : '播放', enabled: !!playerInfo.title, click: () => window?.webContents.send('player:command', 'toggle') },
    { label: '上一首', enabled: !!playerInfo.title, click: () => window?.webContents.send('player:command', 'previous') },
    { label: '下一首', enabled: !!playerInfo.title, click: () => window?.webContents.send('player:command', 'next') },
    { type: 'separator' },
    { label: '退出 BBPlayer', click: () => app.quit() },
  ]);
  tray.setContextMenu(trayMenu);
}
async function flushRenderer() {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  const id = ++flushSequence;
  await new Promise(resolve => {
    const timer = setTimeout(() => { flushWaiters.delete(id); resolve(); }, 2000);
    flushWaiters.set(id, () => { clearTimeout(timer); flushWaiters.delete(id); resolve(); });
    window.webContents.send('session:flush', id);
  });
}
ipcMain.on('session:flushed', (event, id) => { try { trusted(event); flushWaiters.get(id)?.(); } catch { /* Ignore foreign frames. */ } });
function trusted(event) {
  const url = event.senderFrame?.url || '';
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !(url.startsWith('bbapp://bundle/') || (devUrl && new URL(url).origin === devUrl))) throw new Error('请求来源无效');
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : '操作失败' }; }
  });
}
async function initialize() {
  updater = new ReleaseUpdater({ version: app.getVersion(), portable: !!process.env.PORTABLE_EXECUTABLE_FILE, enabled: app.isPackaged, directory: location('updates'), fetcher: (url, options) => fetchWithElectron(net, url, options), notify: state => { if (window && !window.isDestroyed()) window.webContents.send('update:state', state); }, openExternal: url => shell.openExternal(url), launchInstaller: file => shell.openPath(file), prepareInstall: async () => { await flushRenderer(); await writing; }, quit: () => app.quit() });
  handle('update:state', () => updater.state);
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.download());
  handle('update:cancel', () => updater.cancel());
  handle('update:install', () => updater.install());
  handle('update:openRelease', () => updater.openRelease());
  await updater.clearCache().catch(() => {});
  handle('update:cache', () => updater.cacheInfo());
  handle('update:clearCache', () => updater.clearCache());
  try { playerSession = decodeSession(JSON.parse(await readFile(location('session.json'), 'utf8'))); }
  catch (error) { if (error.code === 'SCHEMA_VERSION') throw error; }
  storage = new LibraryStorage(app.getPath('userData'), defaults);
  const loaded = await storage.load(); library = loaded.library;
  handle('library:notice', () => loaded.notice);
  handle('backup:list', () => enqueueTask(() => storage.list()));
  handle('backup:create', () => enqueueTask(() => storage.backup()));
  handle('backup:restore', async id => {
    const result = await dialog.showMessageBox(window, { type: 'question', title: '恢复歌单备份', message: '用此备份替换当前歌单、历史、歌词与播放设置？', detail: '恢复前会自动备份当前数据。播放队列与登录状态保留。', buttons: ['恢复备份', '取消'], defaultId: 1, cancelId: 1 });
    if (result.response !== 0) return null;
    await flushRenderer();
    return enqueueTask(async () => { library = await storage.restore(id); return library; });
  });
  let cookie = '';
  try { cookie = safeStorage.decryptString(await readFile(location('account.bin'))); } catch { /* First launch or expired OS credentials. */ }
  client = new BilibiliClient({ cookie, onCookie: async value => {
    if (value && !safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密不可用，无法安全保存登录');
    await enqueueWrite('account.bin', value ? safeStorage.encryptString(value) : Buffer.alloc(0));
  } });
  handle('library:load', () => library);
  handle('session:load', () => playerSession);
  handle('session:save', async input => {
    playerSession = validateSession({ ...input, closeBehavior: playerSession.closeBehavior });
    await saveSession();
  });
  handle('session:closeBehavior', async value => {
    if (!['ask', 'tray', 'quit'].includes(value)) throw new Error('关闭方式无效');
    playerSession.closeBehavior = value; await saveSession();
    window?.webContents.send('session:closeBehaviorChanged', value);
  });
  handle('player:status', input => {
    playerInfo = { title: typeof input?.title === 'string' ? input.title.slice(0, 500) : '', playing: input?.playing === true };
    refreshTray();

  });
  handle('library:save', async input => { const next = validateLibrary(input); await enqueueTask(async () => { await storage.save(next); library = next; }); });
  handle('library:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(window, { title: '导出歌单备份', defaultPath: 'BBPlayer-library.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (canceled || !filePath) return false;
    await writeFile(filePath, JSON.stringify(library, null, 2)); return true;
  });
  handle('library:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, { title: '导入歌单备份', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (canceled) return null;
    const raw = await readFile(filePaths[0], 'utf8');
    if (raw.length > 20 * 1024 * 1024) throw new Error('备份文件过大');
    const incoming = decodeLibrary(JSON.parse(raw));
    const playlists = library.playlists.map(p => ({ ...p, tracks: [...p.tracks] }));
    for (const p of incoming.playlists) {
      const existing = playlists.find(item => item.id === p.id);
      if (existing) { const known = new Set(existing.tracks.map(t => t.bvid)); existing.tracks = [...existing.tracks, ...p.tracks.filter(t => !known.has(t.bvid))]; }
      else playlists.push(p);
    }
    const next = validateLibrary({ ...library, playlists, lyrics: { ...library.lyrics, ...incoming.lyrics } });
    await enqueueTask(async () => { await storage.save(next, true); library = next; }); return library;
  });
  handle('api:search', (keyword, page) => client.search(keyword, page));
  handle('api:stream', (bvid, cid) => client.stream(bvid, cid));
  handle('api:account', () => client.account());
  handle('api:qrGenerate', () => client.qrGenerate());
  handle('api:qrPoll', key => client.qrPoll(key));
  handle('api:logout', () => client.logout());
  handle('api:favorites', () => client.favorites());
  handle('api:favoriteTracks', (id, page) => client.favoriteTracks(id, page));
  handle('window:control', action => { if (action === 'minimize') window.minimize(); else if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); } else if (action === 'close') window.close(); else if (action === 'quit') app.quit(); });
}
async function createWindow() {
  let savedWindow;
  try {
    const value = JSON.parse(await readFile(location('window.json'), 'utf8'));
    const b = value.bounds;
    if (b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k])) && b.width >= 980 && b.height >= 680 && b.width <= 10000 && b.height <= 10000 && screen.getAllDisplays().some(d => b.x < d.workArea.x + d.workArea.width && b.x + b.width > d.workArea.x + 100 && b.y < d.workArea.y + d.workArea.height && b.y + 100 > d.workArea.y)) savedWindow = value;
  } catch { /* Default geometry on first launch. */ }
  window = new BrowserWindow({ width: 1280, height: 850, ...savedWindow?.bounds, minWidth: 980, minHeight: 680, frame: false, backgroundColor: '#f6f9fc', title: 'BBPlayer', icon: path.join(here, '../build/icon.ico'), show: false, webPreferences: { preload: path.join(here, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, backgroundThrottling: false } });
  // setBounds round-trips Windows frameless geometry without constructor frame padding.
  if (savedWindow) window.setBounds(savedWindow.bounds);
  if (savedWindow?.maximized) window.maximize();
  let geometryTimer;
  const saveGeometry = () => {
    const bounds = window.getNormalBounds();
    // Fractional Windows display scaling may round by a pixel. Keep the persisted
    // baseline for that rounding so every restart does not grow the window.
    const unchanged = savedWindow && ['x', 'y', 'width', 'height'].every(k => Math.abs(bounds[k] - savedWindow.bounds[k]) <= 2);
    return enqueueWrite('window.json', JSON.stringify({ bounds: unchanged ? savedWindow.bounds : bounds, maximized: window.isMaximized() }));
  };
  captureGeometry = saveGeometry;
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) window.on(event, () => { clearTimeout(geometryTimer); geometryTimer = setTimeout(() => { void saveGeometry().catch(() => {}); }, 500); });
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (closeDialog) return;
    closeDialog = true;
    void (async () => {
      let behavior = playerSession.closeBehavior;
      if (behavior === 'ask') {
        const result = await dialog.showMessageBox(window, { type: 'question', title: '关闭 BBPlayer', message: '关闭窗口后如何处理？', buttons: ['后台播放', '退出程序', '取消'], defaultId: 0, cancelId: 2, checkboxLabel: '记住我的选择', checkboxChecked: false });
        if (result.response === 2) return;
        behavior = result.response === 0 ? 'tray' : 'quit';
        if (result.checkboxChecked) { playerSession.closeBehavior = behavior; await saveSession(); window.webContents.send('session:closeBehaviorChanged', behavior); }
      }
      await saveGeometry();
      if (behavior === 'tray' && tray) { await flushRenderer(); window.hide(); }
      else app.quit();
    })().catch(() => showWindow()).finally(() => { closeDialog = false; });
  });
  window.on('closed', () => clearTimeout(geometryTimer));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== (devUrl || 'bbapp://bundle/index.html')) event.preventDefault(); });
  window.once('ready-to-show', () => window.show());
  await window.loadURL(devUrl || 'bbapp://bundle/index.html');
}
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    protocol.handle('bbapp', async request => {
      const url = new URL(request.url);
      const root = path.resolve(here, '../dist');
      const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (url.hostname !== 'bundle' || !file.startsWith(`${root}${path.sep}`)) return new Response('Forbidden', { status: 403 });
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      try {
        return new Response(await readFile(file), { headers: { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.hdslb.com; media-src bbmedia:; connect-src 'self' bbmedia:; object-src 'none'; base-uri 'none'; frame-src 'none'" } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    await initialize();
    protocol.handle('bbmedia', async request => {
      const url = new URL(request.url);
      if (url.hostname !== 'audio' || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
      try { return await client.fetchMedia(url.pathname.slice(1), request); } catch { return new Response('音频请求失败', { status: 502 }); }
    });
    await createWindow();
    tray = new Tray(path.join(here, '../build/icon.ico'));
    tray.on('double-click', showWindow);
    if (app.isPackaged) {
      updateTimer = setTimeout(() => { void updater.check(); updateTimer = setInterval(() => { void updater.check(); }, 6 * 3600000); }, 10000);
    }
    refreshTray();
    for (const [key, command] of [['MediaPlayPause', 'toggle'], ['MediaNextTrack', 'next'], ['MediaPreviousTrack', 'previous']]) globalShortcut.register(key, () => window?.webContents.send('player:command', command));
  }).catch(async error => { await dialog.showMessageBox({ type: 'error', message: 'BBPlayer 启动失败', detail: error.message }); app.quit(); });
}
app.on('window-all-closed', () => app.quit());
let drained = false;
app.on('before-quit', event => {
  if (drained) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void captureGeometry().catch(() => {}).then(flushRenderer).then(() => writing.catch(() => {})).finally(() => { drained = true; app.quit(); });
});
app.on('will-quit', () => { clearTimeout(updateTimer); clearInterval(updateTimer); updater?.cancel(); globalShortcut.unregisterAll(); tray?.destroy(); });
