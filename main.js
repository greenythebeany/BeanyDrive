const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { DiscordDrive, testConnection } = require('./discord-client');
const driveConfig = require('./drive-config');

let mainWindow = null;
const drive = new DiscordDrive();

function pushStatus(message) {
  if (mainWindow) mainWindow.webContents.send('drive:status', { status: drive.status, message });
}

drive.on('status', (msg) => pushStatus(msg));
drive.on('error', (err) => pushStatus(`Error: ${err.message}`));
drive.on('ready', () => {
  if (mainWindow) mainWindow.webContents.send('drive:update', drive.snapshot());
});

function pushUpdate() {
  if (mainWindow) mainWindow.webContents.send('drive:update', drive.snapshot());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 920,
    minHeight: 580,
    frame: false,
    backgroundColor: '#0b0b0c',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', 'normal'));
}

async function autoConnect() {
  const settings = driveConfig.publicSettings();
  const token = driveConfig.getToken();
  if (!token || !settings.channelId) return;
  try {
    await drive.connect(token, settings.channelId, settings.chunkSizeMb);
  } catch (e) {
    // status/error already broadcast via the drive's own events
  }
}

app.whenReady().then(() => {
  createWindow();
  autoConnect();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- window controls ---
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

// --- settings ---
ipcMain.handle('settings:get', () => driveConfig.publicSettings());

ipcMain.handle('settings:save', async (e, { token, channelId, chunkSizeMb }) => {
  const saved = driveConfig.saveSettings({ token, channelId, chunkSizeMb });
  const effectiveToken = token || driveConfig.getToken();
  if (effectiveToken && channelId) {
    try {
      await drive.connect(effectiveToken, channelId, chunkSizeMb || saved.chunkSizeMb);
    } catch (e2) {
      return { ok: false, error: e2.message, settings: saved };
    }
  }
  return { ok: true, settings: saved };
});

ipcMain.handle('settings:testConnection', async (e, { token, channelId }) => {
  try {
    const effectiveToken = token || driveConfig.getToken();
    const result = await testConnection(effectiveToken, channelId);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- drive state ---
ipcMain.handle('drive:status', () => drive.snapshot());

function requireConnected() {
  if (drive.status !== 'connected') throw new Error('Not connected. Check Settings.');
  return drive;
}

// --- upload ---
ipcMain.handle('files:pickFiles', async () => {
  if (!mainWindow) return [];
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  if (res.canceled) return [];
  return res.filePaths;
});

let uploadSeq = 0;
async function runUpload(paths, destFolder) {
  for (const p of paths) {
    const uploadId = `u${Date.now()}_${uploadSeq++}`;
    const name = path.basename(p);
    mainWindow.webContents.send('drive:uploadProgress', { uploadId, name, progress: 0 });
    try {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        await drive.uploadFolder(p, destFolder, (cur, total) => {
          mainWindow.webContents.send('drive:uploadProgress', { uploadId, name, progress: Math.round((cur / total) * 100) });
        });
      } else {
        await drive.upload(p, destFolder, (cur, total) => {
          mainWindow.webContents.send('drive:uploadProgress', { uploadId, name, progress: Math.round((cur / total) * 100) });
        });
      }
      mainWindow.webContents.send('drive:uploadDone', { uploadId, name, ok: true });
    } catch (err) {
      mainWindow.webContents.send('drive:uploadDone', { uploadId, name, ok: false, error: err.message });
    }
    pushUpdate();
  }
}

ipcMain.handle('drive:upload', async (e, { paths, destFolder }) => {
  try {
    requireConnected();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  runUpload(paths, destFolder);
  return { ok: true };
});

// --- download ---
ipcMain.handle('drive:download', async (e, { fileId, name }) => {
  requireConnected();
  if (!mainWindow) return { ok: false };
  const res = await dialog.showSaveDialog(mainWindow, { defaultPath: name });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try {
    await drive.download(fileId, res.filePath, (cur, total) => {
      mainWindow.webContents.send('drive:downloadProgress', { fileId, progress: Math.round((cur / total) * 100) });
    });
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('drive:copyLink', async (e, { fileId }) => {
  requireConnected();
  const { url, multiChunk } = await drive.getShareLink(fileId);
  clipboard.writeText(url);
  return { ok: true, multiChunk };
});

// --- mutations ---
function wrapMutation(fn) {
  return async (e, args) => {
    requireConnected();
    const result = await fn(args);
    pushUpdate();
    return result;
  };
}

ipcMain.handle('drive:trash', wrapMutation(({ fileId }) => drive.trashFile(fileId)));
ipcMain.handle('drive:restore', wrapMutation(({ fileId }) => drive.restoreFile(fileId)));
ipcMain.handle('drive:emptyTrash', wrapMutation(() => drive.emptyTrash()));
ipcMain.handle('drive:star', wrapMutation(({ fileId, value }) => drive.starFile(fileId, value)));
ipcMain.handle('drive:rename', wrapMutation(({ fileId, name }) => drive.renameFile(fileId, name)));
ipcMain.handle('drive:addTag', wrapMutation(({ fileId, tag }) => drive.addTag(fileId, tag)));
ipcMain.handle('drive:removeTag', wrapMutation(({ fileId, tag }) => drive.removeTag(fileId, tag)));
ipcMain.handle('drive:createFolder', wrapMutation(({ folderPath }) => drive.createFolder(folderPath)));
ipcMain.handle('drive:deleteFolder', wrapMutation(({ folderPath }) => drive.deleteFolder(folderPath)));
ipcMain.handle('drive:refresh', wrapMutation(() => drive.refresh()));
