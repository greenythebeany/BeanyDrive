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

  // fileId prefix keeps two files with the same name apart; the real name is
  // preserved after it because that's what Explorer shows on drop.
  function entryPath(fileId, name) {
    return path.join(dir, `${fileId}-${path.basename(name)}`);
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
      return `${entryPath(fileId, name)}.part`;
    },

    async commit(fileId, name) {
      await fsp.rename(this.tempPathFor(fileId, name), entryPath(fileId, name));
      return entryPath(fileId, name);
    },

    async discard(fileId, name) {
      await fsp.rm(this.tempPathFor(fileId, name), { force: true }).catch(() => {});
    },

    async list() {
      const names = await fsp.readdir(dir).catch(() => []);
      const out = [];
      for (const n of names) {
        if (n.endsWith('.part')) continue;
        const full = path.join(dir, n);
        try {
          const stat = await fsp.stat(full);
          out.push({ path: full, name: n, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch (e) { /* vanished between readdir and stat */ }
      }
      return out;
    },

    // Cached copies are a convenience, not data — evict old ones, then oldest
    // first until the directory is back under the size cap.
    async sweep({ maxBytes = DEFAULT_MAX_BYTES, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
      let entries = await this.list();
      let removed = 0;

      const cutoff = Date.now() - maxAgeMs;
      for (const e of entries) {
        if (e.mtimeMs < cutoff) {
          await fsp.rm(e.path, { force: true }).catch(() => {});
          removed += 1;
        }
      }
      entries = entries.filter((e) => e.mtimeMs >= cutoff);

      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      let total = entries.reduce((n, e) => n + e.size, 0);
      for (const e of entries) {
        if (total <= maxBytes) break;
        await fsp.rm(e.path, { force: true }).catch(() => {});
        total -= e.size;
        removed += 1;
      }

      // Orphaned .part files from interrupted downloads.
      for (const n of await fsp.readdir(dir).catch(() => [])) {
        if (!n.endsWith('.part')) continue;
        await fsp.rm(path.join(dir, n), { force: true }).catch(() => {});
        removed += 1;
      }
      return removed;
    },
  };
}

module.exports = { createDragCache };
