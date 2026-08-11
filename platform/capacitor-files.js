'use strict';

// The files adapter for Android, mirroring platform/node-files.js.
//
// Two differences from the desktop one drive the shape of this file:
//
//   * A "local path" here is usually a content:// URI from the system picker,
//     not a filesystem path. It's opaque — only this adapter interprets it.
//   * Every read crosses the JS bridge as base64, so a 10 MB chunk arrives as a
//     ~13.3 MB string and is then decoded. Reads are therefore done at the exact
//     offset and length needed and never speculatively.
//
// Filesystem.readFile supports offset/length natively, which is what makes
// resumable chunked upload possible at all here — without it the only option
// would be reading whole files into memory.

const { Filesystem } = require('@capacitor/filesystem');
const { base64ToBytes } = require('./capacitor-http');

function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000; // avoid blowing the argument limit on large chunks
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

const capacitorFiles = {
  async stat(localPath) {
    const info = await Filesystem.stat({ path: localPath });
    return {
      size: info.size,
      mtimeMs: info.mtime,
      name: info.name || decodeURIComponent(String(localPath).split('/').pop() || ''),
      isDirectory: info.type === 'directory',
    };
  },

  // There's no file handle to hold on Android — each read is its own native
  // call — so the "reader" is just a binding of the path. Same interface as the
  // desktop adapter so the core doesn't branch.
  async openReader(localPath) {
    return {
      async read(offset, length) {
        const res = await Filesystem.readFile({ path: localPath, offset, length });
        return base64ToBytes(res.data);
      },
      async close() { /* nothing to release */ },
    };
  },

  // Appending per chunk keeps peak memory at one chunk rather than the whole
  // file, which matters when the file is a multi-GB download.
  async createWriter(destPath) {
    await Filesystem.writeFile({ path: destPath, data: '', recursive: true });
    return {
      write: (bytes) => Filesystem.appendFile({ path: destPath, data: bytesToBase64(bytes) }),
      close: async () => {},
    };
  },

  // Deliberately absent: `walk`. Android's picker returns individual documents,
  // not directory trees, so folder upload isn't offered — the core throws a
  // clear error rather than this returning something half-right.
};

module.exports = { capacitorFiles, bytesToBase64 };
