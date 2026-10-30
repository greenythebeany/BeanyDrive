'use strict';

// The drive: chunked upload/download, folders as virtual path prefixes, and
// metadata as a pinned JSON attachment. Ported from DiscordCloudStorage's
// bot.py + storage.py + metadata.py.
//
// Everything platform-specific is injected, so this same file backs both the
// Electron app and the Capacitor/Android one:
//
//   files       { stat, readChunk, createWriter, walk }  — see platform adapters
//   api         from core/discord-api.js
//   resumeStore { get, put, delete, stale, all }         — optional; without it
//                                                          uploads aren't resumable
//
// Local paths are opaque strings here. On desktop they're filesystem paths; on
// Android they're content URIs. Only the adapter needs to know the difference.

const { Emitter } = require('./emitter');
const { normalizePath, joinPath, fileBasename } = require('./paths');
const { resumeKey } = require('./resume-key');
const { tierLimitBytes } = require('./discord-api');
const {
  DriveLocked, CHUNK_OVERHEAD, createKeyring, wrapKeyring, unwrapKeyring, importDataKey, keyIdOf, dedupSalt,
  encryptChunk, decryptChunk, hashFile, toBase64, fromBase64,
} = require('./crypto');

const SAFETY_BYTES = 256 * 1024;
// Discord allows roughly 5 message creates per 5s per channel, so 4 keeps the
// pool busy while leaving headroom before requests start bouncing off 429s.
const DEFAULT_CONCURRENCY = 4;
// Downloads aren't message creates, so they aren't held to that budget; the
// limiter in discord-api still paces the per-chunk message lookups.
const DOWNLOAD_CONCURRENCY = 6;
// Unfinished uploads older than this are given up on: their chunks are deleted
// and the resume record dropped, so abandoned attempts can't accumulate in the
// channel forever.
const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_FILENAME = 'beanydrive_metadata.json';
const METADATA_MARKER = '[BeanyDrive metadata - do not delete]';
// Earlier copies of the index. Every save replaces the pinned index message;
// at most once per BACKUP_INTERVAL_MS the outgoing one is kept (unpinned and
// relabelled) instead of deleted, and the newest BACKUP_KEEP are kept.
const BACKUP_MARKER = '[BeanyDrive index backup - do not delete]';
const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const BACKUP_KEEP = 10;
// Chunk messages are labelled "`<file id>` chunk <n>/<total> ...", which is
// what lets a scan of the channel find files the index has lost.
const CHUNK_LABEL = /^`([0-9a-f]{32})` chunk (\d+)\/(\d+)( \(empty\))?( \(encrypted\))?(?: - (.*))?$/s;
// Chunks kept decoded for range reads (video seeking asks for overlapping ranges).
const RANGE_CACHE_CHUNKS = 4;

// Thrown when the user cancels an upload. Carries a flag rather than relying on
// the message so callers can tell a cancel apart from a real failure and report
// it as such instead of surfacing it as an error.
class UploadCanceled extends Error {
  constructor() {
    super('Upload canceled');
    this.name = 'UploadCanceled';
    this.canceled = true;
  }
}

// Thrown when the user pauses. Same stop, opposite cleanup: a pause deliberately
// leaves the uploaded chunks and the resume record in place so the upload can be
// picked up again, where a cancel deletes both.
class UploadPaused extends Error {
  constructor() {
    super('Upload paused');
    this.name = 'UploadPaused';
    this.paused = true;
  }
}

// An in-flight chunk POST aborted via AbortController surfaces as a DOMException
// named 'AbortError' rather than our own error type. Pausing aborts the same
// way, so an AbortError alone doesn't say which one it was — callers pair this
// with the control's own paused/canceled state to decide.
function isCancelError(err) {
  return !!err && (err.canceled === true || err.name === 'AbortError');
}

function isPauseError(err) {
  return !!err && err.paused === true;
}

function chunkArrayToMap(chunkIds) {
  const map = {};
  chunkIds.forEach((msgId, idx) => { if (msgId) map[idx] = msgId; });
  return map;
}

function concatChunks(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// Discord ids carry their creation time.
function snowflakeTime(id) {
  try { return Number((BigInt(id) >> 22n) + 1420070400000n); } catch (e) { return Date.now(); }
}

function randomId() {
  // Present in Node 19+ and every WebView this targets.
  return globalThis.crypto.randomUUID().replace(/-/g, '');
}

// Serializes metadata read-modify-write cycles so concurrent calls (e.g. star +
// upload finishing around the same time) can't clobber each other's save.
class Mutex {
  constructor() { this._queue = Promise.resolve(); }
  lock(fn) {
    const result = this._queue.then(() => fn());
    this._queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

// Caps chunk uploads in flight across every file being uploaded at once, so
// parallel files share the concurrency setting instead of multiplying it (and
// the chunks held in memory) by the number of files.
class Semaphore {
  constructor(n) { this.free = n; this.waiters = []; }
  async acquire() {
    if (this.free > 0) { this.free -= 1; return; }
    await new Promise((resolve) => this.waiters.push(resolve));
  }
  release() {
    const next = this.waiters.shift();
    if (next) next(); else this.free += 1;
  }
}

function normalizeMetadata(data) {
  const files = Array.isArray(data && data.files) ? data.files : [];
  return {
    version: 3,
    files: files.map((f) => {
      const out = {
        id: f.id,
        name: f.name,
        size: f.size || 0,
        chunks: Array.isArray(f.chunks) ? f.chunks : [],
        created: f.created || Date.now() / 1000,
        path: normalizePath(f.path || ''),
        tags: Array.isArray(f.tags) ? f.tags : [],
        starred: !!f.starred,
        trashed: !!f.trashed,
      };
      // Optional, so indexes written before them stay byte-for-byte compatible.
      if (f.chunkSize) out.chunkSize = f.chunkSize; // plaintext bytes per chunk (all but the last)
      if (f.enc) out.enc = f.enc;
      if (f.hash) out.hash = f.hash;
      if (f.encFileId) out.encFileId = f.encFileId; // linked duplicate: whose id its chunks were sealed with
      return out;
    }),
    folders: Array.isArray(data && data.folders) ? data.folders.map(normalizePath) : [],
    ...(data && data.encryption ? { encryption: data.encryption } : {}),
    backups: Array.isArray(data && data.backups) ? data.backups.filter((b) => b && b.id) : [],
  };
}

function emptyMetadata() {
  return { version: 3, files: [], folders: [], backups: [] };
}

class DiscordDrive extends Emitter {
  constructor({ api, files, resumeStore = null } = {}) {
    super();
    if (!api) throw new Error('DiscordDrive needs an api adapter');
    if (!files) throw new Error('DiscordDrive needs a files adapter');
    this.api = api;
    this.files = files;
    this.resumeStore = resumeStore;

    this.token = null;
    this.channelId = null;
    this.channelName = null;
    this.guildName = null;
    this.chunkSizeMb = 10;
    this.chunkSize = null;
    this.uploadConcurrency = DEFAULT_CONCURRENCY;
    this.metadata = emptyMetadata();
    this.metadataMessageId = null;
    this.status = 'disconnected';
    // Encryption: the drive's data key once unlocked on this device.
    this.key = null;
    this.keyRaw = null;
    this.encryptUploads = true;
    this._chunkSizeCache = new Map(); // file id → plaintext chunk size, for old entries
    this._rangeCache = new Map();     // `${fileId}:${idx}` → Promise<Uint8Array>
    this._lastScan = null;
    this._mutex = new Mutex();
    this._chunkSlots = new Semaphore(DEFAULT_CONCURRENCY);
    this._unsavedEntries = [];
    this._pendingSave = null;
  }

  _withLock(fn) { return this._mutex.lock(fn); }

  _request(pathname, opts) {
    if (!this.token) throw new Error('Not connected');
    return this.api.request(this.token, pathname, opts);
  }

  _ensureReady() {
    if (this.status !== 'connected') throw new Error('Not connected yet');
  }

  async connect(token, channelId, chunkSizeMb, uploadConcurrency) {
    this.token = token;
    this.channelId = String(channelId);
    this.chunkSizeMb = chunkSizeMb || 10;
    this.uploadConcurrency = Math.max(1, Math.min(8, uploadConcurrency || DEFAULT_CONCURRENCY));
    this._chunkSlots = new Semaphore(this.uploadConcurrency);
    this.status = 'connecting';
    this.emit('status', 'Connecting...');
    try {
      const channel = await this._request(`/channels/${this.channelId}`);
      if (channel.type !== 0) throw new Error('Configured channel is not a text channel');
      this.channelName = channel.name;
      const guild = await this._request(`/guilds/${channel.guild_id}`);
      this.guildName = guild.name;
      const serverLimit = tierLimitBytes(guild.premium_tier);
      const configuredBytes = Math.max(1, this.chunkSizeMb * 1024 * 1024 - SAFETY_BYTES);
      this.chunkSize = Math.max(1, Math.min(configuredBytes, serverLimit - SAFETY_BYTES));
      this.emit('status', `Loading metadata from #${channel.name}...`);
      await this.loadMetadata();
      this.status = 'connected';
      const limitMb = (this.chunkSize / (1024 * 1024)).toFixed(1);
      this.emit('status', `Connected to #${channel.name} - ${this.metadata.files.length} file(s) - chunk limit ${limitMb} MB`);
      this.emit('ready');
    } catch (err) {
      this.status = 'error';
      this.emit('error', err);
      throw err;
    }
  }

  disconnect() {
    this.status = 'disconnected';
    this.token = null;
  }

  // ---- metadata persistence -------------------------------------

  async loadMetadata() {
    const pins = await this._request(`/channels/${this.channelId}/pins`);
    for (const msg of pins) {
      if (msg.content && msg.content.startsWith(METADATA_MARKER) && msg.attachments && msg.attachments.length) {
        const att = msg.attachments.find((a) => a.filename === METADATA_FILENAME);
        if (att) {
          const raw = await this.api.fetchText(att.url);
          this.metadata = normalizeMetadata(JSON.parse(raw));
          this.metadataMessageId = msg.id;
          this._savedFileCount = this.metadata.files.length;
          await this._checkStoredKey();
          return;
        }
      }
    }
    this.metadata = emptyMetadata();
    this.metadataMessageId = null;
    this._savedFileCount = 0;
  }

  // `forceBackup` keeps the outgoing index regardless of the interval — used
  // before a restore, so restoring can itself be undone.
  async saveMetadata({ forceBackup = false } = {}) {
    const oldId = this.metadataMessageId;
    const backups = this.metadata.backups || (this.metadata.backups = []);
    const last = backups[backups.length - 1];
    const keepOld = !!oldId && (forceBackup || !last || Date.now() - last.at >= BACKUP_INTERVAL_MS);
    let pruned = [];
    if (keepOld) {
      backups.push({ id: oldId, at: Date.now(), files: this._savedFileCount || 0 });
      pruned = backups.splice(0, Math.max(0, backups.length - BACKUP_KEEP));
    }
    // Compact: this whole file is re-uploaded on every mutation, and
    // indentation alone is roughly a third of its size on a big drive.
    const raw = JSON.stringify(this.metadata);
    const form = new FormData();
    form.set('payload_json', JSON.stringify({ content: METADATA_MARKER }));
    form.set('files[0]', new Blob([raw], { type: 'application/json' }), METADATA_FILENAME);
    const msg = await this._request(`/channels/${this.channelId}/messages`, { method: 'POST', body: form });
    await this._request(`/channels/${this.channelId}/pins/${msg.id}`, { method: 'PUT' });
    this.metadataMessageId = msg.id;
    this._savedFileCount = this.metadata.files.length;
    if (!oldId || oldId === msg.id) return;
    if (keepOld) {
      // Unpinned so the next load can't mistake it for the live index, and
      // relabelled so a channel scan can still find it.
      await this._request(`/channels/${this.channelId}/pins/${oldId}`, { method: 'DELETE' }).catch(() => {});
      await this._request(`/channels/${this.channelId}/messages/${oldId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `${BACKUP_MARKER} ${new Date().toISOString()}` }),
      }).catch(() => {});
      await this._deleteMessages(pruned.map((b) => b.id));
    } else {
      await this._request(`/channels/${this.channelId}/messages/${oldId}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  async refresh() {
    await this.loadMetadata();
  }

  // ---- upload ------------------------------------------------------

  // An encrypted file's chunks don't carry its name, in the label or the
  // attachment's filename.
  async _sendChunk(fileId, idx, total, name, bytes, isEmpty, signal, encrypted = false) {
    const form = new FormData();
    const label = isEmpty
      ? `\`${fileId}\` chunk 1/1 (empty) - ${name}`
      : encrypted
        ? `\`${fileId}\` chunk ${idx + 1}/${total} (encrypted)`
        : `\`${fileId}\` chunk ${idx + 1}/${total} - ${name}`;
    form.set('payload_json', JSON.stringify({ content: label }));
    const filename = `${encrypted ? fileId : name}.part${String(idx).padStart(4, '0')}`;
    form.set('files[0]', new Blob([bytes]), filename);
    const msg = await this._request(`/channels/${this.channelId}/messages`, { method: 'POST', body: form, signal });
    return msg.id;
  }

  // Best-effort cleanup of chunk messages that are no longer referenced by
  // metadata — used when an upload is retried at a smaller chunk size, and when
  // one is canceled partway through.
  async _deleteMessages(msgIds) {
    for (const msgId of msgIds) {
      await this._request(`/channels/${this.channelId}/messages/${msgId}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  // Drops the chunks of an upload that will never be completed, along with its
  // resume record. Cancel only — a *failed* upload deliberately keeps both so
  // the next attempt can resume.
  async _abandonUpload(key, msgIds) {
    await this._deleteMessages(msgIds);
    if (key && this.resumeStore) this.resumeStore.delete(key);
  }

  // `control` is an optional { signal, isCanceled, isPaused } set: the AbortSignal
  // kills the chunk POSTs currently in flight, and the two predicates are checked
  // before each chunk. Three ways to stop, three cleanups — cancel deletes the
  // partial chunks so nothing is orphaned; pause and failure both keep them, so
  // resuming or retrying picks up where it stopped instead of restarting.
  async upload(localPath, destFolder, onProgress, control = {}) {
    this._ensureReady();
    // Pause is checked first: if both are somehow set, keeping the chunks is the
    // recoverable choice.
    const checkStopped = () => {
      if (control.isPaused && control.isPaused()) throw new UploadPaused();
      if (control.isCanceled && control.isCanceled()) throw new UploadCanceled();
    };
    checkStopped();

    const stat = await this.files.stat(localPath);
    const name = stat.name || fileBasename(localPath);
    const size = stat.size;
    const dest = normalizePath(destFolder);

    const key = this.resumeStore
      ? resumeKey({ localPath, size, mtimeMs: stat.mtimeMs, dest, channelId: this.channelId })
      : null;
    let saved = key ? this.resumeStore.get(key) : null;
    // Encryption on for this drive but this device locked: refuse rather than
    // quietly upload in the clear.
    if (this.metadata.encryption && this.encryptUploads && !this.key) {
      throw new Error('This drive is encrypted. Unlock it in Settings → Security to upload.');
    }
    const encrypting = this._encrypting();
    if (saved && (saved.chunkSize !== this.chunkSize || !!saved.enc !== encrypting)) {
      // Chunk size changed since the interrupted run (a settings edit, or a 413
      // downgrade), or encryption was switched, so the recorded parts no longer
      // line up with what we'd send now. Start clean rather than assemble a
      // corrupt file.
      await this._abandonUpload(key, Object.values(saved.chunks || {}));
      saved = null;
    }

    // Identical content already in the drive is linked, not uploaded again.
    let hash = saved && saved.hash;
    if (!hash && size > 0) {
      this.emit('status', `Checking ${name}…`);
      const reader = await this.files.openReader(localPath);
      try {
        hash = await hashFile(reader, size, encrypting ? this._dedupSalt : '');
      } finally {
        await reader.close();
      }
      checkStopped();
    }
    const twin = hash && this.metadata.files.find((f) => f.hash === hash && f.size === size && !!f.enc === encrypting);
    if (twin) {
      if (key && this.resumeStore) this.resumeStore.delete(key);
      if (onProgress) onProgress(1, 1);
      if (twin.path === dest && twin.name === name && !twin.trashed) {
        this.emit('status', `${name} is already in this folder`);
        return { ...twin, deduplicated: 'existing' };
      }
      // Shares the chunks; deletion only removes chunks no entry still uses.
      const entry = {
        id: randomId(), name, size, chunks: twin.chunks.slice(), created: Date.now() / 1000,
        path: dest, tags: [], starred: false, trashed: false, hash,
        ...(twin.chunkSize ? { chunkSize: twin.chunkSize } : {}),
        ...(twin.enc ? { enc: twin.enc, encFileId: twin.encFileId || twin.id } : {}),
      };
      await this._commitNewEntry(entry);
      this.emit('status', `${name} was already uploaded — linked it without uploading again`);
      return { ...entry, deduplicated: 'linked' };
    }

    const fileId = (saved && saved.fileId) || randomId();
    let chunkIds;
    let plainChunk = null;

    if (size === 0) {
      const msgId = await this._sendChunk(fileId, 0, 1, name, new Uint8Array(0), true, control.signal);
      chunkIds = [msgId];
      if (onProgress) onProgress(1, 1);
    } else {
      ({ chunkIds, plainChunk } = await this._uploadChunks({
        localPath, size, fileId, name, dest, key, saved, onProgress, control, checkStopped, encrypting, hash,
      }));
    }

    // A stop that lands between the last chunk and the metadata save still
    // counts — without this the file would silently complete anyway. A pause
    // here keeps everything, so resuming just re-saves the metadata.
    try {
      checkStopped();
    } catch (err) {
      if (isPauseError(err)) throw err;
      await this._abandonUpload(key, chunkIds.filter(Boolean));
      throw err;
    }

    const entry = {
      id: fileId, name, size, chunks: chunkIds, created: Date.now() / 1000,
      path: dest, tags: [], starred: false, trashed: false,
      ...(plainChunk ? { chunkSize: plainChunk } : {}),
      ...(hash ? { hash } : {}),
      ...(encrypting && size > 0 ? { enc: 1 } : {}),
    };
    await this._commitNewEntry(entry);
    // The chunks belong to metadata now — they're no longer loose parts.
    if (key && this.resumeStore) this.resumeStore.delete(key);
    return entry;
  }

  // Finished uploads join whichever metadata save hasn't started yet, so files
  // finishing together (parallel uploads, a batch of small files) share one
  // save — three message requests — instead of paying for one each. The
  // entries are merged inside the lock, so a refresh can't drop them.
  _commitNewEntry(entry) {
    this._unsavedEntries.push(entry);
    if (!this._pendingSave) {
      this._pendingSave = this._withLock(async () => {
        this._pendingSave = null;
        this.metadata.files.push(...this._unsavedEntries.splice(0));
        await this.saveMetadata();
      });
    }
    return this._pendingSave;
  }

  // Runs up to `uploadConcurrency` chunk POSTs at a time, filling a
  // position-indexed array so the chunk order survives out-of-order completion.
  // Retries the whole file at half the chunk size on 413, as before.
  async _uploadChunks({ localPath, size, fileId, name, dest, key, saved, onProgress, control, checkStopped, encrypting, hash }) {
    let carried = (saved && saved.chunks) || {};
    let attempt = 0;

    for (;;) {
      // Sealing adds CHUNK_OVERHEAD bytes, which has to fit under the limit too.
      const plainChunk = encrypting ? this.chunkSize - CHUNK_OVERHEAD : this.chunkSize;
      const total = Math.ceil(size / plainChunk);
      const chunkIds = new Array(total).fill(null);
      let completed = 0;

      for (const [idxStr, msgId] of Object.entries(carried)) {
        const idx = Number(idxStr);
        if (msgId && idx >= 0 && idx < total) { chunkIds[idx] = msgId; completed += 1; }
      }
      if (completed) {
        this.emit('status', `Resuming ${name} - ${completed}/${total} chunk(s) already uploaded`);
      }
      if (onProgress) onProgress(completed, total);

      // One reader for the whole attempt; workers read from it by offset.
      const reader = await this.files.openReader(localPath);
      let nextIdx = 0;
      let failure = null;

      const recordChunk = (idx, msgId) => {
        chunkIds[idx] = msgId;
        completed += 1;
        if (key && this.resumeStore) {
          this.resumeStore.put(key, {
            fileId, name, size, dest, localPath,
            chunkSize: this.chunkSize,
            channelId: this.channelId,
            hash, enc: encrypting ? 1 : 0,
            chunks: chunkArrayToMap(chunkIds),
          });
        }
        if (onProgress) onProgress(completed, total);
      };

      const worker = async () => {
        for (;;) {
          if (failure) return;
          const idx = nextIdx++;
          if (idx >= total) return;
          if (chunkIds[idx]) continue; // already uploaded by an earlier attempt
          const slots = this._chunkSlots;
          try {
            checkStopped();
            await slots.acquire();
            try {
              checkStopped();
              const start = idx * plainChunk;
              let data = await reader.read(start, Math.min(plainChunk, size - start));
              if (encrypting) data = await encryptChunk(this.key, fileId, idx, data);
              recordChunk(idx, await this._sendChunk(fileId, idx, total, name, data, false, control.signal, encrypting));
            } finally {
              slots.release();
            }
          } catch (err) {
            if (!failure) failure = err;
            return;
          }
        }
      };

      try {
        const workers = Math.max(1, Math.min(this.uploadConcurrency, total));
        await Promise.all(Array.from({ length: workers }, () => worker()));
      } finally {
        await reader.close();
      }

      if (!failure) return { chunkIds, plainChunk };

      const uploaded = chunkIds.filter(Boolean);
      // Pausing aborts the in-flight POSTs exactly like canceling does, so the
      // error alone can't tell them apart — the control's state decides, and a
      // pause keeps everything it has uploaded so far.
      const pausing = isPauseError(failure) || (isCancelError(failure) && control.isPaused && control.isPaused());
      if (pausing) throw new UploadPaused();
      if (isCancelError(failure)) {
        await this._abandonUpload(key, uploaded);
        throw new UploadCanceled();
      }
      if (failure.status === 413 && this.chunkSize > 1024 * 1024) {
        this.chunkSize = Math.floor(this.chunkSize / 2);
        this.emit('status', `Limit hit, retrying at ${(this.chunkSize / (1024 * 1024)).toFixed(1)} MB chunks...`);
        await this._abandonUpload(key, uploaded);
        carried = {};
        attempt += 1;
        if (attempt > 6) throw failure;
        continue;
      }
      // Everything else keeps its chunks and its resume record on purpose: the
      // next attempt at this file re-sends only what's missing.
      throw failure;
    }
  }

  // Uploads abandoned long enough ago that nobody is going to resume them are
  // the one way chunk messages can pile up unreferenced — clear them out.
  async sweepStaleResumes(maxAgeMs = RESUME_MAX_AGE_MS) {
    if (!this.resumeStore) return 0;
    let removed = 0;
    for (const { key, entry } of this.resumeStore.stale(maxAgeMs)) {
      if (entry.channelId && entry.channelId !== this.channelId) continue;
      const ids = Object.values(entry.chunks || {}).filter(Boolean);
      await this._deleteMessages(ids);
      this.resumeStore.delete(key);
      removed += ids.length;
    }
    return removed;
  }

  // Throws away a resumable upload the user gave up on — the counterpart to
  // cancelling one that's actually running. Used when a paused or failed row is
  // dismissed, since its chunks are still sitting in the channel.
  async discardResumable(localPath, destFolder) {
    if (!this.resumeStore) return 0;
    let stat;
    try {
      stat = await this.files.stat(localPath);
    } catch (e) {
      return 0; // file's gone; the sweep will catch the chunks
    }
    const key = resumeKey({
      localPath, size: stat.size, mtimeMs: stat.mtimeMs,
      dest: normalizePath(destFolder), channelId: this.channelId,
    });
    const entry = this.resumeStore.get(key);
    if (!entry) return 0;
    const ids = Object.values(entry.chunks || {}).filter(Boolean);
    await this._deleteMessages(ids);
    this.resumeStore.delete(key);
    return ids.length;
  }

  // Stopping mid-folder keeps the files already uploaded (they're in metadata
  // and would have to be trashed individually anyway) and stops before the next.
  async uploadFolder(localFolder, destFolder, onProgress, control = {}) {
    this._ensureReady();
    if (!this.files.walk) throw new Error('Folder upload is not supported on this platform');
    const folderName = fileBasename(localFolder);
    const targetRoot = joinPath(destFolder, folderName);
    const items = await this.files.walk(localFolder);
    items.sort((a, b) => String(a.abs).localeCompare(String(b.abs)));

    if (items.length === 0) {
      await this.createFolder(targetRoot);
      return [];
    }

    const results = [];
    for (let i = 0; i < items.length; i++) {
      if (control.isPaused && control.isPaused()) throw new UploadPaused();
      if (control.isCanceled && control.isCanceled()) throw new UploadCanceled();
      const item = items[i];
      const dest = joinPath(targetRoot, item.relDir);
      if (onProgress) onProgress(i + 1, items.length, fileBasename(item.abs));
      results.push(await this.upload(item.abs, dest, null, control));
    }
    return results;
  }

  // ---- download ----------------------------------------------------

  async _fetchChunkBytes(msgId) {
    const msg = await this._request(`/channels/${this.channelId}/messages/${msgId}`);
    const att = msg.attachments && msg.attachments[0];
    if (!att) throw new Error(`Chunk message ${msgId} has no attachment`);
    return this.api.fetchBinary(att.url);
  }

  getEntry(fileId) {
    return this.metadata.files.find((f) => f.id === fileId) || null;
  }

  // Fetches up to DOWNLOAD_CONCURRENCY chunks at once but hands them to
  // `onChunk` strictly in order, so a download streams to disk as before while
  // never holding more than that many chunks in memory. Each chunk is two
  // round trips (message lookup, then the CDN), so one at a time spent most of
  // its time waiting.
  // One chunk as plaintext: decrypted when the file is encrypted.
  async _fetchChunk(entry, idx) {
    if (entry.enc && !this.key) throw new DriveLocked();
    const bytes = await this._fetchChunkBytes(entry.chunks[idx]);
    return entry.enc ? decryptChunk(this.key, entry.encFileId || entry.id, idx, bytes) : bytes;
  }

  async _fetchChunksInOrder(entry, onChunk, onProgress) {
    if (entry.enc && !this.key) throw new DriveLocked();
    const total = entry.chunks.length;
    const limit = Math.max(1, Math.min(DOWNLOAD_CONCURRENCY, total));
    const pending = [];
    let started = 0;
    const startNext = () => {
      const p = this._fetchChunk(entry, started++);
      p.catch(() => {}); // awaited below in order; this only stops an early failure being reported as unhandled
      pending.push(p);
    };
    while (started < total && pending.length < limit) startNext();
    for (let i = 0; i < total; i++) {
      const bytes = await pending.shift();
      if (started < total) startNext();
      await onChunk(bytes, i);
      if (onProgress) onProgress(i + 1, total);
    }
  }

  async download(fileId, destPath, onProgress) {
    this._ensureReady();
    const entry = this.getEntry(fileId);
    if (!entry) throw new Error(`File ${fileId} not in metadata`);
    const writer = await this.files.createWriter(destPath);
    try {
      await this._fetchChunksInOrder(entry, (bytes) => writer.write(bytes), onProgress);
    } catch (err) {
      // A writer that can discard a half-written file (Android's MediaStore
      // one) does, instead of leaving a broken file in Downloads.
      if (writer.abort) await writer.abort();
      throw err;
    } finally {
      await writer.close();
    }
    return destPath;
  }

  // Reassembles a file entirely in memory (unlike download(), which streams
  // straight to storage) so the UI can preview it without a save round trip.
  // Callers are expected to cap entry.size before calling this — nothing here
  // bounds memory use.
  async fetchBytes(fileId, onProgress) {
    this._ensureReady();
    const entry = this.getEntry(fileId);
    if (!entry) throw new Error(`File ${fileId} not in metadata`);
    const parts = [];
    await this._fetchChunksInOrder(entry, (bytes) => { parts.push(bytes); }, onProgress);
    return concatChunks(parts);
  }

  // ---- range reads (video streaming) -------------------------------

  // Plaintext bytes per chunk. Entries written since 2.1 record it; for older
  // ones every chunk but the last has the size of the first, so one lookup
  // answers it.
  async _plainChunkSize(entry) {
    if (entry.chunkSize) return entry.chunkSize;
    if (this._chunkSizeCache.has(entry.id)) return this._chunkSizeCache.get(entry.id);
    if (entry.chunks.length <= 1) return Math.max(1, entry.size);
    const msg = await this._request(`/channels/${this.channelId}/messages/${entry.chunks[0]}`);
    const att = msg.attachments && msg.attachments[0];
    if (!att || !att.size) throw new Error('Chunk message has no attachment');
    this._chunkSizeCache.set(entry.id, att.size);
    return att.size;
  }

  _cachedChunk(entry, idx) {
    const k = `${entry.id}:${idx}`;
    let p = this._rangeCache.get(k);
    if (p) { this._rangeCache.delete(k); this._rangeCache.set(k, p); return p; }
    p = this._fetchChunk(entry, idx);
    p.catch(() => this._rangeCache.delete(k));
    this._rangeCache.set(k, p);
    while (this._rangeCache.size > RANGE_CACHE_CHUNKS) this._rangeCache.delete(this._rangeCache.keys().next().value);
    return p;
  }

  // Yields the bytes [start, end] (inclusive) of a file, fetching only the
  // chunks that cover them and the next one ahead.
  async *readRange(fileId, start, end) {
    this._ensureReady();
    const entry = this.getEntry(fileId);
    if (!entry) throw new Error('File not found');
    if (entry.size === 0 || start > end) return;
    const cs = await this._plainChunkSize(entry);
    const last = Math.min(end, entry.size - 1);
    for (let idx = Math.floor(start / cs); idx * cs <= last; idx++) {
      if ((idx + 1) * cs <= last && idx + 1 < entry.chunks.length) this._cachedChunk(entry, idx + 1);
      const bytes = await this._cachedChunk(entry, idx);
      const from = Math.max(0, start - idx * cs);
      const to = Math.min(bytes.length, last - idx * cs + 1);
      yield bytes.subarray(from, to);
    }
  }

  async getShareLink(fileId) {
    this._ensureReady();
    const entry = this.getEntry(fileId);
    if (!entry || !entry.chunks.length) throw new Error('File not found');
    const msg = await this._request(`/channels/${this.channelId}/messages/${entry.chunks[0]}`);
    const att = msg.attachments && msg.attachments[0];
    if (!att) throw new Error('No attachment found');
    return { url: att.url, multiChunk: entry.chunks.length > 1 };
  }

  // ---- file mutations ----------------------------------------------

  // Chunks of removed entries that no remaining entry shares (duplicates link
  // the same chunks). Call after taking the entries out of metadata.
  _unsharedChunks(removed) {
    const inUse = new Set();
    for (const f of this.metadata.files) for (const c of f.chunks) inUse.add(c);
    const out = new Set();
    for (const f of removed) for (const c of f.chunks) if (!inUse.has(c)) out.add(c);
    return [...out];
  }

  async deleteFile(fileId) {
    return this._withLock(async () => {
      const idx = this.metadata.files.findIndex((f) => f.id === fileId);
      if (idx === -1) return null;
      const [entry] = this.metadata.files.splice(idx, 1);
      await this._deleteMessages(this._unsharedChunks([entry]));
      await this.saveMetadata();
      return entry;
    });
  }

  async trashFile(fileId) {
    return this._withLock(async () => {
      const entry = this.metadata.files.find((f) => f.id === fileId);
      if (!entry) return null;
      entry.trashed = true;
      entry.starred = false;
      await this.saveMetadata();
      return entry;
    });
  }

  async restoreFile(fileId) {
    return this._withLock(async () => {
      const entry = this.metadata.files.find((f) => f.id === fileId);
      if (!entry) return null;
      entry.trashed = false;
      await this.saveMetadata();
      return entry;
    });
  }

  // Reports progress per deleted chunk, not per file: one 4 GB file is hundreds
  // of DELETEs and would otherwise sit at 0% for minutes.
  async emptyTrash(onProgress) {
    return this._withLock(async () => {
      const trashed = this.metadata.files.filter((f) => f.trashed);
      const kept = this.metadata.files.filter((f) => !f.trashed);
      const all = this.metadata.files;
      this.metadata.files = kept;
      const doomed = new Set(this._unsharedChunks(trashed));
      this.metadata.files = all;
      const total = doomed.size;
      let done = 0;
      if (onProgress) onProgress(0, total, null);
      for (const entry of trashed) {
        for (const msgId of entry.chunks) {
          if (!doomed.delete(msgId)) continue;
          await this._request(`/channels/${this.channelId}/messages/${msgId}`, { method: 'DELETE' }).catch(() => {});
          done += 1;
          if (onProgress) onProgress(done, total, entry.name);
        }
      }
      this.metadata.files = kept;
      await this.saveMetadata();
      return { files: trashed.length, chunks: total };
    });
  }

  async starFile(fileId, val) {
    return this._withLock(async () => {
      const entry = this.metadata.files.find((f) => f.id === fileId);
      if (!entry) return null;
      entry.starred = !!val;
      await this.saveMetadata();
      return entry;
    });
  }

  async renameFile(fileId, newName) {
    return this._withLock(async () => {
      const entry = this.metadata.files.find((f) => f.id === fileId);
      if (!entry || !newName) return null;
      entry.name = newName;
      await this.saveMetadata();
      return entry;
    });
  }

  async addTag(fileId, tag) {
    return this._withLock(async () => {
      const entry = this.metadata.files.find((f) => f.id === fileId);
      if (!entry || entry.tags.includes(tag)) return entry || null;
      entry.tags.push(tag);
      await this.saveMetadata();
      return entry;
    });
  }

  async removeTag(fileId, tag) {
    return this._withLock(async () => {
      const entry = this.metadata.files.find((f) => f.id === fileId);
      if (!entry) return null;
      entry.tags = entry.tags.filter((t) => t !== tag);
      await this.saveMetadata();
      return entry;
    });
  }

  // ---- batch -------------------------------------------------------
  // Every single-file mutation above re-uploads the metadata file (three
  // Discord requests). Acting on a selection through those would pay that per
  // file, so these apply the whole selection and save once.

  // Only the starred/trashed flags; trashing also unstars, as trashFile does.
  async updateFiles(fileIds, patch) {
    return this._withLock(async () => {
      const ids = new Set(fileIds);
      let changed = 0;
      for (const entry of this.metadata.files) {
        if (!ids.has(entry.id)) continue;
        if ('trashed' in patch) { entry.trashed = !!patch.trashed; if (entry.trashed) entry.starred = false; }
        if ('starred' in patch && !entry.trashed) entry.starred = !!patch.starred;
        changed += 1;
      }
      if (changed) await this.saveMetadata();
      return changed;
    });
  }

  async moveFiles(fileIds, destFolder) {
    return this._withLock(async () => {
      const ids = new Set(fileIds);
      const dest = normalizePath(destFolder);
      let changed = 0;
      for (const entry of this.metadata.files) {
        if (!ids.has(entry.id) || entry.path === dest) continue;
        entry.path = dest;
        changed += 1;
      }
      if (dest && !this.metadata.folders.includes(dest)) this.metadata.folders.push(dest);
      if (changed) await this.saveMetadata();
      return changed;
    });
  }

  // Metadata only: chunks don't know which folder they're in.
  async renameFolder(oldPath, newPath) {
    return this._withLock(async () => {
      const from = normalizePath(oldPath);
      const to = normalizePath(newPath);
      if (!from || !to) throw new Error('Cannot rename root');
      if (from === to) return 0;
      if (to.startsWith(`${from}/`)) throw new Error('Cannot move a folder inside itself');
      const prefix = `${from}/`;
      const remap = (p) => (p === from ? to : (p.startsWith(prefix) ? to + p.slice(from.length) : p));
      let changed = 0;
      for (const entry of this.metadata.files) {
        const next = remap(entry.path);
        if (next !== entry.path) { entry.path = next; changed += 1; }
      }
      this.metadata.folders = [...new Set(this.metadata.folders.map(remap))];
      if (!this.metadata.folders.includes(to)) this.metadata.folders.push(to);
      await this.saveMetadata();
      return changed;
    });
  }

  // ---- folders -------------------------------------------------------

  async createFolder(folderPath) {
    return this._withLock(async () => {
      const p = normalizePath(folderPath);
      if (!p) return;
      if (!this.metadata.folders.includes(p)) {
        this.metadata.folders.push(p);
        await this.saveMetadata();
      }
    });
  }

  async deleteFolder(folderPath) {
    return this._withLock(async () => {
      const p = normalizePath(folderPath);
      if (!p) throw new Error('Cannot delete root');
      const prefix = `${p}/`;
      const targets = this.metadata.files.filter((f) => f.path === p || f.path.startsWith(prefix));
      this.metadata.files = this.metadata.files.filter((f) => !(f.path === p || f.path.startsWith(prefix)));
      await this._deleteMessages(this._unsharedChunks(targets));
      this.metadata.folders = this.metadata.folders.filter((fp) => fp !== p && !fp.startsWith(prefix));
      await this.saveMetadata();
      return targets.length;
    });
  }

  // ---- encryption ----------------------------------------------------

  _encrypting() {
    return !!(this.encryptUploads && this.key && this.metadata.encryption);
  }

  encryptionState() {
    return {
      configured: !!this.metadata.encryption,
      unlocked: !!this.key,
      encryptUploads: this._encrypting(),
      encryptedFiles: this.metadata.files.filter((f) => f.enc).length,
    };
  }

  async _useKey(raw) {
    this.key = await importDataKey(raw);
    this.keyRaw = raw;
    this._dedupSalt = await dedupSalt(raw);
  }

  // A key stored on this device from before is dropped if the drive's key has
  // changed (or the drive isn't encrypted any more).
  async _checkStoredKey() {
    if (!this.keyRaw) return;
    const rec = this.metadata.encryption;
    if (!rec || rec.keyId !== await keyIdOf(this.keyRaw)) this.lock();
  }

  // Returns the raw key as base64, for the device to keep.
  async setupEncryption(passphrase) {
    this._ensureReady();
    if (!passphrase || passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters');
    return this._withLock(async () => {
      if (this.metadata.encryption) throw new Error('This drive already has encryption set up');
      const { record, raw } = await createKeyring(passphrase);
      this.metadata.encryption = record;
      await this.saveMetadata();
      await this._useKey(raw);
      return toBase64(raw);
    });
  }

  async unlock(passphrase) {
    const rec = this.metadata.encryption;
    if (!rec) throw new Error('This drive has no encryption set up');
    const raw = await unwrapKeyring(rec, passphrase);
    await this._useKey(raw);
    return toBase64(raw);
  }

  async unlockWithStoredKey(b64) {
    const raw = fromBase64(b64);
    const rec = this.metadata.encryption;
    if (!rec || rec.keyId !== await keyIdOf(raw)) return false;
    await this._useKey(raw);
    return true;
  }

  lock() {
    this.key = null;
    this.keyRaw = null;
    this._rangeCache.clear();
  }

  async changePassphrase(passphrase) {
    this._ensureReady();
    if (!this.keyRaw) throw new Error('Unlock the drive first');
    if (!passphrase || passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters');
    return this._withLock(async () => {
      this.metadata.encryption = await wrapKeyring(this.keyRaw, passphrase);
      await this.saveMetadata();
    });
  }

  // ---- channel scan: integrity check, repair, rebuild -------------------

  // Reads every message in the channel, newest first, 100 per request.
  async _scanChannel(onProgress) {
    const chunks = new Map();  // message id → { fileId, idx, total, name, size, enc, empty }
    const indexes = [];        // index messages, live and backups
    let before = null;
    let seen = 0;
    for (;;) {
      const q = `limit=100${before ? `&before=${before}` : ''}`;
      const page = await this._request(`/channels/${this.channelId}/messages?${q}`);
      if (!Array.isArray(page) || !page.length) break;
      for (const msg of page) {
        const content = msg.content || '';
        const att = msg.attachments && msg.attachments[0];
        if (content.startsWith(METADATA_MARKER) || content.startsWith(BACKUP_MARKER)) {
          const meta = msg.attachments && msg.attachments.find((a) => a.filename === METADATA_FILENAME);
          if (meta) indexes.push({ id: msg.id, at: snowflakeTime(msg.id), live: msg.id === this.metadataMessageId, size: meta.size });
          continue;
        }
        const m = CHUNK_LABEL.exec(content);
        if (m && att) {
          chunks.set(msg.id, {
            fileId: m[1], idx: Number(m[2]) - 1, total: Number(m[3]),
            empty: !!m[4], enc: !!m[5], name: m[6] || '', size: att.size || 0, at: snowflakeTime(msg.id),
          });
        }
      }
      seen += page.length;
      before = page[page.length - 1].id;
      if (onProgress) onProgress(seen);
      if (page.length < 100) break;
    }
    return { chunks, indexes, messages: seen };
  }

  // Compares the index with what's actually in the channel. Reports files
  // whose chunks are gone (`broken`) and chunk sets nothing references
  // (`orphans`: lost from the index, or left by an interrupted upload).
  async checkDrive(onProgress) {
    this._ensureReady();
    const scan = await this._scanChannel(onProgress);
    const referenced = new Set();
    for (const f of this.metadata.files) for (const c of f.chunks) referenced.add(c);
    if (this.resumeStore && this.resumeStore.all) {
      for (const { entry } of this.resumeStore.all()) for (const c of Object.values(entry.chunks || {})) referenced.add(c);
    }

    const broken = [];
    for (const f of this.metadata.files) {
      const missing = f.chunks.filter((c) => !scan.chunks.has(c)).length;
      if (missing) broken.push({ id: f.id, name: f.name, path: f.path, missing, total: f.chunks.length, trashed: f.trashed });
    }

    const groups = new Map();
    for (const [msgId, c] of scan.chunks) {
      if (referenced.has(msgId)) continue;
      let g = groups.get(c.fileId);
      if (!g) groups.set(c.fileId, (g = { fileId: c.fileId, name: '', total: c.total, enc: c.enc, at: c.at, parts: new Map() }));
      if (c.name) g.name = c.name;
      g.at = Math.min(g.at, c.at);
      // Two attempts at one chunk (a retry) — the newer message wins.
      const prev = g.parts.get(c.idx);
      if (!prev || BigInt(msgId) > BigInt(prev.msgId)) g.parts.set(c.idx, { msgId, size: c.size, empty: c.empty });
    }
    const orphans = [...groups.values()].map((g) => {
      const complete = g.parts.size === g.total && [...Array(g.total).keys()].every((i) => g.parts.has(i));
      const sizes = [...g.parts.values()].map((p) => (p.empty ? 0 : p.size));
      const overhead = g.enc ? CHUNK_OVERHEAD : 0;
      return {
        fileId: g.fileId,
        name: g.name || `Recovered file ${g.fileId.slice(0, 8)}${g.enc ? ' (encrypted)' : ''}`,
        enc: g.enc, complete, have: g.parts.size, total: g.total,
        size: sizes.reduce((n, s) => n + Math.max(0, s - overhead), 0),
        chunkSize: g.parts.has(0) ? Math.max(1, g.parts.get(0).size - overhead) : 0,
        created: g.at / 1000,
        chunks: [...Array(g.total).keys()].map((i) => (g.parts.get(i) || {}).msgId || null),
      };
    }).sort((a, b) => b.created - a.created);

    const backupIds = new Set((this.metadata.backups || []).map((b) => b.id));
    const indexes = scan.indexes.map((x) => ({ ...x, listed: backupIds.has(x.id) }));
    this._lastScan = { orphans, broken };
    return {
      messages: scan.messages,
      files: this.metadata.files.length,
      broken,
      orphans: orphans.map(({ chunks, ...o }) => o),
      indexes,
      checkedAt: Date.now(),
    };
  }

  // Adds complete orphans back to the index, in `folder`.
  async recoverOrphans(fileIds, folder = 'Recovered') {
    if (!this._lastScan) throw new Error('Run a check first');
    const want = new Set(fileIds);
    const picks = this._lastScan.orphans.filter((o) => o.complete && want.has(o.fileId));
    return this._withLock(async () => {
      const dest = normalizePath(folder);
      const known = new Set(this.metadata.files.map((f) => f.id));
      let added = 0;
      for (const o of picks) {
        if (known.has(o.fileId)) continue;
        this.metadata.files.push({
          id: o.fileId, name: o.name, size: o.size, chunks: o.chunks, created: o.created,
          path: dest, tags: [], starred: false, trashed: false,
          ...(o.chunkSize && o.total > 1 ? { chunkSize: o.chunkSize } : {}),
          ...(o.enc ? { enc: 1 } : {}),
        });
        added += 1;
      }
      if (dest && added && !this.metadata.folders.includes(dest)) this.metadata.folders.push(dest);
      if (added) await this.saveMetadata();
      this._lastScan.orphans = this._lastScan.orphans.filter((o) => !picks.includes(o));
      return added;
    });
  }

  async deleteOrphans(fileIds) {
    if (!this._lastScan) throw new Error('Run a check first');
    const want = new Set(fileIds);
    const picks = this._lastScan.orphans.filter((o) => want.has(o.fileId));
    const referenced = new Set();
    for (const f of this.metadata.files) for (const c of f.chunks) referenced.add(c);
    const ids = picks.flatMap((o) => o.chunks.filter((c) => c && !referenced.has(c)));
    await this._deleteMessages(ids);
    this._lastScan.orphans = this._lastScan.orphans.filter((o) => !picks.includes(o));
    return ids.length;
  }

  // Broken files can't be downloaded; this takes them out of the index and
  // deletes whatever chunks of theirs are left.
  async removeBroken(fileIds) {
    const want = new Set(fileIds);
    return this._withLock(async () => {
      const gone = this.metadata.files.filter((f) => want.has(f.id));
      this.metadata.files = this.metadata.files.filter((f) => !want.has(f.id));
      await this._deleteMessages(this._unsharedChunks(gone));
      if (gone.length) await this.saveMetadata();
      if (this._lastScan) this._lastScan.broken = this._lastScan.broken.filter((b) => !want.has(b.id));
      return gone.length;
    });
  }

  // ---- index backups ----------------------------------------------------

  listBackups() {
    return (this.metadata.backups || []).slice().reverse();
  }

  // Replaces the index with an earlier copy, keeping the current one as a
  // backup first. Anything uploaded since that copy shows up as orphans in
  // Check drive, where it can be recovered.
  async restoreBackup(messageId) {
    this._ensureReady();
    return this._withLock(async () => {
      const msg = await this._request(`/channels/${this.channelId}/messages/${messageId}`);
      const att = msg.attachments && msg.attachments.find((a) => a.filename === METADATA_FILENAME);
      if (!att) throw new Error('That message holds no index');
      const restored = normalizeMetadata(JSON.parse(await this.api.fetchText(att.url)));
      const keepBackups = this.metadata.backups || [];
      const keepEnc = this.metadata.encryption;
      this.metadata.files = restored.files;
      this.metadata.folders = restored.folders;
      this.metadata.encryption = restored.encryption || keepEnc;
      if (!this.metadata.encryption) delete this.metadata.encryption;
      this.metadata.backups = keepBackups.filter((b) => b.id !== messageId);
      await this.saveMetadata({ forceBackup: true });
      this._lastScan = null;
      return this.metadata.files.length;
    });
  }

  snapshot() {
    return {
      status: this.status,
      channelId: this.channelId,
      channelName: this.channelName,
      guildName: this.guildName,
      chunkLimitMb: this.chunkSize ? +(this.chunkSize / (1024 * 1024)).toFixed(1) : null,
      files: this.metadata.files,
      folders: this.metadata.folders,
      encryption: this.encryptionState(),
      backups: this.listBackups(),
    };
  }
}

module.exports = {
  DiscordDrive,
  UploadCanceled, UploadPaused, isCancelError, isPauseError, DriveLocked,
  BACKUP_MARKER, BACKUP_INTERVAL_MS, BACKUP_KEEP,
  DEFAULT_CONCURRENCY, DOWNLOAD_CONCURRENCY, RESUME_MAX_AGE_MS, METADATA_FILENAME, METADATA_MARKER,
};
