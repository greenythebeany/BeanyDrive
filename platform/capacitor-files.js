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
const { registerPlugin } = require('@capacitor/core');
const { bytesToBase64, base64ToBytes } = require('./capacitor-http');

// mobile/native/BeanyNativePlugin.java
const BeanyNative = registerPlugin('BeanyNative');

const HANDLE_PREFIX = 'picked:';
const NATIVE_PREFIX = 'native:';
const picked = new Map(); // handle -> File
const native = new Map(); // handle -> { uri, name, size, mtimeMs } (shared files, camera backup)
let seq = 0;

// Registering a File returns the string the core will treat as its path.
function registerFile(file) {
  const handle = `${HANDLE_PREFIX}${seq++}:${file.name}`;
  picked.set(handle, file);
  return handle;
}

// A content URI from another app (Share to BeanyDrive) or the gallery
// (camera backup), read through the native plugin rather than a File.
function registerNative({ uri, name, size, mtimeMs }) {
  const handle = `${NATIVE_PREFIX}${seq++}:${name}`;
  native.set(handle, { uri, name, size, mtimeMs: mtimeMs || 0 });
  return handle;
}

function isHandle(value) {
  return typeof value === 'string' && (value.startsWith(HANDLE_PREFIX) || value.startsWith(NATIVE_PREFIX));
}

function getFile(handle) {
  const file = picked.get(handle);
  if (!file) throw new Error('That file is no longer available — pick it again');
  return file;
}

function getNative(handle) {
  const item = native.get(handle);
  if (!item) throw new Error('That file is no longer available — share it again');
  return item;
}

function forgetFile(handle) {
  picked.delete(handle);
  native.delete(handle);
}

// Where a download is written: { device: true, name, mime } goes to the
// phone's Downloads / Pictures / Movies through MediaStore; anything else is a
// Filesystem { path, directory } target.
async function createDeviceWriter(dest) {
  const { id } = await BeanyNative.createDownload({ name: dest.name, mime: dest.mime || 'application/octet-stream' });
  let finished = false;
  const writer = {
    target: dest,
    write: (bytes) => BeanyNative.appendDownload({ id, data: bytesToBase64(bytes) }),
    async close() {
      if (finished) return;
      finished = true;
      writer.result = await BeanyNative.finishDownload({ id });
      dest.result = writer.result;
    },
    async abort() {
      if (finished) return;
      finished = true;
      await BeanyNative.abortDownload({ id }).catch(() => {});
    },
  };
  return writer;
}

const capacitorFiles = {
  async stat(localPath) {
    if (localPath.startsWith(NATIVE_PREFIX)) {
      const n = getNative(localPath);
      return { size: n.size, mtimeMs: n.mtimeMs, name: n.name, isDirectory: false };
    }
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
    if (localPath.startsWith(NATIVE_PREFIX)) {
      const { uri } = getNative(localPath);
      return {
        async read(offset, length) {
          const { data } = await BeanyNative.readRange({ uri, offset, length });
          return base64ToBytes(data);
        },
        async close() {},
      };
    }
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
    if (dest && dest.device) return createDeviceWriter(dest);
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

module.exports = { capacitorFiles, registerFile, registerNative, isHandle, getFile, forgetFile, BeanyNative };
