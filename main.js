const { app, BrowserWindow, ipcMain, dialog, clipboard, protocol, net, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { DiscordDrive, testConnection, isCancelError, isPauseError } = require('./discord-client');
const driveConfig = require('./drive-config');
const { guessMime } = require('./util');
const { checkForUpdates } = require('./update-checker');
const { createResumeStore } = require('./upload-resume');
const { createRateTracker } = require('./upload-stats');
const { createDragCache } = require('./drag-cache');

const PREVIEW_MAX_BYTES = 500 * 1024 * 1024;

// Registered as a "standard" scheme (not plain file://) so the renderer has
// a real, non-opaque origin — file:// pages are treated as an opaque/null
// origin in Chromium, which silently breaks ES module dynamic import() and
// module Web Workers (both used by the vendored pdf.js preview renderer).
// Must run before app 'ready'.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWindow = null;
const drive = new DiscordDrive();

// Aborting an in-flight request (pause, cancel) can leave undici rejecting a
// promise internally, which Node reports as an unhandled rejection with no
// indication of where it came from. Log it with a marker instead of letting it
// print a bare warning — and don't let it take the process down.
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[BeanyDrive] unhandled rejection:', err.stack || err.message);
});

function pushStatus(message) {
  if (mainWindow) mainWindow.webContents.send('drive:status', { status: drive.status, message });
}

drive.on('status', (msg) => pushStatus(msg));
drive.on('error', (err) => pushStatus(`Error: ${err.message}`));
drive.on('ready', () => {
  if (mainWindow) mainWindow.webContents.send('drive:update', drive.snapshot());
  sweepAbandonedUploads();
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
    show: false,
    backgroundColor: '#0b0b0c',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL('app://bundle/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', 'maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', 'normal'));
}

async function autoConnect() {
  const settings = driveConfig.publicSettings();
  const token = driveConfig.getToken();
  if (!token || !settings.channelId) return;
  try {
    await drive.connect(token, settings.channelId, settings.chunkSizeMb, settings.uploadConcurrency);
  } catch (e) {
    // status/error already broadcast via the drive's own events
  }
}

// Chunks from uploads nobody ever resumed are the only way messages can go
// unreferenced; clearing them needs a connection, so it runs once we have one.
function sweepAbandonedUploads() {
  drive.sweepStaleResumes()
    .then((count) => { if (count) pushStatus(`Cleaned up ${count} chunk(s) from abandoned uploads`); })
    .catch(() => {});
}

app.whenReady().then(() => {
  const rendererRoot = path.join(__dirname, 'renderer');
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // app://bundle/<path> -> renderer/<path> ; app://bundle/ -> renderer/index.html
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filePath = path.normalize(path.join(rendererRoot, relative));
    if (!filePath.startsWith(rendererRoot)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filePath).toString());
  });

  drive.resumeStore = createResumeStore(path.join(app.getPath('userData'), 'uploads-resume.json'));
  dragCache = createDragCache(path.join(app.getPath('userData'), 'drag-cache'));
  dragCache.sweep().then(() => pushDragCache()).catch(() => {});

  createWindow();
  autoConnect();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Silent background check — only speaks up if something's actually newer.
  setTimeout(() => {
    checkForUpdates()
      .then((result) => {
        if (result.status === 'available' && mainWindow) {
          mainWindow.webContents.send('update:available', result);
        }
      })
      .catch(() => {});
  }, 4000);
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

// --- updates ---
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('update:check', async () => {
  try {
    return await checkForUpdates();
  } catch (e) {
    return { status: 'error', error: e.message };
  }
});
ipcMain.on('shell:openExternal', (e, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

// --- settings ---
ipcMain.handle('settings:get', () => driveConfig.publicSettings());

ipcMain.handle('settings:save', async (e, { token, channelId, chunkSizeMb, uploadConcurrency }) => {
  const saved = driveConfig.saveSettings({ token, channelId, chunkSizeMb, uploadConcurrency });
  const effectiveToken = token || driveConfig.getToken();
  if (effectiveToken && channelId) {
    try {
      await drive.connect(effectiveToken, channelId, chunkSizeMb || saved.chunkSizeMb, saved.uploadConcurrency);
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
let taskSeq = 0; // progress rows that aren't uploads: Empty Trash, drag prep
// Every upload the renderer has a row for, in row order. Unlike a plain queue
// these outlive the transfer: a paused or failed job stays here holding the
// state its Resume/Retry button needs.
const uploadJobs = [];
let pumping = false;
let statsTimer = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function jobSnapshot(job) {
  return {
    uploadId: job.uploadId,
    name: job.name,
    state: job.state,
    progress: job.progress,
    error: job.error || null,
    // Byte-rate only means something for a single file; a folder job reports
    // progress in files, so the renderer shows a plain percentage for those.
    bytesPerSec: job.isDirectory ? null : job.rate.bytesPerSec(),
    etaSeconds: job.isDirectory ? null : job.rate.etaSeconds(job.totalBytes),
  };
}

function pushUploads() {
  send('drive:uploads', uploadJobs.map(jobSnapshot));
}

// Speed and ETA have to keep moving while a single large chunk is in flight,
// and no progress callback fires for seconds at a time — so tick them.
function startStatsTicker() {
  if (statsTimer) return;
  statsTimer = setInterval(() => {
    if (uploadJobs.some((j) => j.state === 'running')) pushUploads();
    else stopStatsTicker();
  }, 1000);
}

function stopStatsTicker() {
  if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
}

function removeJob(job) {
  const idx = uploadJobs.indexOf(job);
  if (idx !== -1) uploadJobs.splice(idx, 1);
}

async function runJob(job) {
  job.state = 'running';
  job.error = null;
  job.paused = false;
  job.canceled = false;
  job.controller = new AbortController();
  // A resumed job's old samples are separated from the new ones by however long
  // it sat paused, which would read as a near-zero transfer rate.
  job.rate.reset();
  startStatsTicker();
  pushUploads();

  const control = {
    signal: job.controller.signal,
    isCanceled: () => job.canceled,
    isPaused: () => job.paused,
  };

  const onProgress = (cur, total) => {
    job.progress = total ? Math.round((cur / total) * 100) : 0;
    if (!job.isDirectory && job.totalBytes && drive.chunkSize) {
      // cur counts completed chunks; the last one is usually short, so cap it.
      job.rate.push(Math.min(job.totalBytes, cur * drive.chunkSize));
    }
    pushUploads();
  };

  try {
    const stat = fs.statSync(job.localPath);
    job.isDirectory = stat.isDirectory();
    job.totalBytes = job.isDirectory ? 0 : stat.size;

    if (job.isDirectory) {
      await drive.uploadFolder(job.localPath, job.destFolder, onProgress, control);
    } else {
      await drive.upload(job.localPath, job.destFolder, onProgress, control);
    }
    removeJob(job);
    send('drive:uploadDone', { uploadId: job.uploadId, name: job.name, ok: true });
  } catch (err) {
    if (isPauseError(err)) {
      // Chunks and resume record intentionally left in place.
      job.state = 'paused';
    } else if (isCancelError(err)) {
      removeJob(job);
      send('drive:uploadDone', { uploadId: job.uploadId, name: job.name, ok: false, canceled: true });
    } else {
      // The row survives so it can be retried — the resume record means a retry
      // re-sends only the chunks that didn't make it.
      job.state = 'failed';
      job.error = err.message;
      send('drive:uploadDone', { uploadId: job.uploadId, name: job.name, ok: false, error: err.message });
    }
  }
  pushUploads();
  pushUpdate();
}

async function pumpUploads() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const job = uploadJobs.find((j) => j.state === 'queued');
      if (!job) break;
      await runJob(job);
    }
  } finally {
    pumping = false;
    stopStatsTicker();
  }
}

function findJob(uploadId) {
  return uploadJobs.find((j) => j.uploadId === uploadId) || null;
}

ipcMain.handle('drive:upload', async (e, { paths, destFolder }) => {
  try {
    requireConnected();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  for (const p of paths) {
    uploadJobs.push({
      uploadId: `u${Date.now()}_${uploadSeq++}`,
      localPath: p,
      destFolder,
      name: path.basename(p),
      state: 'queued',
      progress: 0,
      error: null,
      isDirectory: false,
      totalBytes: 0,
      rate: createRateTracker(),
      controller: null,
      paused: false,
      canceled: false,
    });
  }
  pushUploads(); // rows for the whole batch appear at once, all controllable
  pumpUploads();
  return { ok: true };
});

ipcMain.handle('drive:pauseUpload', (e, { uploadId }) => {
  const job = findJob(uploadId);
  if (!job) return { ok: false, error: 'Upload already finished' };
  if (job.state === 'running') {
    job.paused = true;
    job.controller.abort(); // unwinds the in-flight chunk POSTs
  } else if (job.state === 'queued') {
    job.state = 'paused'; // never started; just don't pick it up
  } else {
    return { ok: false, error: `Cannot pause a ${job.state} upload` };
  }
  pushUploads();
  return { ok: true };
});

// Backs both Resume (paused) and Retry (failed) — same operation, and the
// resume record decides how much actually gets re-sent.
ipcMain.handle('drive:resumeUpload', (e, { uploadId }) => {
  const job = findJob(uploadId);
  if (!job) return { ok: false, error: 'Upload no longer queued' };
  if (job.state !== 'paused' && job.state !== 'failed') {
    return { ok: false, error: `Cannot resume a ${job.state} upload` };
  }
  job.state = 'queued';
  job.error = null;
  pushUploads();
  pumpUploads();
  return { ok: true };
});

ipcMain.handle('drive:cancelUpload', async (e, { uploadId }) => {
  const job = findJob(uploadId);
  if (!job) return { ok: false, error: 'Upload already finished' };

  if (job.state === 'running') {
    job.canceled = true;
    job.controller.abort();
    return { ok: true }; // runJob does the cleanup and removes the row
  }

  // Paused and failed jobs have chunks sitting in the channel that only their
  // resume record knows about; dropping the row without deleting them would
  // leave exactly the orphans the sweep exists to prevent.
  if (job.state === 'paused' || job.state === 'failed') {
    await drive.discardResumable(job.localPath, job.destFolder).catch(() => {});
  }
  removeJob(job);
  send('drive:uploadDone', { uploadId, name: job.name, ok: false, canceled: true });
  pushUploads();
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

// --- drag out to the desktop ---
// An OS drag needs a path that already exists, and these files live on Discord,
// so a drag-out is two steps: materialize a local copy, then drag it. The first
// drag of an uncached file starts the download and reports "try again".
let dragCache = null;
const dragPreparing = new Set();

async function pushDragCache() {
  if (!dragCache) return;
  const onDisk = new Set((await dragCache.list()).map((e) => e.name));
  const ready = drive.metadata.files
    .filter((f) => onDisk.has(path.basename(dragCache.pathFor(f.id, f.name))))
    .map((f) => f.id);
  send('drive:dragCache', { ready, preparing: [...dragPreparing] });
}

ipcMain.handle('drive:prepareDrag', async (e, { fileId }) => {
  try {
    requireConnected();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const entry = drive.getEntry(fileId);
  if (!entry) return { ok: false, error: 'File not found' };
  if (dragCache.resolve(entry.id, entry.name, entry.size)) return { ok: true, ready: true };
  if (dragPreparing.has(fileId)) return { ok: true, ready: false };

  dragPreparing.add(fileId);
  pushDragCache();
  const taskId = `t${Date.now()}_${taskSeq++}`;
  const label = `Preparing ${entry.name}`;
  send('drive:taskProgress', { taskId, label, progress: 0, detail: 'fetching…' });

  // Deliberately not awaited: the renderer gets its answer now and watches the
  // task row for the rest.
  (async () => {
    try {
      await drive.download(fileId, dragCache.tempPathFor(entry.id, entry.name), (cur, total) => {
        send('drive:taskProgress', {
          taskId, label, progress: Math.round((cur / total) * 100), detail: `${cur}/${total} chunks`,
        });
      });
      await dragCache.commit(entry.id, entry.name);
      send('drive:taskDone', { taskId, ok: true, message: `${entry.name} ready — drag it out now` });
    } catch (err) {
      await dragCache.discard(entry.id, entry.name);
      send('drive:taskDone', { taskId, ok: false, message: `Couldn't prepare ${entry.name}: ${err.message}` });
    } finally {
      dragPreparing.delete(fileId);
      pushDragCache();
    }
  })();

  return { ok: true, ready: false };
});

// Must be a send, not an invoke: startDrag has to run inside the dragstart
// gesture, and awaiting an invoke round trip loses it.
ipcMain.on('drive:startDrag', (e, { fileId }) => {
  if (!dragCache) return;
  const entry = drive.getEntry(fileId);
  if (!entry) return;
  const file = dragCache.resolve(entry.id, entry.name, entry.size);
  if (!file) return; // stale cache entry; the next prepare will refetch it
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 64, height: 64 });
  e.sender.startDrag({ file, icon });
});

// --- preview ---
// Reassembles the file in memory (see discord-client's fetchBytes) instead
// of writing to disk, so the renderer can show it without a Save As dialog.
ipcMain.handle('drive:preview', async (e, { fileId }) => {
  try {
    requireConnected();
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const entry = drive.getEntry(fileId);
  if (!entry) return { ok: false, error: 'File not found' };
  if (entry.size > PREVIEW_MAX_BYTES) {
    return { ok: false, error: `Too large to preview (${(entry.size / (1024 * 1024)).toFixed(1)} MB, limit ${PREVIEW_MAX_BYTES / (1024 * 1024)} MB) — download it instead.` };
  }
  try {
    const buf = await drive.fetchBytes(fileId, (cur, total) => {
      mainWindow.webContents.send('drive:previewProgress', { fileId, progress: Math.round((cur / total) * 100) });
    });
    return { ok: true, bytes: new Uint8Array(buf), mime: guessMime(entry.name), name: entry.name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
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
// Not a wrapMutation like its neighbours: emptying is the one mutation that
// can run for minutes (one DELETE per chunk), so it reports progress instead
// of leaving the window looking frozen until it returns.
ipcMain.handle('drive:emptyTrash', async () => {
  requireConnected();
  const taskId = `t${Date.now()}_${taskSeq++}`;
  const label = 'Emptying Trash';
  send('drive:taskProgress', { taskId, label, progress: 0, detail: 'preparing…' });
  try {
    const { files, chunks } = await drive.emptyTrash((done, total, name) => {
      send('drive:taskProgress', {
        taskId,
        label,
        progress: total ? Math.round((done / total) * 100) : 100,
        detail: total ? `${done}/${total} chunks${name ? ` · ${name}` : ''}` : 'nothing to delete',
      });
    });
    send('drive:taskDone', {
      taskId,
      ok: true,
      message: files ? `Trash emptied — ${files} file(s), ${chunks} chunk(s)` : 'Trash was already empty',
    });
    pushUpdate();
    return { files, chunks };
  } catch (err) {
    send('drive:taskDone', { taskId, ok: false, message: `Empty Trash failed: ${err.message}` });
    throw err;
  }
});
ipcMain.handle('drive:star', wrapMutation(({ fileId, value }) => drive.starFile(fileId, value)));
ipcMain.handle('drive:rename', wrapMutation(({ fileId, name }) => drive.renameFile(fileId, name)));
ipcMain.handle('drive:addTag', wrapMutation(({ fileId, tag }) => drive.addTag(fileId, tag)));
ipcMain.handle('drive:removeTag', wrapMutation(({ fileId, tag }) => drive.removeTag(fileId, tag)));
ipcMain.handle('drive:createFolder', wrapMutation(({ folderPath }) => drive.createFolder(folderPath)));
ipcMain.handle('drive:deleteFolder', wrapMutation(({ folderPath }) => drive.deleteFolder(folderPath)));
ipcMain.handle('drive:refresh', wrapMutation(() => drive.refresh()));
