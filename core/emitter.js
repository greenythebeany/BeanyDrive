'use strict';

// Node's EventEmitter, minus Node. The core has to run in an Android WebView as
// well as in Electron's main process, and this is the only part of `events` the
// drive actually uses.
class Emitter {
  constructor() { this._listeners = new Map(); }

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(fn);
    return this;
  }

  off(event, fn) {
    const list = this._listeners.get(event);
    if (list) this._listeners.set(event, list.filter((f) => f !== fn));
    return this;
  }

  emit(event, ...args) {
    const list = this._listeners.get(event);
    if (!list || !list.length) return false;
    // Copied before iterating so a listener removing itself can't skip the next.
    for (const fn of [...list]) {
      try { fn(...args); } catch (e) { /* a listener must not break the drive */ }
    }
    return true;
  }

  listenerCount(event) {
    const list = this._listeners.get(event);
    return list ? list.length : 0;
  }
}

module.exports = { Emitter };
