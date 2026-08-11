'use strict';

// Identity of an interrupted upload: which local file, going where, on which
// drive. mtime and size are part of it so that editing the file invalidates the
// record — resuming onto changed bytes would assemble a corrupt file.
//
// This used to be SHA-1 via Node's crypto, which has no synchronous equivalent
// in a browser (SubtleCrypto is async, and this is called from inside the chunk
// loop). It's a lookup key, not a security boundary, so a plain non-cryptographic
// hash is enough — two of them at different offsets, so the result is wide enough
// that a collision between two files the user actually has is not a real concern.

function fnv1a(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // 32-bit FNV prime multiply, done in halves to stay exact in doubles.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

function hex(n) { return n.toString(16).padStart(8, '0'); }

function resumeKey({ localPath, size, mtimeMs, dest, channelId }) {
  const material = [localPath, size, Math.floor(mtimeMs || 0), dest || '', channelId || ''].join(' ');
  return [
    hex(fnv1a(material, 0x811c9dc5)),
    hex(fnv1a(material, 0x01000193)),
    hex(fnv1a(`${material}#`, 0x811c9dc5)),
    hex(fnv1a(`#${material}`, 0x01000193)),
  ].join('');
}

module.exports = { resumeKey };
