'use strict';

// Local copies of drive files, kept so they can be dragged out to Explorer.
//
// An OS drag has to hand over a path that already exists — you can't start a
// drag and produce the file later, and the drag gesture is long over by the
// time a few hundred chunks come back from Discord. So a drag-out is really
// two steps: materialize the file here first, then drag it. Anything already
// in the cache drags instantly.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function createDragCache(dir) {
  fs.mkdirSync(dir, { recursive: true });

  // The id goes in a directory, never in the filename: dropping a file copies
  // it under its on-disk name, so anything decorating that name lands on the
  // user's desktop. One directory per file also keeps two files with the same
  // name apart.
  function entryDir(fileId) {
    return path.join(dir, String(fileId));
  }

  function entryPath(fileId, name) {
    return path.join(entryDir(fileId), path.basename(name));
  }

  return {
    dir,
    pathFor: entryPath,

    // Returns the path only if the copy is complete and the size matches what
    // metadata says — a half-written file from an interrupted download must
    // never be dragged out as if it were the real thing.
    resolve(fileId, name, expectedSize) {
      const p = entryPath(fileId, name);
      try {
        const stat = fs.statSync(p);
        if (expectedSize != null && stat.size !== expectedSize) return null;
        return p;
      } catch (e) {
        return null;
      }
    },

    // Downloads write here and are renamed into place, so a crash mid-download
    // leaves a .part file that resolve() ignores rather than a plausible-looking
    // truncated file.
    tempPathFor(fileId, name) {
      fs.mkdirSync(entryDir(fileId), { recursive: true });
      return `${entryPath(fileId, name)}.part`;
    },

    async commit(fileId, name) {
      await fsp.rename(this.tempPathFor(fileId, name), entryPath(fileId, name));
      return entryPath(fileId, name);
    },

    async discard(fileId, name) {
      await fsp.rm(entryDir(fileId), { recursive: true, force: true }).catch(() => {});
    },

    // One entry per cached file: { fileId, name, path, size, mtimeMs }.
    async list() {
      const ids = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      const out = [];
      for (const ent of ids) {
        if (!ent.isDirectory()) continue; // stray file, or the pre-subdirectory layout
        const fileId = ent.name;
        for (const n of await fsp.readdir(entryDir(fileId)).catch(() => [])) {
          if (n.endsWith('.part')) continue;
          const full = path.join(entryDir(fileId), n);
          try {
            const stat = await fsp.stat(full);
            out.push({ fileId, name: n, path: full, size: stat.size, mtimeMs: stat.mtimeMs });
          } catch (e) { /* vanished between readdir and stat */ }
        }
      }
      return out;
    },

    // Cached copies are a convenience, not data — evict old ones, then oldest
    // first until the directory is back under the size cap.
    async sweep({ maxBytes = DEFAULT_MAX_BYTES, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
      let entries = await this.list();
      let removed = 0;
      const drop = async (e) => {
        await fsp.rm(entryDir(e.fileId), { recursive: true, force: true }).catch(() => {});
        removed += 1;
      };

      const cutoff = Date.now() - maxAgeMs;
      for (const e of entries) {
        if (e.mtimeMs < cutoff) await drop(e);
      }
      entries = entries.filter((e) => e.mtimeMs >= cutoff);

      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      let total = entries.reduce((n, e) => n + e.size, 0);
      for (const e of entries) {
        if (total <= maxBytes) break;
        await drop(e);
        total -= e.size;
      }

      for (const ent of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        // Loose files in the root are entries from the flat "<fileId>-<name>"
        // layout used before this became one directory per file — unreachable now.
        if (!ent.isDirectory()) {
          await fsp.rm(path.join(dir, ent.name), { force: true }).catch(() => {});
          removed += 1;
          continue;
        }
        // Orphaned .part files from downloads that never finished.
        const sub = path.join(dir, ent.name);
        for (const n of await fsp.readdir(sub).catch(() => [])) {
          if (!n.endsWith('.part')) continue;
          await fsp.rm(path.join(sub, n), { force: true }).catch(() => {});
          removed += 1;
        }
        const left = await fsp.readdir(sub).catch(() => ['keep']);
        if (!left.length) await fsp.rm(sub, { recursive: true, force: true }).catch(() => {});
      }
      return removed;
    },
  };
}

module.exports = { createDragCache };
