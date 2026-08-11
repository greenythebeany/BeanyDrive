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

const SAFETY_BYTES = 256 * 1024;
// Discord allows roughly 5 message creates per 5s per channel, so 4 keeps the
// pool busy while leaving headroom before requests start bouncing off 429s.
const DEFAULT_CONCURRENCY = 4;
// Unfinished uploads older than this are given up on: their chunks are deleted
// and the resume record dropped, so abandoned attempts can't accumulate in the
// channel forever.
const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_FILENAME = 'beanydrive_metadata.json';
const METADATA_MARKER = '[BeanyDrive metadata - do not delete]';

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

function normalizeMetadata(data) {
  const files = Array.isArray(data && data.files) ? data.files : [];
  return {
    version: 3,
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size || 0,
      chunks: Array.isArray(f.chunks) ? f.chunks : [],
      created: f.created || Date.now() / 1000,
      path: normalizePath(f.path || ''),
      tags: Array.isArray(f.tags) ? f.tags : [],
      starred: !!f.starred,
      trashed: !!f.trashed,
    })),
    folders: Array.isArray(data && data.folders) ? data.folders.map(normalizePath) : [],
  };
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
    this.metadata = { version: 3, files: [], folders: [] };
    this.metadataMessageId = null;
    this.status = 'disconnected';
    this._mutex = new Mutex();
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
          return;
        }
      }
    }
    this.metadata = { version: 3, files: [], folders: [] };
    this.metadataMessageId = null;
  }

  async saveMetadata() {
    const raw = JSON.stringify(this.metadata, null, 2);
    const form = new FormData();
    form.set('payload_json', JSON.stringify({ content: METADATA_MARKER }));
    form.set('files[0]', new Blob([raw], { type: 'application/json' }), METADATA_FILENAME);
    const msg = await this._request(`/channels/${this.channelId}/messages`, { method: 'POST', body: form });
    await this._request(`/channels/${this.channelId}/pins/${msg.id}`, { method: 'PUT' });
    const oldId = this.metadataMessageId;
    this.metadataMessageId = msg.id;
    if (oldId && oldId !== msg.id) {
      await this._request(`/channels/${this.channelId}/messages/${oldId}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  async refresh() {
    await this.loadMetadata();
  }

  // ---- upload ------------------------------------------------------

  async _sendChunk(fileId, idx, total, name, bytes, isEmpty, signal) {
    const form = new FormData();
    const label = isEmpty
      ? `\`${fileId}\` chunk 1/1 (empty) - ${name}`
      : `\`${fileId}\` chunk ${idx + 1}/${total} - ${name}`;
    form.set('payload_json', JSON.stringify({ content: label }));
    const filename = `${name}.part${String(idx).padStart(4, '0')}`;
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
    if (saved && saved.chunkSize !== this.chunkSize) {
      // Chunk size changed since the interrupted run (a settings edit, or a 413
      // downgrade), so the recorded parts no longer line up with the offsets
      // we'd read now. Start clean rather than assemble a corrupt file.
      await this._abandonUpload(key, Object.values(saved.chunks || {}));
      saved = null;
    }

    const fileId = (saved && saved.fileId) || randomId();
    let chunkIds;

    if (size === 0) {
      const msgId = await this._sendChunk(fileId, 0, 1, name, new Uint8Array(0), true, control.signal);
      chunkIds = [msgId];
      if (onProgress) onProgress(1, 1);
    } else {
      chunkIds = await this._uploadChunks({
        localPath, size, fileId, name, dest, key, saved, onProgress, control, checkStopped,
      });
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

    return this._withLock(async () => {
      const entry = {
        id: fileId, name, size, chunks: chunkIds, created: Date.now() / 1000,
        path: dest, tags: [], starred: false, trashed: false,
      };
      this.metadata.files.push(entry);
      await this.saveMetadata();
      // The chunks belong to metadata now — they're no longer loose parts.
      if (key && this.resumeStore) this.resumeStore.delete(key);
      return entry;
    });
  }

  // Runs up to `uploadConcurrency` chunk POSTs at a time, filling a
  // position-indexed array so the chunk order survives out-of-order completion.
  // Retries the whole file at half the chunk size on 413, as before.
  async _uploadChunks({ localPath, size, fileId, name, dest, key, saved, onProgress, control, checkStopped }) {
    let carried = (saved && saved.chunks) || {};
    let attempt = 0;

    for (;;) {
      const total = Math.ceil(size / this.chunkSize);
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
          try {
            checkStopped();
            const start = idx * this.chunkSize;
            const data = await reader.read(start, Math.min(this.chunkSize, size - start));
            recordChunk(idx, await this._sendChunk(fileId, idx, total, name, data, false, control.signal));
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

      if (!failure) return chunkIds;

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

  async download(fileId, destPath, onProgress) {
    this._ensureReady();
    const entry = this.getEntry(fileId);
    if (!entry) throw new Error(`File ${fileId} not in metadata`);
    const total = entry.chunks.length;
    const writer = await this.files.createWriter(destPath);
    try {
      for (let i = 0; i < total; i++) {
        await writer.write(await this._fetchChunkBytes(entry.chunks[i]));
        if (onProgress) onProgress(i + 1, total);
      }
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
    const total = entry.chunks.length;
    const parts = [];
    for (let i = 0; i < total; i++) {
      parts.push(await this._fetchChunkBytes(entry.chunks[i]));
      if (onProgress) onProgress(i + 1, total);
    }
    return concatChunks(parts);
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

  async deleteFile(fileId) {
    return this._withLock(async () => {
      const idx = this.metadata.files.findIndex((f) => f.id === fileId);
      if (idx === -1) return null;
      const [entry] = this.metadata.files.splice(idx, 1);
      await this._deleteMessages(entry.chunks);
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
      const total = trashed.reduce((n, f) => n + (f.chunks ? f.chunks.length : 0), 0);
      let done = 0;
      if (onProgress) onProgress(0, total, null);
      for (const entry of trashed) {
        for (const msgId of entry.chunks) {
          await this._request(`/channels/${this.channelId}/messages/${msgId}`, { method: 'DELETE' }).catch(() => {});
          done += 1;
          if (onProgress) onProgress(done, total, entry.name);
        }
      }
      this.metadata.files = this.metadata.files.filter((f) => !f.trashed);
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
      for (const entry of targets) await this._deleteMessages(entry.chunks);
      this.metadata.files = this.metadata.files.filter((f) => !(f.path === p || f.path.startsWith(prefix)));
      this.metadata.folders = this.metadata.folders.filter((fp) => fp !== p && !fp.startsWith(prefix));
      await this.saveMetadata();
      return targets.length;
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
    };
  }
}

module.exports = {
  DiscordDrive,
  UploadCanceled, UploadPaused, isCancelError, isPauseError,
  DEFAULT_CONCURRENCY, RESUME_MAX_AGE_MS, METADATA_FILENAME, METADATA_MARKER,
};
