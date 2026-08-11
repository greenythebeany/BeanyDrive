'use strict';

// Drive paths — the virtual ones stored in metadata, not the host filesystem's.
// Always forward-slashed and relative, on every platform. Kept free of Node's
// `path` so the core runs unchanged in a WebView.

function normalizePath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').split('/').filter((seg) => seg && seg !== '.').join('/');
}

function joinPath(...parts) {
  return normalizePath(parts.filter(Boolean).join('/'));
}

function parentOf(p) {
  p = normalizePath(p);
  if (!p.includes('/')) return '';
  return p.slice(0, p.lastIndexOf('/'));
}

function basenameOf(p) {
  p = normalizePath(p);
  if (!p.includes('/')) return p;
  return p.slice(p.lastIndexOf('/') + 1);
}

// The last segment of a *host* path, which may be Windows-style. Android hands
// out content URIs rather than paths, so platforms that need a display name
// pass it in themselves instead of relying on this.
function fileBasename(p) {
  const cleaned = String(p || '').replace(/[\\/]+$/, '');
  const cut = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return cut === -1 ? cleaned : cleaned.slice(cut + 1);
}

module.exports = { normalizePath, joinPath, parentOf, basenameOf, fileBasename };
