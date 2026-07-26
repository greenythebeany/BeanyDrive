'use strict';

// Discord-backed cloud storage client. Reimplements the functionality of
// DiscordCloudStorage's bot.py + storage.py + metadata.py, but talks to
// Discord purely over REST (no gateway connection) since every operation
// used here — sending/fetching/deleting/pinning channel messages — has a
// REST endpoint, and REST message fetches always include full content
// regardless of the privileged Message Content Intent (that restriction
// only applies to gateway-dispatched events).

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { normalizePath, joinPath } = require('./util');

const { resumeKey } = require('./upload-resume');

const API_BASE = 'https://discord.com/api/v10';
const SAFETY_BYTES = 256 * 1024;
// 5 matches Discord's per-channel allowance of 5 message creates per 5s, so
// the pool stays saturated without spending most of its time in 429 backoff.
const DEFAULT_CONCURRENCY = 5;
// Unfinished uploads older than this are given up on: their chunks are deleted
// and the resume record dropped, so abandoned attempts can't accumulate in the
// channel forever.
const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_FILENAME = 'beanydrive_metadata.json';
const METADATA_MARKER = '[BeanyDrive metadata - do not delete]';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Thrown when the user cancels an upload. Carries a flag rather than relying
// on the message so main.js can tell a cancel apart from a real failure and
// report it as such instead of surfacing it as an error.
class UploadCanceled extends Error {
  constructor() {
    super('Upload canceled');
    this.name = 'UploadCanceled';
    this.canceled = true;
  }
}

// An in-flight chunk POST aborted via AbortController surfaces as a DOMException
// named 'AbortError' rather than our own error type.
function isCancelError(err) {
  return !!err && (err.canceled === true || err.name === 'AbortError');
}

function tierLimitBytes(premiumTier) {
  if (premiumTier === 3) return 100 * 1024 * 1024;
  if (premiumTier === 2) return 50 * 1024 * 1024;
  return 10 * 1024 * 1024; // tier 0/1: current Discord baseline upload limit
}

async function responseError(res) {
  let data = {};
  try { data = await res.json(); } catch (e) { /* body wasn't JSON */ }
  const err = new Error(data.message || `Discord API error ${res.status}`);
  err.status = res.status;
  err.code = data.code;
  return err;
}

// Shared low-level request helper — used both by DiscordDrive instances and
// the standalone testConnection() check that runs before any state exists.
async function apiRequest(token, pathname, opts = {}) {
  const headers = Object.assign({ Authorization: `Bot ${token}` }, opts.headers || {});
  let attempt = 0;
  for (;;) {
    const res = await fetch(`${API_BASE}${pathname}`, { ...opts, headers });
    if (res.status === 429) {
      attempt += 1;
      if (attempt > 5) throw await responseError(res);
      let retryAfter = 1;
      try { retryAfter = (await res.json()).retry_after || 1; } catch (e) { /* ignore */ }
      await sleep(Math.ceil(retryAfter * 1000));
      continue;
    }
    if (!res.ok) throw await responseError(res);
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }
}

async function testConnection(token, channelId) {
  const channel = await apiRequest(token, `/channels/${channelId}`);
  if (channel.type !== 0) throw new Error('Configured channel is not a text channel');
  const guild = await apiRequest(token, `/guilds/${channel.guild_id}`);
  return { channelName: channel.name, guildName: guild.name };
}

// Chunks are read by absolute offset rather than streamed, so several can be
// in flight at once and a resumed upload can skip straight to the parts that
// are still missing.
async function readChunk(handle, idx, chunkSize, size) {
  const start = idx * chunkSize;
  const length = Math.min(chunkSize, size - start);
  const buffer = Buffer.alloc(length);
  await handle.read(buffer, 0, length, start);
  return buffer;
}

function chunkArrayToMap(chunkIds) {
  const map = {};
  chunkIds.forEach((msgId, idx) => { if (msgId) map[idx] = msgId; });
  return map;
}

// Serializes metadata read-modify-write cycles so concurrent IPC calls
// (e.g. star + upload finishing around the same time) can't clobber each
// other's save.
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

class DiscordDrive extends EventEmitter {
  constructor() {
    super();
    this.token = null;
    this.channelId = null;
    this.channelName = null;
    this.guildName = null;
    this.chunkSizeMb = 10;
    this.chunkSize = null;
    this.uploadConcurrency = DEFAULT_CONCURRENCY;
    // Set by main.js; when absent, uploads simply aren't resumable.
    this.resumeStore = null;
    this.metadata = { version: 3, files: [], folders: [] };
    this.metadataMessageId = null;
    this.status = 'disconnected';
    this._mutex = new Mutex();
  }

  _withLock(fn) { return this._mutex.lock(fn); }

  _request(pathname, opts) {
    if (!this.token) throw new Error('Not connected');
    return apiRequest(this.token, pathname, opts);
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
          const res = await fetch(att.url);
          const raw = await res.text();
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

  // ---- upload / download ------------------------------------------

  async _sendChunk(fileId, idx, total, name, buffer, isEmpty, signal) {
    const form = new FormData();
    const label = isEmpty
      ? `\`${fileId}\` chunk 1/1 (empty) - ${name}`
      : `\`${fileId}\` chunk ${idx + 1}/${total} - ${name}`;
    form.set('payload_json', JSON.stringify({ content: label }));
    const filename = `${name}.part${String(idx).padStart(4, '0')}`;
    form.set('files[0]', new Blob([buffer]), filename);
    const msg = await this._request(`/channels/${this.channelId}/messages`, { method: 'POST', body: form, signal });
    return msg.id;
  }

  // Best-effort cleanup of chunk messages that are no longer referenced by
  // metadata — used when an upload is retried at a smaller chunk size, and
  // when one is canceled partway through.
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

  // `control` is an optional { signal, isCanceled } pair: the AbortSignal kills
  // the chunk POSTs currently in flight, and isCanceled() is checked before each
  // chunk. On cancel the partial chunks are deleted so nothing is orphaned; on
  // failure they're kept and recorded, so retrying resumes instead of restarting.
  async upload(localPath, destFolder, onProgress, control = {}) {
    this._ensureReady();
    const checkCanceled = () => {
      if (control.isCanceled && control.isCanceled()) throw new UploadCanceled();
    };
    checkCanceled();
    const name = path.basename(localPath);
    const stat = await fsp.stat(localPath);
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

    const fileId = (saved && saved.fileId) || crypto.randomUUID().replace(/-/g, '');
    let chunkIds;

    if (size === 0) {
      const msgId = await this._sendChunk(fileId, 0, 1, name, Buffer.alloc(0), true, control.signal);
      chunkIds = [msgId];
      if (onProgress) onProgress(1, 1);
    } else {
      chunkIds = await this._uploadChunks({
        localPath, size, fileId, name, dest, key, saved, onProgress, control, checkCanceled,
      });
    }

    // A cancel that lands between the last chunk and the metadata save still
    // counts — without this the file would silently complete anyway.
    try {
      checkCanceled();
    } catch (err) {
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
  async _uploadChunks({ localPath, size, fileId, name, dest, key, saved, onProgress, control, checkCanceled }) {
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

      const handle = await fsp.open(localPath, 'r');
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
            checkCanceled();
            const data = await readChunk(handle, idx, this.chunkSize, size);
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
        await handle.close();
      }

      if (!failure) return chunkIds;

      const uploaded = chunkIds.filter(Boolean);
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

  // Canceling mid-folder keeps the files already uploaded (they're in metadata
  // and would have to be trashed individually anyway) and stops before the next.
  async uploadFolder(localFolder, destFolder, onProgress, control = {}) {
    this._ensureReady();
    const folderName = path.basename(localFolder);
    const targetRoot = joinPath(destFolder, folderName);
    const items = await this._walkFiles(localFolder);
    items.sort((a, b) => a.abs.localeCompare(b.abs));

    if (items.length === 0) {
      await this.createFolder(targetRoot);
      return [];
    }

    const results = [];
    for (let i = 0; i < items.length; i++) {
      if (control.isCanceled && control.isCanceled()) throw new UploadCanceled();
      const item = items[i];
      const dest = joinPath(targetRoot, item.relDir);
      if (onProgress) onProgress(i + 1, items.length, path.basename(item.abs));
      results.push(await this.upload(item.abs, dest, null, control));
    }
    return results;
  }

  async _walkFiles(dir, relDir = '') {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    let out = [];
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        out = out.concat(await this._walkFiles(abs, relDir ? `${relDir}/${ent.name}` : ent.name));
      } else if (ent.isFile()) {
        out.push({ abs, relDir });
      }
    }
    return out;
  }

  async _fetchChunkBytes(msgId) {
    const msg = await this._request(`/channels/${this.channelId}/messages/${msgId}`);
    const att = msg.attachments && msg.attachments[0];
    if (!att) throw new Error(`Chunk message ${msgId} has no attachment`);
    const res = await fetch(att.url);
    return Buffer.from(await res.arrayBuffer());
  }

  getEntry(fileId) {
    return this.metadata.files.find((f) => f.id === fileId) || null;
  }

  async download(fileId, destPath, onProgress) {
    this._ensureReady();
    const entry = this.getEntry(fileId);
    if (!entry) throw new Error(`File ${fileId} not in metadata`);
    const total = entry.chunks.length;
    const handle = await fsp.open(destPath, 'w');
    try {
      for (let i = 0; i < total; i++) {
        await handle.write(await this._fetchChunkBytes(entry.chunks[i]));
        if (onProgress) onProgress(i + 1, total);
      }
    } finally {
      await handle.close();
    }
    return destPath;
  }

  // Reassembles a file entirely in memory (unlike download(), which streams
  // straight to disk) so the renderer can preview it without a Save-As
  // round trip. Callers are expected to cap entry.size before calling this
  // — nothing here bounds memory use.
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
    return Buffer.concat(parts);
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
      for (const msgId of entry.chunks) {
        await this._request(`/channels/${this.channelId}/messages/${msgId}`, { method: 'DELETE' }).catch(() => {});
      }
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

  async emptyTrash() {
    return this._withLock(async () => {
      const trashed = this.metadata.files.filter((f) => f.trashed);
      for (const entry of trashed) {
        for (const msgId of entry.chunks) {
          await this._request(`/channels/${this.channelId}/messages/${msgId}`, { method: 'DELETE' }).catch(() => {});
        }
      }
      this.metadata.files = this.metadata.files.filter((f) => !f.trashed);
      await this.saveMetadata();
      return trashed.length;
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
      for (const entry of targets) {
        for (const msgId of entry.chunks) {
          await this._request(`/channels/${this.channelId}/messages/${msgId}`, { method: 'DELETE' }).catch(() => {});
        }
      }
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

module.exports = { DiscordDrive, testConnection, UploadCanceled, isCancelError };
