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
const { capacitorFiles } = require('../../platform/capacitor-files');
const { createResumeStore } = require('../../platform/capacitor-resume-store');
const { guessMimeFor } = require('./mime');

const { Preferences } = require('@capacitor/preferences');
const { Filesystem, Directory } = require('@capacitor/filesystem');
const { Share } = require('@capacitor/share');
const { App } = require('@capacitor/app');
const { Browser } = require('@capacitor/browser');

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
    const target = await Filesystem.getUri({ directory: Directory.Documents, path: name })
      .then((r) => r.uri)
      .catch(() => name);
    await drive.download(fileId, target, (cur, total) => {
      emit('taskProgress', {
        taskId, label, progress: Math.round((cur / total) * 100), detail: `${cur}/${total} chunks`,
      });
    });
    emit('taskDone', { taskId, ok: true, message: `Saved ${name}` });
    try {
      await Share.share({ title: name, url: target, dialogTitle: `Save or send ${name}` });
    } catch (e) { /* user dismissed the sheet; the file is still saved */ }
    return { ok: true, path: target };
  } catch (err) {
    emit('taskDone', { taskId, ok: false, message: `Download failed: ${err.message}` });
    return { ok: false, error: err.message };
  }
}

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

window.api = {
  // Window chrome doesn't exist here; the titlebar hides itself when these
  // report an unsupported platform.
  minimize() {}, maximize() {}, close() {},
  onWindowState() {},
  isMobile: true,

  getAppVersion: async () => (await App.getInfo().catch(() => ({ version: 'dev' }))).version,
  checkForUpdates: async () => ({ status: 'up-to-date' }), // APKs update out of band
  onUpdateAvailable() {},
  openExternal: (url) => { if (/^https?:\/\//i.test(url)) Browser.open({ url }); },

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

  // Uploading needs the native chunk plugin; until that exists, say so.
  pathForFile: () => '',
  pickFiles: async () => [],
  upload: NOT_YET('Uploading'),
  cancelUpload: NOT_YET('Uploading'),
  pauseUpload: NOT_YET('Uploading'),
  resumeUpload: NOT_YET('Uploading'),
  prepareDrag: NOT_YET('Drag-out'),
  startDrag() {},

  download: ({ fileId, name } = {}) => downloadToDevice(fileId, name),
  copyLink: async ({ fileId }) => {
    await ready;
    const { url, multiChunk } = await drive.getShareLink(fileId);
    await navigator.clipboard.writeText(url).catch(() => {});
    return { ok: true, multiChunk };
  },
  previewFile: async ({ fileId }) => {
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

  trash: guarded(({ fileId }) => drive.trashFile(fileId)),
  restore: guarded(({ fileId }) => drive.restoreFile(fileId)),
  star: guarded(({ fileId, value }) => drive.starFile(fileId, value)),
  rename: guarded(({ fileId, name }) => drive.renameFile(fileId, name)),
  addTag: guarded(({ fileId, tag }) => drive.addTag(fileId, tag)),
  removeTag: guarded(({ fileId, tag }) => drive.removeTag(fileId, tag)),
  createFolder: guarded(({ folderPath }) => drive.createFolder(folderPath)),
  deleteFolder: guarded(({ folderPath }) => drive.deleteFolder(folderPath)),
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
