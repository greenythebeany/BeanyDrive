const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  onWindowState: (cb) => ipcRenderer.on('window:state', (e, state) => cb(state)),

  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (e, info) => cb(info)),
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  testConnection: (payload) => ipcRenderer.invoke('settings:testConnection', payload),

  getStatus: () => ipcRenderer.invoke('drive:status'),
  onStatus: (cb) => ipcRenderer.on('drive:status', (e, data) => cb(data)),
  onUpdate: (cb) => ipcRenderer.on('drive:update', (e, data) => cb(data)),
  // Full snapshot of every upload row on any change — simpler to keep correct
  // than patching individual rows as they start, pause, fail, and resume.
  onUploads: (cb) => ipcRenderer.on('drive:uploads', (e, data) => cb(data)),
  onUploadDone: (cb) => ipcRenderer.on('drive:uploadDone', (e, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('drive:downloadProgress', (e, data) => cb(data)),
  // Long-running drive operations that aren't uploads (currently Empty Trash).
  onTaskProgress: (cb) => ipcRenderer.on('drive:taskProgress', (e, data) => cb(data)),
  onTaskDone: (cb) => ipcRenderer.on('drive:taskDone', (e, data) => cb(data)),

  // Drag out to Explorer/Finder: prepare fetches a local copy, startDrag hands
  // that copy to the OS. Send, not invoke — startDrag must run inside the
  // dragstart gesture.
  onDragCache: (cb) => ipcRenderer.on('drive:dragCache', (e, data) => cb(data)),
  prepareDrag: (fileId) => ipcRenderer.invoke('drive:prepareDrag', { fileId }),
  startDrag: (fileId) => ipcRenderer.send('drive:startDrag', { fileId }),
  onPreviewProgress: (cb) => ipcRenderer.on('drive:previewProgress', (e, data) => cb(data)),

  // Electron 32 dropped the File.path augmentation the renderer used to read
  // off dropped/picked files; webUtils.getPathForFile is the replacement.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; }
  },

  pickFiles: () => ipcRenderer.invoke('files:pickFiles'),
  upload: (paths, destFolder) => ipcRenderer.invoke('drive:upload', { paths, destFolder }),
  cancelUpload: (uploadId) => ipcRenderer.invoke('drive:cancelUpload', { uploadId }),
  pauseUpload: (uploadId) => ipcRenderer.invoke('drive:pauseUpload', { uploadId }),
  resumeUpload: (uploadId) => ipcRenderer.invoke('drive:resumeUpload', { uploadId }),
  download: (fileId, name) => ipcRenderer.invoke('drive:download', { fileId, name }),
  copyLink: (fileId) => ipcRenderer.invoke('drive:copyLink', { fileId }),
  previewFile: (fileId) => ipcRenderer.invoke('drive:preview', { fileId }),

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
