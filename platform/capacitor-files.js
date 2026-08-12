'use strict';

// The files adapter for Android, mirroring platform/node-files.js.
//
// Reads come from File objects the system picker hands to <input type="file">.
// A File is a Blob, and Blob.slice(start, end) is exactly the positional read
// the upload engine wants — so chunking works with no plugin, no content-URI
// juggling and no base64 on the read side. The "local path" the core passes
// around is a handle into the registry below; only this file interprets it.
//
// Writes (downloads) do go through the Filesystem plugin, which takes base64.
// That's one encode per chunk on the way to disk, which is acceptable, and
// unlike reads there's no browser API that would do better here.

const { Filesystem, Directory } = require('@capacitor/filesystem');
const { bytesToBase64 } = require('./capacitor-http');

const HANDLE_PREFIX = 'picked:';
const picked = new Map(); // handle -> File
let seq = 0;

// Registering a File returns the string the core will treat as its path.
function registerFile(file) {
  const handle = `${HANDLE_PREFIX}${seq++}:${file.name}`;
  picked.set(handle, file);
  return handle;
}

function isHandle(value) {
  return typeof value === 'string' && value.startsWith(HANDLE_PREFIX);
}

function getFile(handle) {
  const file = picked.get(handle);
  if (!file) throw new Error('That file is no longer available — pick it again');
  return file;
}

function forgetFile(handle) {
  picked.delete(handle);
}

const capacitorFiles = {
  async stat(localPath) {
    const file = getFile(localPath);
    return {
      size: file.size,
      // Files from the picker carry lastModified, which is what makes a resume
      // record invalid when the file changes underneath it.
      mtimeMs: file.lastModified || 0,
      name: file.name,
      isDirectory: false,
    };
  },

  async openReader(localPath) {
    const file = getFile(localPath);
    return {
      async read(offset, length) {
        const slice = file.slice(offset, offset + length);
        return new Uint8Array(await slice.arrayBuffer());
      },
      async close() { /* nothing to release */ },
    };
  },

  // destPath is { path, directory } rather than a bare string: Filesystem needs
  // the directory alongside a relative path, and a bare path with no directory
  // silently writes somewhere unhelpful.
  async createWriter(dest) {
    const target = typeof dest === 'string' ? { path: dest, directory: Directory.Cache } : dest;
    await Filesystem.writeFile({ ...target, data: '', recursive: true });
    return {
      write: (bytes) => Filesystem.appendFile({ ...target, data: bytesToBase64(bytes) }),
      close: async () => {},
      target,
    };
  },

  // Deliberately absent: `walk`. Android's picker returns individual documents,
  // not directory trees, so folder upload isn't offered — the core throws a
  // clear error rather than this returning something half-right.
};

module.exports = { capacitorFiles, registerFile, isHandle, getFile, forgetFile };
