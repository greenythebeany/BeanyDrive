'use strict';

// The resume ledger on Android. Same interface as upload-resume.js (get, put,
// delete, stale, all) so the core is unaware of which one it has.
//
// The desktop store writes JSON to disk synchronously and the core calls put()
// from inside the chunk loop without awaiting. Preferences is async, so writes
// are kept in an in-memory cache — which is what get()/stale() read — and
// flushed behind it. A flush lost to a crash costs at most the last chunk or
// two of resume progress, which the next attempt simply re-sends.

const { Preferences } = require('@capacitor/preferences');

const KEY = 'beanydrive_uploads_resume';
const VERSION = 1;

async function createResumeStore() {
  let cache = { version: VERSION, uploads: {} };
  try {
    const { value } = await Preferences.get({ key: KEY });
    const parsed = value ? JSON.parse(value) : null;
    if (parsed && parsed.version === VERSION && parsed.uploads) cache = parsed;
  } catch (e) { /* start empty */ }

  let flushing = null;
  let dirty = false;

  function flush() {
    dirty = true;
    if (flushing) return;
    flushing = Promise.resolve().then(async () => {
      while (dirty) {
        dirty = false;
        try {
          await Preferences.set({ key: KEY, value: JSON.stringify(cache) });
        } catch (e) { /* losing a write only costs resume progress */ }
      }
      flushing = null;
    });
  }

  return {
    get(key) { return cache.uploads[key] || null; },
    put(key, entry) {
      cache.uploads[key] = Object.assign({}, entry, { updated: Date.now() });
      flush();
    },
    delete(key) {
      if (!(key in cache.uploads)) return;
      delete cache.uploads[key];
      flush();
    },
    stale(maxAgeMs) {
      const cutoff = Date.now() - maxAgeMs;
      return Object.entries(cache.uploads)
        .filter(([, entry]) => !entry.updated || entry.updated < cutoff)
        .map(([key, entry]) => ({ key, entry }));
    },
    all() {
      return Object.entries(cache.uploads).map(([key, entry]) => ({ key, entry }));
    },
    // Tests and teardown want to know the write actually landed.
    settled() { return flushing || Promise.resolve(); },
  };
}

module.exports = { createResumeStore };
