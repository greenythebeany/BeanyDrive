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

const API_BASE = 'https://discord.com/api/v10';
const SAFETY_BYTES = 256 * 1024;
const METADATA_FILENAME = 'beanydrive_metadata.json';
const METADATA_MARKER = '[BeanyDrive metadata - do not delete]';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function* iterChunks(filePath, chunkSize) {
  const handle = await fsp.open(filePath, 'r');
  try {
    let idx = 0;
    const buffer = Buffer.alloc(chunkSize);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, null);
      if (bytesRead === 0) return;
      yield [idx, Buffer.from(buffer.subarray(0, bytesRead))];
      idx += 1;
    }
  } finally {
    await handle.close();
  }
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
    this.chunkSizeMb = 25;
    this.chunkSize = null;
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

  async connect(token, channelId, chunkSizeMb) {
    this.token = token;
    this.channelId = String(channelId);
    this.chunkSizeMb = chunkSizeMb || 25;
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

  async _sendChunk(fileId, idx, total, name, buffer, isEmpty) {
    const form = new FormData();
    const label = isEmpty
      ? `\`${fileId}\` chunk 1/1 (empty) - ${name}`
      : `\`${fileId}\` chunk ${idx + 1}/${total} - ${name}`;
    form.set('payload_json', JSON.stringify({ content: label }));
    const filename = `${name}.part${String(idx).padStart(4, '0')}`;
    form.set('files[0]', new Blob([buffer]), filename);
    const msg = await this._request(`/channels/${this.channelId}/messages`, { method: 'POST', body: form });
    return msg.id;
  }

  async upload(localPath, destFolder, onProgress) {
    this._ensureReady();
    const fileId = crypto.randomUUID().replace(/-/g, '');
    const name = path.basename(localPath);
    const size = (await fsp.stat(localPath)).size;
    const dest = normalizePath(destFolder);
    let chunkIds = [];

    if (size === 0) {
      const msgId = await this._sendChunk(fileId, 0, 1, name, Buffer.alloc(0), true);
      chunkIds.push(msgId);
      if (onProgress) onProgress(1, 1);
    } else {
      let total = Math.ceil(size / this.chunkSize);
      let attempt = 0;
      for (;;) {
        try {
          chunkIds = [];
          for await (const [idx, data] of iterChunks(localPath, this.chunkSize)) {
            const msgId = await this._sendChunk(fileId, idx, total, name, data, false);
            chunkIds.push(msgId);
            if (onProgress) onProgress(idx + 1, total);
          }
          break;
        } catch (err) {
          if (err.status === 413 && this.chunkSize > 1024 * 1024) {
            this.chunkSize = Math.floor(this.chunkSize / 2);
            this.emit('status', `Limit hit, retrying at ${(this.chunkSize / (1024 * 1024)).toFixed(1)} MB chunks...`);
            for (const mid of chunkIds) {
              await this._request(`/channels/${this.channelId}/messages/${mid}`, { method: 'DELETE' }).catch(() => {});
            }
            total = Math.ceil(size / this.chunkSize);
            attempt += 1;
            if (attempt > 6) throw err;
            continue;
          }
          throw err;
        }
      }
    }

    return this._withLock(async () => {
      const entry = {
        id: fileId, name, size, chunks: chunkIds, created: Date.now() / 1000,
        path: dest, tags: [], starred: false, trashed: false,
      };
      this.metadata.files.push(entry);
      await this.saveMetadata();
      return entry;
    });
  }

  async uploadFolder(localFolder, destFolder, onProgress) {
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
      const item = items[i];
      const dest = joinPath(targetRoot, item.relDir);
      if (onProgress) onProgress(i + 1, items.length, path.basename(item.abs));
      results.push(await this.upload(item.abs, dest));
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

  async download(fileId, destPath, onProgress) {
    this._ensureReady();
    const entry = this.metadata.files.find((f) => f.id === fileId);
    if (!entry) throw new Error(`File ${fileId} not in metadata`);
    const total = entry.chunks.length;
    const handle = await fsp.open(destPath, 'w');
    try {
      for (let i = 0; i < total; i++) {
        const msg = await this._request(`/channels/${this.channelId}/messages/${entry.chunks[i]}`);
        const att = msg.attachments && msg.attachments[0];
        if (!att) throw new Error(`Chunk message ${entry.chunks[i]} has no attachment`);
        const res = await fetch(att.url);
        const buf = Buffer.from(await res.arrayBuffer());
        await handle.write(buf);
        if (onProgress) onProgress(i + 1, total);
      }
    } finally {
      await handle.close();
    }
    return destPath;
  }

  async getShareLink(fileId) {
    this._ensureReady();
    const entry = this.metadata.files.find((f) => f.id === fileId);
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

module.exports = { DiscordDrive, testConnection };
