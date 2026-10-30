'use strict';

// End-to-end encryption and content hashing, on WebCrypto so the same code
// runs in Electron's main process (Node 19+) and in the Android WebView.
//
// Keys: a random 256-bit data key encrypts every chunk. The data key itself is
// stored in the drive index only wrapped (AES-GCM) by a key derived from the
// passphrase with PBKDF2, so changing the passphrase rewraps one small value
// instead of re-encrypting the drive. Devices keep the unwrapped data key in
// their own protected storage, so the passphrase is asked for once per device.
//
// Chunks: iv (12 bytes) || ciphertext || GCM tag (16 bytes). The additional
// data binds each chunk to its file id and position, so chunks can't be
// swapped between files or reordered without failing to decrypt.

const subtle = () => globalThis.crypto.subtle;
const ENC_VERSION = 1;
const PBKDF2_ITERATIONS = 310000;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CHUNK_OVERHEAD = IV_BYTES + TAG_BYTES;
// Dedup hashes are built from fixed-size blocks so they don't depend on the
// chunk size a server allowed at upload time.
const HASH_BLOCK = 8 * 1024 * 1024;

const enc = new TextEncoder();

function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

class DriveLocked extends Error {
  constructor() {
    super('This file is encrypted. Unlock the drive in Settings → Security.');
    this.name = 'DriveLocked';
    this.locked = true;
  }
}

async function deriveWrappingKey(passphrase, salt, iterations) {
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

function importDataKey(raw) {
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function seal(key, plain, aad) {
  const iv = randomBytes(IV_BYTES);
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = enc.encode(aad);
  const ct = new Uint8Array(await subtle().encrypt(params, key, plain));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_BYTES);
  return out;
}

async function open(key, sealed, aad) {
  const params = { name: 'AES-GCM', iv: sealed.subarray(0, IV_BYTES) };
  if (aad) params.additionalData = enc.encode(aad);
  return new Uint8Array(await subtle().decrypt(params, key, sealed.subarray(IV_BYTES)));
}

// A new drive key. Returns the index's encryption record and the raw data key
// for this device to keep.
async function createKeyring(passphrase) {
  const raw = randomBytes(32);
  return { record: await wrapKeyring(raw, passphrase), raw };
}

async function wrapKeyring(raw, passphrase) {
  const salt = randomBytes(16);
  const kek = await deriveWrappingKey(passphrase, salt, PBKDF2_ITERATIONS);
  return {
    v: ENC_VERSION,
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    wrapped: toBase64(await seal(kek, raw, 'beanydrive-key')),
    // Lets a device holding a stored key check it still belongs to this drive.
    keyId: toHex(await subtle().digest('SHA-256', raw)).slice(0, 16),
  };
}

// Throws on a wrong passphrase (the GCM tag doesn't verify).
async function unwrapKeyring(record, passphrase) {
  const kek = await deriveWrappingKey(passphrase, fromBase64(record.salt), record.iterations);
  try {
    return await open(kek, fromBase64(record.wrapped), 'beanydrive-key');
  } catch (e) {
    throw new Error('Wrong passphrase');
  }
}

// Secret salt for dedup hashes of encrypted files: derived from the data key,
// so the stored hash can't be matched against a known file's hash.
async function dedupSalt(raw) {
  const tag = enc.encode('beanydrive-dedup');
  const buf = new Uint8Array(raw.length + tag.length);
  buf.set(raw, 0);
  buf.set(tag, raw.length);
  return toHex(await subtle().digest('SHA-256', buf));
}

async function keyIdOf(raw) {
  return toHex(await subtle().digest('SHA-256', raw)).slice(0, 16);
}

const chunkAad = (fileId, idx) => `${fileId}:${idx}`;

function encryptChunk(key, fileId, idx, plain) {
  return seal(key, plain, chunkAad(fileId, idx));
}

async function decryptChunk(key, fileId, idx, sealed) {
  if (!key) throw new DriveLocked();
  try {
    return await open(key, sealed, chunkAad(fileId, idx));
  } catch (e) {
    throw new Error(`Chunk ${idx + 1} of this file failed to decrypt (wrong key or damaged chunk)`);
  }
}

// SHA-256 over the SHA-256 of each HASH_BLOCK, read through `reader`. With a
// salt (dedupSalt, when encrypting) equal files still match each other, but
// the stored hash can't be compared against a known file's plain hash.
async function hashFile(reader, size, salt = '') {
  const digests = [];
  for (let at = 0; at < size; at += HASH_BLOCK) {
    const block = await reader.read(at, Math.min(HASH_BLOCK, size - at));
    digests.push(new Uint8Array(await subtle().digest('SHA-256', block)));
  }
  const prefix = enc.encode(`beanydrive-hash:${salt}:${size}:`);
  const all = new Uint8Array(prefix.length + digests.length * 32);
  all.set(prefix, 0);
  digests.forEach((d, i) => all.set(d, prefix.length + i * 32));
  return `b8:${toHex(await subtle().digest('SHA-256', all))}`;
}

module.exports = {
  DriveLocked, CHUNK_OVERHEAD, HASH_BLOCK,
  createKeyring, wrapKeyring, unwrapKeyring, importDataKey, keyIdOf, dedupSalt,
  encryptChunk, decryptChunk, hashFile, toBase64, fromBase64,
};
