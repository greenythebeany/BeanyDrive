'use strict';

// Android's back button. The phone shell itself (app bar, bottom navigation,
// sheets) is drawn by renderer.js when it sees a narrow screen; this only
// routes the hardware button to it, so back closes whatever is on top, then
// walks up the folder tree, and only exits the app at the drive root.

const { App } = require('@capacitor/app');

App.addListener('backButton', ({ canGoBack }) => {
  if (window.beanyUI && window.beanyUI.back()) return;
  if (canGoBack) window.history.back();
  else App.exitApp();
}).catch(() => { /* not running under Capacitor */ });

module.exports = {};
