'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createTokenStore } = require('./util');

let tokenStore = null;
let configPath = null;

function paths() {
  if (!tokenStore) {
    tokenStore = createTokenStore(path.join(app.getPath('userData'), 'bot-token.enc'));
    configPath = path.join(app.getPath('userData'), 'drive-config.json');
  }
  return { tokenStore, configPath };
}

function readConfig() {
  const { configPath: cfgPath } = paths();
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeConfig(cfg) {
  const { configPath: cfgPath } = paths();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

// How many chunk uploads run at once. Discord's per-channel message rate limit
// makes anything past a handful pointless, and 1 is the escape hatch for flaky
// connections.
function clampConcurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(8, Math.round(n)));
}

// { channelId, chunkSizeMb, uploadConcurrency, hasToken } — never the token itself.
function publicSettings() {
  const cfg = readConfig();
  const { tokenStore: store } = paths();
  return {
    channelId: cfg.channelId || '',
    chunkSizeMb: cfg.chunkSizeMb || 10,
    uploadConcurrency: clampConcurrency(cfg.uploadConcurrency),
    hasToken: !!store.read(),
  };
}

function getToken() {
  return paths().tokenStore.read();
}

// token is only written when a non-empty value is passed, so re-saving
// channelId/chunkSizeMb alone (e.g. after Test connection) never clobbers
// an already-saved token.
function saveSettings({ token, channelId, chunkSizeMb, uploadConcurrency }) {
  const { tokenStore: store } = paths();
  if (token) store.save(token);
  const cfg = readConfig();
  if (channelId !== undefined) cfg.channelId = channelId;
  if (chunkSizeMb !== undefined) cfg.chunkSizeMb = chunkSizeMb;
  if (uploadConcurrency !== undefined) cfg.uploadConcurrency = clampConcurrency(uploadConcurrency);
  writeConfig(cfg);
  return publicSettings();
}

module.exports = { publicSettings, getToken, saveSettings };
