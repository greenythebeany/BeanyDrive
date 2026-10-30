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
const { capacitorFiles, registerFile, registerNative, forgetFile, BeanyNative } = require('../../platform/capacitor-files');
const { bytesToBase64 } = require('../../platform/capacitor-http');
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
const ENCRYPT_UPLOADS_KEY = 'beanydrive_encrypt_uploads';
const CAMERA_KEY = 'beanydrive_camera_backup';
// The drive's encryption key for this device, per channel. Preferences, like
// the token (see readSettings).
const driveKeyName = () => `beanydrive_drivekey_${drive.channelId || ''}`;

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
drive.on('ready', async () => {
  // Unlock with this device's stored key before the first snapshot.
  const { value: encUploads } = await Preferences.get({ key: ENCRYPT_UPLOADS_KEY });
  drive.encryptUploads = encUploads !== '0';
  const { value: stored } = await Preferences.get({ key: driveKeyName() });
  if (stored) {
    const ok = await drive.unlockWithStoredKey(stored).catch(() => false);
    if (!ok) await Preferences.remove({ key: driveKeyName() });
  } else {
    drive.lock();
  }
  emit('update', drive.snapshot());
  runCameraBackup().catch(() => {});
});

function pushUpdate() { emit('update', drive.snapshot()); }

// --- updates --------------------------------------------------------------
const RELEASES_URL = 'https://api.github.com/repos/greenythebeany/BeanyDrive/releases/latest';
function parseSemver(str) {
  const m = String(str || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
async function checkForUpdates() {
  try {
    const res = await nativeFetch(RELEASES_URL, { headers: { Accept: 'application/vnd.github+json' }, responseType: 'text' });
    if (!res.ok) return { status: res.status === 404 ? 'up-to-date' : 'error' };
    const release = JSON.parse(await res.text());
    const latest = parseSemver(release.tag_name) || parseSemver(release.name);
    const currentStr = (await App.getInfo().catch(() => ({ version: '0.0.0' }))).version;
    const current = parseSemver(currentStr);
    const diff = latest && current ? latest.findIndex((n, i) => n !== current[i]) : -1;
    if (diff === -1 || latest[diff] < current[diff]) return { status: 'up-to-date', current: currentStr };
    const apk = (release.assets || []).find((a) => /\.apk$/i.test(a.name));
    return {
      status: 'available', version: latest.join('.'), current: currentStr, notes: String(release.body || '').slice(0, 6000),
      url: apk ? apk.browser_download_url : release.html_url, canInstall: false, size: apk ? apk.size : 0,
    };
  } catch (e) {
    return { status: 'error', error: e.message };
  }
}
// The automatic check itself is started by the renderer, which knows whether
// the user turned it off (Settings → About).

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
// Saved straight to the phone through MediaStore (mobile/native): photos and
// videos into Pictures/ and Movies/BeanyDrive, where the gallery finds them,
// everything else into Download/BeanyDrive. No permission needed on Android 10+.
let taskSeq = 0;
async function downloadToDevice(fileId, name) {
  await ready;
  const entry = drive.getEntry(fileId);
  if (!entry) return { ok: false, error: 'File not found' };

  const taskId = `t${Date.now()}_${taskSeq++}`;
  const label = `Downloading ${name}`;
  emit('taskProgress', { taskId, label, progress: 0, detail: 'starting…' });
  try {
    const mime = guessMimeFor(name);
    const target = { device: true, name, mime };
    await drive.download(fileId, target, (cur, total) => {
      emit('taskProgress', {
        taskId, label, progress: Math.round((cur / total) * 100), detail: `${cur}/${total} chunks`,
      });
    });
    const result = target.result || {};
    // The renderer's own toast says where it went, with an Open button.
    emit('taskDone', { taskId, ok: true, message: '' });
    return { ok: true, path: result.location, uri: result.uri, file: result.file, mime, openable: true };
  } catch (err) {
    emit('taskDone', { taskId, ok: false, message: `Download failed: ${err.message}` });
    return { ok: false, error: err.message };
  }
}

// Sharing goes through the cache and the share sheet, as downloads used to.
async function shareFile(fileId) {
  await ready;
  const entry = drive.getEntry(fileId);
  if (!entry) return { ok: false, error: 'File not found' };
  const target = { path: entry.name, directory: Directory.Cache };
  await drive.download(fileId, target);
  const { uri } = await Filesystem.getUri(target);
  await Share.share({ title: entry.name, url: uri, dialogTitle: `Send ${entry.name}` }).catch(() => {});
  return { ok: true };
}

// --- streaming --------------------------------------------------------------
// <video src="/_beanystream/<id>"> is answered by the native plugin, which asks
// for each byte range here; the bytes come from the drive core (decrypted if
// need be) and go back piece by piece.
BeanyNative.addListener('streamRequest', async ({ req, fileId, start, end }) => {
  try {
    await ready;
    for await (const piece of drive.readRange(fileId, start, end)) {
      for (let at = 0; at < piece.length; at += 512 * 1024) {
        const { open } = await BeanyNative.streamData({ req, data: bytesToBase64(piece.subarray(at, at + 512 * 1024)) });
        if (!open) return;
      }
    }
  } catch (e) {
    /* the player sees a short response and reports the error itself */
  } finally {
    BeanyNative.streamEnd({ req }).catch(() => {});
  }
});

// --- shared to BeanyDrive --------------------------------------------------
async function takeShared() {
  const { files } = await BeanyNative.getSharedFiles();
  if (!files || !files.length) return;
  const items = files.map((f) => ({
    name: f.name, size: f.size,
    handle: registerNative({ uri: f.uri, name: f.name, size: f.size, mtimeMs: 0 }),
  }));
  emit('sharedFiles', items);
}
BeanyNative.addListener('shared', () => takeShared().catch(() => {}));

// --- camera backup -----------------------------------------------------------
// While the app is open (on start, on returning to it, and every few minutes),
// new photos and videos in DCIM are queued as ordinary uploads into
// <folder>/<yyyy-mm>. The upload's dedup check skips anything already there.
const CAMERA_INTERVAL_MS = 5 * 60 * 1000;
const cameraQueued = new Set(); // media keys queued this session
async function readCamera() {
  const { value } = await Preferences.get({ key: CAMERA_KEY });
  return { enabled: false, folder: 'Camera', since: 0, lastRun: 0, ...(value ? JSON.parse(value) : {}) };
}
async function writeCamera(c) {
  await Preferences.set({ key: CAMERA_KEY, value: JSON.stringify(c) });
}
async function cameraSnapshot(extra = {}) {
  const c = await readCamera();
  const { granted } = await BeanyNative.mediaPermission().catch(() => ({ granted: false }));
  return { enabled: c.enabled, folder: c.folder, lastRun: c.lastRun, granted, ...extra };
}
let cameraRunning = false;
async function runCameraBackup() {
  const c = await readCamera();
  if (!c.enabled || cameraRunning || drive.status !== 'connected') return 0;
  const { granted } = await BeanyNative.mediaPermission();
  if (!granted) return 0;
  cameraRunning = true;
  let queued = 0;
  try {
    // Items queued but not yet uploaded are kept in `pending`, so closing the
    // app mid-backup doesn't skip them: they're queued again next time.
    c.pending = c.pending || {};
    if (!c.readFix) {
      queued += await requeueCutBackups(c);
      c.readFix = 1;
    }
    const { items } = await BeanyNative.listMedia({ since: c.since, limit: 200 });
    for (const m of items || []) {
      c.pending[m.key] = { uri: m.uri, name: m.name, size: m.size, added: m.added };
      c.since = Math.max(c.since, m.added);
    }
    for (const [key, m] of Object.entries(c.pending)) {
      if (cameraQueued.has(key)) continue;
      cameraQueued.add(key);
      const d = new Date(m.added);
      const dest = `${c.folder}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const handle = registerNative({ uri: m.uri, name: m.name, size: m.size, mtimeMs: m.added });
      enqueueUpload(handle, dest, m.name).cameraKey = key;
      queued += 1;
    }
    c.lastRun = Date.now();
    await writeCamera(c);
    if (queued) { pushUploads(); pumpUploads(); }
  } finally {
    cameraRunning = false;
  }
  emit('cameraBackup', await cameraSnapshot());
  return queued;
}
// 2.1.0 and 2.1.1 read every chunk of a backed-up file from its start, so
// anything bigger than one chunk was stored with only its first part right.
// Each such file still in the gallery is uploaded again and the cut copy
// deleted. A copy that was fine (uploaded some other way) dedups against the
// new upload as 'existing' and is kept.
async function requeueCutBackups(c) {
  const suspects = new Map(); // name|size → entries
  for (const f of drive.metadata.files) {
    if (f.trashed || f.chunks.length < 2 || !(f.path === c.folder || f.path.startsWith(`${c.folder}/`))) continue;
    const k = `${f.name}|${f.size}`;
    suspects.set(k, [...(suspects.get(k) || []), f]);
  }
  if (!suspects.size) return 0;
  let queued = 0;
  let since = 0;
  const seen = new Set();
  for (;;) {
    const { items = [] } = await BeanyNative.listMedia({ since, limit: 200 });
    let fresh = 0;
    for (const m of items) {
      if (seen.has(m.key)) continue;
      seen.add(m.key);
      fresh += 1;
      since = Math.max(since, m.added);
      for (const f of suspects.get(`${m.name}|${m.size}`) || []) {
        const handle = registerNative({ uri: m.uri, name: m.name, size: m.size, mtimeMs: m.added });
        enqueueUpload(handle, f.path, m.name).replaces = f.id;
        queued += 1;
      }
    }
    if (!fresh || items.length < 200) break;
  }
  return queued;
}

async function cameraUploaded(key) {
  const c = await readCamera();
  if (c.pending && c.pending[key]) {
    delete c.pending[key];
    await writeCamera(c);
  }
}
setInterval(() => { runCameraBackup().catch(() => {}); }, CAMERA_INTERVAL_MS);
App.addListener('resume', () => {
  runCameraBackup().catch(() => {});
  takeShared().catch(() => {});
});

// --- uploads --------------------------------------------------------------
// Same job model as the desktop: a queue whose entries outlive their transfer
// so a paused or failed one still has the state its Resume/Retry button needs.
// The renderer is fed the same snapshot shape, so its rows work unchanged.
let uploadSeq = 0;
const uploadJobs = [];
const PARALLEL_FILES = 3;
let runningJobs = 0;
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
    const entry = await drive.upload(job.handle, job.destFolder, onProgress, control);
    if (job.cameraKey) await cameraUploaded(job.cameraKey).catch(() => {});
    if (job.replaces && entry && entry.deduplicated !== 'existing' && entry.id !== job.replaces) {
      await drive.deleteFile(job.replaces).catch(() => {});
      pushUpdate();
    }
    removeJob(job);
    emit('uploadDone', { uploadId: job.uploadId, name: job.name, ok: true, deduplicated: entry && entry.deduplicated });
  } catch (err) {
    if (isPauseError(err)) {
      job.state = 'paused';
    } else if (isCancelError(err)) {
      if (job.cameraKey) cameraUploaded(job.cameraKey).catch(() => {}); // canceled = skip it
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

// Same as desktop: a few files at once, sharing the drive's chunk slots.
function pumpUploads() {
  while (runningJobs < PARALLEL_FILES) {
    const job = uploadJobs.find((j) => j.state === 'queued');
    if (!job) break;
    runningJobs += 1;
    job.state = 'running';
    runJob(job).finally(() => {
      runningJobs -= 1;
      pumpUploads();
    });
  }
}

function enqueueUpload(handle, destFolder, name) {
  const job = {
    uploadId: `u${Date.now()}_${uploadSeq++}`,
    handle, destFolder, name,
    state: 'queued', progress: 0, error: null, totalBytes: 0,
    rate: createRateTracker(), controller: null, paused: false, canceled: false,
  };
  uploadJobs.push(job);
  return job;
}

const findJob = (uploadId) => uploadJobs.find((j) => j.uploadId === uploadId) || null;

// Desktop-only capabilities. Answering plainly beats a silent no-op — the UI
// surfaces these strings as toasts.
const NOT_YET = (what) => async () => ({ ok: false, error: `${what} isn't available on Android yet` });

async function security(fn) {
  await ready;
  try {
    if (drive.status !== 'connected') throw new Error('Not connected. Check Settings.');
    await fn();
    pushUpdate();
    return { ok: true, encryption: drive.encryptionState() };
  } catch (err) {
    return { ok: false, error: err.message, encryption: drive.encryptionState() };
  }
}

function repair(fn) {
  return async (arg) => {
    await ready;
    try {
      const count = await fn(arg);
      pushUpdate();
      return { ok: true, count };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
}

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
  // An app can't replace its own APK silently, so Android only checks: the
  // modal's button opens the release's APK in the browser, and Android's
  // installer takes it from there.
  checkForUpdates,
  onUpdateAvailable: (cb) => on('updateAvailable', cb),
  onUpdateProgress() {},
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
      enqueueUpload(handle, destFolder, name);
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
    if (job.cameraKey) cameraUploaded(job.cameraKey).catch(() => {});
    removeJob(job);
    emit('uploadDone', { uploadId, name: job.name, ok: false, canceled: true });
    pushUploads();
    return { ok: true };
  },
  prepareDrag: NOT_YET('Drag-out'),
  startDrag() {},

  download: (fileId, name) => downloadToDevice(fileId, name),
  openDownloaded: async ({ uri, file, mime }) => {
    try {
      await BeanyNative.openFile({ uri, file, mime });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
  shareFile: (fileId) => shareFile(fileId),

  // Video and audio stream through the native plugin (see streamRequest).
  streamUrl: (fileId) => {
    const e = drive.getEntry(fileId);
    const type = guessMimeFor(e ? e.name : '').replace('video/quicktime', 'video/mp4');
    return `${location.origin}/_beanystream/${encodeURIComponent(fileId)}?size=${e ? e.size : 0}&type=${encodeURIComponent(type)}`;
  },

  onSharedFiles: (cb) => { on('sharedFiles', cb); ready.then(() => takeShared()).catch(() => {}); },
  discardShared: (handles) => handles.forEach((h) => forgetFile(h)),

  getCameraBackup: () => cameraSnapshot(),
  onCameraBackup: (cb) => on('cameraBackup', cb),
  setCameraBackup: async ({ enabled, folder, includeExisting, requestPermission } = {}) => {
    const c = await readCamera();
    if (folder !== undefined) c.folder = String(folder).replace(/^\/+|\/+$/g, '') || 'Camera';
    if (enabled === true && !c.enabled) { c.enabled = true; c.since = includeExisting ? 0 : Date.now(); }
    if (enabled === false) c.enabled = false;
    await writeCamera(c);
    if (c.enabled && (enabled === true || requestPermission)) await BeanyNative.requestMediaPermission().catch(() => {});
    if (c.enabled) runCameraBackup().catch(() => {});
    return cameraSnapshot();
  },
  runCameraBackup: async () => cameraSnapshot({ queued: await runCameraBackup() }),

  // Encryption: same contract as preload.js.
  setupEncryption: (passphrase) => security(async () => {
    await Preferences.set({ key: driveKeyName(), value: await drive.setupEncryption(passphrase) });
  }),
  unlockDrive: (passphrase) => security(async () => {
    await Preferences.set({ key: driveKeyName(), value: await drive.unlock(passphrase) });
  }),
  lockDrive: () => security(async () => {
    drive.lock();
    await Preferences.remove({ key: driveKeyName() });
  }),
  changePassphrase: (passphrase) => security(() => drive.changePassphrase(passphrase)),
  setEncryptUploads: (value) => security(async () => {
    drive.encryptUploads = !!value;
    await Preferences.set({ key: ENCRYPT_UPLOADS_KEY, value: value ? '1' : '0' });
  }),

  checkDrive: async () => {
    await ready;
    const taskId = `t${Date.now()}_${taskSeq++}`;
    const label = 'Checking drive';
    emit('taskProgress', { taskId, label, progress: 0, detail: 'reading the channel…' });
    try {
      const report = await drive.checkDrive((seen) => emit('taskProgress', { taskId, label, progress: 50, detail: `${seen} messages read` }));
      emit('taskDone', { taskId, ok: true, message: 'Drive check finished' });
      return { ok: true, report };
    } catch (err) {
      emit('taskDone', { taskId, ok: false, message: `Check failed: ${err.message}` });
      return { ok: false, error: err.message };
    }
  },
  recoverOrphans: repair((fileIds) => drive.recoverOrphans(fileIds)),
  deleteOrphans: repair((fileIds) => drive.deleteOrphans(fileIds)),
  removeBroken: repair((fileIds) => drive.removeBroken(fileIds)),
  restoreBackup: repair((messageId) => drive.restoreBackup(messageId)),
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
  updateFiles: guarded((fileIds, patch) => drive.updateFiles(fileIds, patch)),
  moveFiles: guarded((fileIds, destFolder) => drive.moveFiles(fileIds, destFolder)),
  renameFolder: guarded((oldPath, newPath) => drive.renameFolder(oldPath, newPath)),
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
