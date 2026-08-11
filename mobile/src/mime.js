'use strict';

// util.js can't be imported here — it pulls in Node's fs and Electron's
// safeStorage for the token store — so the one function the mobile build needs
// from it is re-stated. Keep the table in sync with util.js's MIME_TYPES.

const MIME_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp',
  webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain', md: 'text/plain',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
  py: 'text/plain', js: 'text/plain', ts: 'text/plain', java: 'text/plain', c: 'text/plain', cpp: 'text/plain',
  html: 'text/plain', css: 'text/plain', json: 'text/plain', xml: 'text/plain', yaml: 'text/plain', yml: 'text/plain',
  sh: 'text/plain', sql: 'text/plain', csv: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function guessMimeFor(filename) {
  const dot = String(filename || '').lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return MIME_TYPES[filename.slice(dot + 1).toLowerCase()] || 'application/octet-stream';
}

module.exports = { guessMimeFor };
