const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('desktop', {
  listBackups: () => invoke('backup:list'),
  createBackup: () => invoke('backup:create'),
  restoreBackup: id => invoke('backup:restore', id),
  updateCache: () => invoke('update:cache'),
  clearUpdateCache: () => invoke('update:clearCache'),
  updateState: () => invoke('update:state'),
  checkUpdate: () => invoke('update:check'),
  downloadUpdate: () => invoke('update:download'),
  cancelUpdate: () => invoke('update:cancel'),
  installUpdate: () => invoke('update:install'),
  openRelease: () => invoke('update:openRelease'),
  onUpdate: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  loadSession: () => invoke('session:load'),
  saveSession: input => invoke('session:save', input),
  setCloseBehavior: value => invoke('session:closeBehavior', value),
  onCloseBehavior: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('session:closeBehaviorChanged', listener);
    return () => ipcRenderer.removeListener('session:closeBehaviorChanged', listener);
  },
  playerStatus: input => invoke('player:status', input),
  onSaveRequest: callback => {
    const listener = async (_event, id) => {
      try { await callback(); } catch { /* Save failures are surfaced by renderer IPC handling. */ }
      finally { ipcRenderer.send('session:flushed', id); }
    };
    ipcRenderer.on('session:flush', listener);
    return () => ipcRenderer.removeListener('session:flush', listener);
  },
  loadLibrary: () => invoke('library:load'),
  dataNotice: () => invoke('library:notice'),
  saveLibrary: input => invoke('library:save', input),
  exportLibrary: () => invoke('library:export'),
  importLibrary: () => invoke('library:import'),
  search: (keyword, page) => invoke('api:search', keyword, page),
  stream: (bvid, cid) => invoke('api:stream', bvid, cid),
  account: () => invoke('api:account'),
  qrGenerate: () => invoke('api:qrGenerate'),
  qrPoll: key => invoke('api:qrPoll', key),
  logout: () => invoke('api:logout'),
  favorites: () => invoke('api:favorites'),
  favoriteTracks: (id, page) => invoke('api:favoriteTracks', id, page),
  windowControl: action => invoke('window:control', action),
  onPlayerCommand: callback => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('player:command', listener);
    return () => ipcRenderer.removeListener('player:command', listener);
  },
});
