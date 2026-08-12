'use strict';

// The Android app's replacement for main.js + preload.js.
//
// renderer/renderer.js is shared verbatim with the desktop build, and it talks
// to exactly one thing: `window.api`, the surface preload.js exposes over IPC.
// So the port isn't a rewrite of the UI — it's a second implementation of that
// same contract, backed by the core running inside the WebView instead of a
// Node process on the other side of a bridge.
//
// Scope of this build is browse + preview + download. Anything the desktop
// contract offers that Android can't do yet answers honestly rather than
// silently doing nothing — see NOT_YET below.

const { createApi } = require('../../core/discord-api');
const { DiscordDrive } = require('../../core/drive');
const { nativeFetch } = require('../../platform/capacitor-http');
const { capacitorFiles, registerFile, forgetFile } = require('../../platform/capacitor-files');
const { createRateTracker } = require('../../upload-stats');
const { isCancelError, isPauseError } = require('../../core/drive');
const { createResumeStore } = require('../../platform/capacitor-resume-store');
const { guessMimeFor } = require('./mime');
require('./mobile-ui'); // app bar, drawer, back button — pure UI, no drive access

const { Preferences } = require('@capacitor/preferences');
const { Filesystem, Directory } = require('@capacitor/filesystem');
const { Share } = require('@capacitor/share');
const { App } = require('@capacitor/app');

const SETTINGS_KEY = 'beanydrive_settings';
const TOKEN_KEY = 'beanydrive_token';
const PREVIEW_MAX_BYTES = 100 * 1024 * 1024; // lower than desktop: phone memory

const api = createApi({ fetchImpl: nativeFetch });
const drive = new DiscordDrive({ api, files: capacitorFiles });

// --- event fan-out, standing in for ipcRenderer.on -----------------------
const listeners = new Map();
function on(channel, cb) {
  if (!listeners.has(channel)) listeners.set(channel, []);
  listeners.get(channel).push(cb);
}
function emit(channel, payload) {
  for (const cb of listeners.get(channel) || []) {
    try { cb(payload); } catch (e) { /* a UI listener must not break the drive */ }
  }
}

drive.on('status', (message) => emit('status', { status: drive.status, message }));
drive.on('error', (err) => emit('status', { status: drive.status, message: `Error: ${err.message}` }));
drive.on('ready', () => emit('update', drive.snapshot()));

function pushUpdate() { emit('update', drive.snapshot()); }

// --- settings -------------------------------------------------------------
// The token lives in Preferences, which on Android is SharedPreferences —
// readable by anyone with root or a backup of the app's data. That's weaker
// than the desktop's safeStorage and should move to EncryptedSharedPreferences
// before this ships anywhere.
async function readSettings() {
  const { value } = await Preferences.get({ key: SETTINGS_KEY });
  const cfg = value ? JSON.parse(value) : {};
  const { value: token } = await Preferences.get({ key: TOKEN_KEY });
  return {
    channelId: cfg.channelId || '',
    chunkSizeMb: cfg.chunkSizeMb || 10,
    uploadConcurrency: cfg.uploadConcurrency || 4,
    hasToken: !!token,
    _token: token || null,
  };
}

function publicSettings(s) {
  return {
    channelId: s.channelId,
    chunkSizeMb: s.chunkSizeMb,
    uploadConcurrency: s.uploadConcurrency,
    hasToken: s.hasToken,
  };
}

async function connectFromSettings(settings) {
  if (!settings._token || !settings.channelId) return;
  try {
    await drive.connect(settings._token, settings.channelId, settings.chunkSizeMb, settings.uploadConcurrency);
  } catch (e) { /* status/error already broadcast by the drive's own events */ }
}

const ready = (async () => {
  drive.resumeStore = await createResumeStore();
  const settings = await readSettings();
  await connectFromSettings(settings);
})();

// --- downloads ------------------------------------------------------------
// No save dialog on Android: the file lands in the app's Documents directory
// and is then offered to the share sheet, which is how you get it into
// Downloads, Drive, or anywhere else.
let taskSeq = 0;
async function downloadToDevice(fileId, name) {
  await ready;
  const entry = drive.getEntry(fileId);
  if (!entry) return { ok: false, error: 'File not found' };

  const taskId = `t${Date.now()}_${taskSeq++}`;
  const label = `Downloading ${name}`;
  emit('taskProgress', { taskId, label, progress: 0, detail: 'starting…' });
  try {
    // Cache is always writable with no runtime permission, unlike Documents on
    // scoped storage. The share sheet is then how the file reaches Downloads,
    // Drive, or wherever the user actually wants it.
    const target = { path: name, directory: Directory.Cache };
    await drive.download(fileId, target, (cur, total) => {
      emit('taskProgress', {
        taskId, label, progress: Math.round((cur / total) * 100), detail: `${cur}/${total} chunks`,
      });
    });
    const { uri } = await Filesystem.getUri(target);
    emit('taskDone', { taskId, ok: true, message: `${name} ready — choose where to keep it` });
    try {
      await Share.share({ title: name, url: uri, dialogTitle: `Save or send ${name}` });
    } catch (e) { /* sheet dismissed; the file is still in the app's cache */ }
    return { ok: true, path: uri };
  } catch (err) {
    emit('taskDone', { taskId, ok: false, message: `Download failed: ${err.message}` });
    return { ok: false, error: err.message };
  }
}

// --- uploads --------------------------------------------------------------
// Same job model as the desktop: a queue whose entries outlive their transfer
// so a paused or failed one still has the state its Resume/Retry button needs.
// The renderer is fed the same snapshot shape, so its rows work unchanged.
let uploadSeq = 0;
const uploadJobs = [];
let pumping = false;
let statsTimer = null;

function jobSnapshot(job) {
  return {
    uploadId: job.uploadId,
    name: job.name,
    state: job.state,
    progress: job.progress,
    error: job.error || null,
    bytesPerSec: job.rate.bytesPerSec(),
    etaSeconds: job.rate.etaSeconds(job.totalBytes),
  };
}
function pushUploads() { emit('uploads', uploadJobs.map(jobSnapshot)); }

function startStatsTicker() {
  if (statsTimer) return;
  statsTimer = setInterval(() => {
    if (uploadJobs.some((j) => j.state === 'running')) pushUploads();
    else { clearInterval(statsTimer); statsTimer = null; }
  }, 1000);
}

function removeJob(job) {
  const idx = uploadJobs.indexOf(job);
  if (idx !== -1) uploadJobs.splice(idx, 1);
  forgetFile(job.handle);
}

async function runJob(job) {
  job.state = 'running';
  job.error = null;
  job.paused = false;
  job.canceled = false;
  job.controller = new AbortController();
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
    if (job.totalBytes && drive.chunkSize) {
      job.rate.push(Math.min(job.totalBytes, cur * drive.chunkSize));
    }
    pushUploads();
  };

  try {
    const stat = await capacitorFiles.stat(job.handle);
    job.totalBytes = stat.size;
    await drive.upload(job.handle, job.destFolder, onProgress, control);
    removeJob(job);
    emit('uploadDone', { uploadId: job.uploadId, name: job.name, ok: true });
  } catch (err) {
    if (isPauseError(err)) {
      job.state = 'paused';
    } else if (isCancelError(err)) {
      removeJob(job);
      emit('uploadDone', { uploadId: job.uploadId, name: job.name, ok: false, canceled: true });
    } else {
      job.state = 'failed';
      job.error = err.message;
      emit('uploadDone', { uploadId: job.uploadId, name: job.name, ok: false, error: err.message });
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
  } finally { pumping = false; }
}

const findJob = (uploadId) => uploadJobs.find((j) => j.uploadId === uploadId) || null;

// Desktop-only capabilities. Answering plainly beats a silent no-op — the UI
// surfaces these strings as toasts.
const NOT_YET = (what) => async () => ({ ok: false, error: `${what} isn't available on Android yet` });

function guarded(fn) {
  return async (...args) => {
    await ready;
    const result = await fn(...args);
    pushUpdate();
    return result;
  };
}

// Diagnostics hook. webContentsDebuggingEnabled means this app can be inspected
// from chrome://inspect on a connected phone, and this is what makes that
// useful. Deliberately excludes the token — everything here is safe to read out
// of a bug report.
window.beanydrive = {
  files: capacitorFiles,
  status: () => ({
    status: drive.status,
    channel: drive.channelName,
    guild: drive.guildName,
    files: drive.metadata.files.length,
    chunkSize: drive.chunkSize,
    concurrency: drive.uploadConcurrency,
  }),
  uploads: () => uploadJobs.map(jobSnapshot),
};

window.api = {
  // Window chrome doesn't exist here; the titlebar hides itself when these
  // report an unsupported platform.
  minimize() {}, maximize() {}, close() {},
  onWindowState() {},
  isMobile: true,

  getAppVersion: async () => (await App.getInfo().catch(() => ({ version: 'dev' }))).version,
  checkForUpdates: async () => ({ status: 'up-to-date' }), // APKs update out of band
  onUpdateAvailable() {},
  // '_system' hands the URL to Android's default browser. @capacitor/browser
  // would give an in-app tab, but it pulls in androidx.browser for no gain here.
  openExternal: (url) => { if (/^https?:\/\//i.test(url)) window.open(url, '_system'); },

  getSettings: async () => { await ready; return publicSettings(await readSettings()); },
  saveSettings: async ({ token, channelId, chunkSizeMb, uploadConcurrency }) => {
    const current = await readSettings();
    if (token) await Preferences.set({ key: TOKEN_KEY, value: token });
    const next = {
      channelId: channelId !== undefined ? channelId : current.channelId,
      chunkSizeMb: chunkSizeMb !== undefined ? chunkSizeMb : current.chunkSizeMb,
      uploadConcurrency: uploadConcurrency !== undefined ? uploadConcurrency : current.uploadConcurrency,
    };
    await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(next) });
    const saved = await readSettings();
    if (saved._token && saved.channelId) {
      try {
        await drive.connect(saved._token, saved.channelId, saved.chunkSizeMb, saved.uploadConcurrency);
      } catch (e) {
        return { ok: false, error: e.message, settings: publicSettings(saved) };
      }
    }
    return { ok: true, settings: publicSettings(saved) };
  },
  testConnection: async ({ token, channelId }) => {
    try {
      const effective = token || (await readSettings())._token;
      return { ok: true, ...(await api.testConnection(effective, channelId)) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  getStatus: async () => { await ready; return drive.snapshot(); },
  onStatus: (cb) => on('status', cb),
  onUpdate: (cb) => on('update', cb),
  onUploads: (cb) => on('uploads', cb),
  onUploadDone: (cb) => on('uploadDone', cb),
  onDownloadProgress: (cb) => on('downloadProgress', cb),
  onPreviewProgress: (cb) => on('previewProgress', cb),
  onTaskProgress: (cb) => on('taskProgress', cb),
  onTaskDone: (cb) => on('taskDone', cb),
  onDragCache: (cb) => on('dragCache', cb),

  // The renderer's <input type="file"> gives real File objects; registering one
  // returns the handle the core will use as its "path".
  pathForFile: (file) => registerFile(file),
  pickFiles: async () => [], // the file input is the picker on Android
  upload: async (paths, destFolder) => {
    await ready;
    if (drive.status !== 'connected') return { ok: false, error: 'Not connected. Check Settings.' };
    for (const handle of paths) {
      let name = handle;
      try { name = (await capacitorFiles.stat(handle)).name; } catch (e) { /* keep the handle */ }
      uploadJobs.push({
        uploadId: `u${Date.now()}_${uploadSeq++}`,
        handle, destFolder, name,
        state: 'queued', progress: 0, error: null, totalBytes: 0,
        rate: createRateTracker(), controller: null, paused: false, canceled: false,
      });
    }
    pushUploads();
    pumpUploads();
    return { ok: true };
  },
  pauseUpload: async (uploadId) => {
    const job = findJob(uploadId);
    if (!job) return { ok: false, error: 'Upload already finished' };
    if (job.state === 'running') { job.paused = true; job.controller.abort(); }
    else if (job.state === 'queued') job.state = 'paused';
    else return { ok: false, error: `Cannot pause a ${job.state} upload` };
    pushUploads();
    return { ok: true };
  },
  resumeUpload: async (uploadId) => {
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
  },
  cancelUpload: async (uploadId) => {
    const job = findJob(uploadId);
    if (!job) return { ok: false, error: 'Upload already finished' };
    if (job.state === 'running') { job.canceled = true; job.controller.abort(); return { ok: true }; }
    // Paused/failed rows still own chunks in the channel.
    await drive.discardResumable(job.handle, job.destFolder).catch(() => {});
    removeJob(job);
    emit('uploadDone', { uploadId, name: job.name, ok: false, canceled: true });
    pushUploads();
    return { ok: true };
  },
  prepareDrag: NOT_YET('Drag-out'),
  startDrag() {},

  download: (fileId, name) => downloadToDevice(fileId, name),
  copyLink: async (fileId) => {
    await ready;
    const { url, multiChunk } = await drive.getShareLink(fileId);
    // The async clipboard API isn't guaranteed to exist; failing to copy
    // shouldn't lose the link, so fall back to handing it to the share sheet.
    const clipboard = typeof navigator !== 'undefined' && navigator.clipboard;
    if (clipboard) {
      try {
        await clipboard.writeText(url);
        return { ok: true, multiChunk };
      } catch (e) { /* fall through to sharing it */ }
    }
    await Share.share({ title: 'Link', text: url, url }).catch(() => {});
    return { ok: true, multiChunk };
  },
  previewFile: async (fileId) => {
    await ready;
    const entry = drive.getEntry(fileId);
    if (!entry) return { ok: false, error: 'File not found' };
    if (entry.size > PREVIEW_MAX_BYTES) {
      return {
        ok: false,
        error: `Too large to preview (${(entry.size / (1024 * 1024)).toFixed(1)} MB, limit ${PREVIEW_MAX_BYTES / (1024 * 1024)} MB) — download it instead.`,
      };
    }
    try {
      const bytes = await drive.fetchBytes(fileId, (cur, total) => {
        emit('previewProgress', { fileId, progress: Math.round((cur / total) * 100) });
      });
      return { ok: true, bytes, mime: guessMimeFor(entry.name), name: entry.name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  trash: guarded((fileId) => drive.trashFile(fileId)),
  restore: guarded((fileId) => drive.restoreFile(fileId)),
  star: guarded((fileId, value) => drive.starFile(fileId, value)),
  rename: guarded((fileId, name) => drive.renameFile(fileId, name)),
  addTag: guarded((fileId, tag) => drive.addTag(fileId, tag)),
  removeTag: guarded((fileId, tag) => drive.removeTag(fileId, tag)),
  createFolder: guarded((folderPath) => drive.createFolder(folderPath)),
  deleteFolder: guarded((folderPath) => drive.deleteFolder(folderPath)),
  refresh: guarded(() => drive.refresh()),
  emptyTrash: async () => {
    await ready;
    const taskId = `t${Date.now()}_${taskSeq++}`;
    const label = 'Emptying Trash';
    emit('taskProgress', { taskId, label, progress: 0, detail: 'preparing…' });
    try {
      const { files, chunks } = await drive.emptyTrash((done, total, name) => {
        emit('taskProgress', {
          taskId, label,
          progress: total ? Math.round((done / total) * 100) : 100,
          detail: total ? `${done}/${total} chunks${name ? ` · ${name}` : ''}` : 'nothing to delete',
        });
      });
      emit('taskDone', {
        taskId, ok: true,
        message: files ? `Trash emptied — ${files} file(s), ${chunks} chunk(s)` : 'Trash was already empty',
      });
      pushUpdate();
      return { files, chunks };
    } catch (err) {
      emit('taskDone', { taskId, ok: false, message: `Empty Trash failed: ${err.message}` });
      throw err;
    }
  },
};
