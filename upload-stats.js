'use strict';

// Rolling-window transfer rate for upload progress rows.
//
// Chunk completions are lumpy — nothing for ten seconds while a 10 MB POST is
// in flight, then several land at once as the pool drains — so an average over
// the whole upload reads as far too slow and an instantaneous rate jumps
// around. A window of recent samples is the compromise: responsive to a
// connection actually changing speed, steady enough to display.

const DEFAULT_WINDOW_MS = 15000;

function createRateTracker({ windowMs = DEFAULT_WINDOW_MS, now = Date.now } = {}) {
  let samples = [];

  return {
    // Absolute bytes transferred so far, not a delta.
    push(bytes) {
      const t = now();
      samples.push({ t, bytes });
      const cutoff = t - windowMs;
      // Keep one sample older than the window so a slow transfer still has a
      // baseline to measure against.
      const firstInWindow = samples.findIndex((s) => s.t >= cutoff);
      if (firstInWindow > 1) samples = samples.slice(firstInWindow - 1);
    },

    // null until there's enough spread to mean anything — the UI shows nothing
    // rather than a wild first guess.
    bytesPerSec() {
      if (samples.length < 2) return null;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const seconds = (last.t - first.t) / 1000;
      const bytes = last.bytes - first.bytes;
      if (seconds <= 0 || bytes <= 0) return null;
      return bytes / seconds;
    },

    etaSeconds(totalBytes) {
      const rate = this.bytesPerSec();
      if (!rate || !totalBytes) return null;
      const last = samples[samples.length - 1];
      const remaining = totalBytes - last.bytes;
      if (remaining <= 0) return 0;
      return remaining / rate;
    },

    // Pausing, or resuming after a failure, invalidates the window — the gap
    // would otherwise be averaged in as very slow transfer.
    reset() {
      samples = [];
    },
  };
}

module.exports = { createRateTracker };
