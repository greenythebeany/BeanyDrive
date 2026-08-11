'use strict';

// Electron's wiring of the drive: the platform-agnostic core from core/ plus
// Node's filesystem and Node's fetch. The Capacitor/Android build composes the
// same core with its own two adapters — nothing below this line is shared, and
// nothing above it is Electron-specific.
//
// Kept as the entry point the main process already imports, so this module's
// exported surface is the one main.js has always used.

const { createApi } = require('./core/discord-api');
const { nodeFiles } = require('./platform/node-files');
const {
  DiscordDrive: CoreDrive,
  UploadCanceled, UploadPaused, isCancelError, isPauseError,
} = require('./core/drive');

// Node 18+ has fetch globally; no injection needed on this platform.
const api = createApi();

class DiscordDrive extends CoreDrive {
  constructor() {
    super({ api, files: nodeFiles });
  }
}

function testConnection(token, channelId) {
  return api.testConnection(token, channelId);
}

module.exports = {
  DiscordDrive, testConnection,
  UploadCanceled, UploadPaused, isCancelError, isPauseError,
};
