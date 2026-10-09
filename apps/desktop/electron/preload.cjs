const { contextBridge, ipcRenderer } = require('electron');
const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('desktop', {
  loadLibrary: () => invoke('library:load'),
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
