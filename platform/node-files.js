'use strict';

// The files adapter for Electron: real filesystem paths, Node's fs.
// The Capacitor build supplies its own with the same four methods, backed by
// the Filesystem plugin and content URIs.

const fsp = require('fs/promises');
const path = require('path');

const nodeFiles = {
  async stat(localPath) {
    const s = await fsp.stat(localPath);
    return { size: s.size, mtimeMs: s.mtimeMs, name: path.basename(localPath), isDirectory: s.isDirectory() };
  },

  // One handle per upload attempt, read by absolute offset: several chunks are
  // in flight at once and a resumed upload skips straight to the parts that are
  // still missing, so this can't be a sequential stream — and reopening the file
  // per chunk would mean hundreds of opens for one large upload.
  async openReader(localPath) {
    const handle = await fsp.open(localPath, 'r');
    return {
      async read(offset, length) {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        return buffer;
      },
      close: () => handle.close(),
    };
  },

  async createWriter(destPath) {
    const handle = await fsp.open(destPath, 'w');
    return {
      write: (bytes) => handle.write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length)),
      close: () => handle.close(),
    };
  },

  async walk(dir, relDir = '') {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    let out = [];
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        out = out.concat(await nodeFiles.walk(abs, relDir ? `${relDir}/${ent.name}` : ent.name));
      } else if (ent.isFile()) {
        out.push({ abs, relDir });
      }
    }
    return out;
  },
};

module.exports = { nodeFiles };
