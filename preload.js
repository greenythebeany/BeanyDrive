const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  onWindowState: (cb) => ipcRenderer.on('window:state', (e, state) => cb(state)),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  testConnection: (payload) => ipcRenderer.invoke('settings:testConnection', payload),

  getStatus: () => ipcRenderer.invoke('drive:status'),
  onStatus: (cb) => ipcRenderer.on('drive:status', (e, data) => cb(data)),
  onUpdate: (cb) => ipcRenderer.on('drive:update', (e, data) => cb(data)),
  onUploadProgress: (cb) => ipcRenderer.on('drive:uploadProgress', (e, data) => cb(data)),
  onUploadDone: (cb) => ipcRenderer.on('drive:uploadDone', (e, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('drive:downloadProgress', (e, data) => cb(data)),

  pickFiles: () => ipcRenderer.invoke('files:pickFiles'),
  upload: (paths, destFolder) => ipcRenderer.invoke('drive:upload', { paths, destFolder }),
  download: (fileId, name) => ipcRenderer.invoke('drive:download', { fileId, name }),
  copyLink: (fileId) => ipcRenderer.invoke('drive:copyLink', { fileId }),

  trash: (fileId) => ipcRenderer.invoke('drive:trash', { fileId }),
  restore: (fileId) => ipcRenderer.invoke('drive:restore', { fileId }),
  emptyTrash: () => ipcRenderer.invoke('drive:emptyTrash'),
  star: (fileId, value) => ipcRenderer.invoke('drive:star', { fileId, value }),
  rename: (fileId, name) => ipcRenderer.invoke('drive:rename', { fileId, name }),
  addTag: (fileId, tag) => ipcRenderer.invoke('drive:addTag', { fileId, tag }),
  removeTag: (fileId, tag) => ipcRenderer.invoke('drive:removeTag', { fileId, tag }),
  createFolder: (folderPath) => ipcRenderer.invoke('drive:createFolder', { folderPath }),
  deleteFolder: (folderPath) => ipcRenderer.invoke('drive:deleteFolder', { folderPath }),
  refresh: () => ipcRenderer.invoke('drive:refresh'),
});
