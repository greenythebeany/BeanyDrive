'use strict';

// In-memory stand-ins for Discord and the local filesystem, so the drive core
// can be tested end to end without a network or a bot.

const DISCORD_EPOCH = 1420070400000n;

function createFakeDiscord({ premiumTier = 0 } = {}) {
  const messages = new Map(); // id → { id, content, attachments, pinned }
  const blobs = new Map();    // url → Uint8Array
  let seq = 0n;
  const calls = [];
  const failures = []; // { match(method, path), error } consumed once each

  const nextId = () => String(((BigInt(Date.now()) - DISCORD_EPOCH) << 22n) + (seq++));
  const err = (status, message) => Object.assign(new Error(message), { status });

  async function request(token, pathname, opts = {}) {
    const method = opts.method || 'GET';
    calls.push(`${method} ${pathname}`);
    const fi = failures.findIndex((f) => f.match(method, pathname));
    if (fi !== -1) throw failures.splice(fi, 1)[0].error;

    const [route, query = ''] = pathname.split('?');
    const parts = route.split('/').filter(Boolean);
    if (parts[0] === 'guilds') return { name: 'Test server', premium_tier: premiumTier };
    if (parts[0] !== 'channels') throw err(404, 'Unknown route');
    if (parts.length === 2) return { type: 0, name: 'drive', guild_id: '1' };

    if (parts[2] === 'pins') {
      if (parts.length === 3) return [...messages.values()].filter((m) => m.pinned).reverse();
      const m = messages.get(parts[3]);
      if (!m) throw err(404, 'Unknown Message');
      m.pinned = method === 'PUT';
      return null;
    }

    if (parts[2] === 'messages') {
      if (parts.length === 3 && method === 'POST') {
        const form = opts.body;
        const { content } = JSON.parse(form.get('payload_json'));
        const file = form.get('files[0]');
        const id = nextId();
        const bytes = new Uint8Array(await file.arrayBuffer());
        const url = `mem://${id}`;
        blobs.set(url, bytes);
        messages.set(id, { id, content, pinned: false, attachments: [{ filename: file.name, size: bytes.length, url }] });
        return { id };
      }
      if (parts.length === 3) {
        const params = new URLSearchParams(query);
        const limit = Number(params.get('limit') || 50);
        const before = params.get('before');
        return [...messages.values()]
          .filter((m) => !before || BigInt(m.id) < BigInt(before))
          .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
          .slice(0, limit);
      }
      const m = messages.get(parts[3]);
      if (!m) throw err(404, 'Unknown Message');
      if (method === 'DELETE') { messages.delete(m.id); return null; }
      if (method === 'PATCH') { m.content = JSON.parse(opts.body).content; return m; }
      return m;
    }
    throw err(404, 'Unknown route');
  }

  async function fetchBinary(url) {
    const b = blobs.get(url);
    if (!b) throw new Error('Attachment download failed (404)');
    return b.slice();
  }
  async function fetchText(url) {
    return new TextDecoder().decode(await fetchBinary(url));
  }

  return {
    api: { request, fetchBinary, fetchText },
    messages, calls, blobs,
    failNext(match, error) { failures.push({ match, error }); },
    chunkMessages: () => [...messages.values()].filter((m) => /^`[0-9a-f]{32}` chunk/.test(m.content)),
  };
}

function createMemoryFiles() {
  const files = new Map(); // path → { bytes, mtimeMs }
  return {
    files,
    put(path, bytes) { files.set(path, { bytes, mtimeMs: Date.now() }); },
    get(path) { return files.get(path).bytes; },
    adapter: {
      async stat(p) {
        const f = files.get(p);
        if (!f) throw new Error(`ENOENT ${p}`);
        return { size: f.bytes.length, mtimeMs: f.mtimeMs, name: p.split('/').pop(), isDirectory: false };
      },
      async openReader(p) {
        const f = files.get(p);
        return {
          async read(offset, length) { return f.bytes.slice(offset, offset + length); },
          async close() {},
        };
      },
      async createWriter(p) {
        const parts = [];
        return {
          async write(b) { parts.push(b.slice()); },
          async close() {
            const total = parts.reduce((n, x) => n + x.length, 0);
            const out = new Uint8Array(total);
            let at = 0;
            for (const x of parts) { out.set(x, at); at += x.length; }
            files.set(p, { bytes: out, mtimeMs: Date.now() });
          },
        };
      },
    },
  };
}

function createMemoryResumeStore() {
  const map = new Map();
  return {
    map,
    get: (k) => map.get(k) || null,
    put: (k, v) => map.set(k, { ...v, updated: Date.now() }),
    delete: (k) => map.delete(k),
    stale: () => [],
    all: () => [...map.entries()].map(([key, entry]) => ({ key, entry })),
  };
}

function randomBytes(n, seed = 1) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; }
  return out;
}

module.exports = { createFakeDiscord, createMemoryFiles, createMemoryResumeStore, randomBytes };
