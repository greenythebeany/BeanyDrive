'use strict';

// Shared encrypted-at-rest token file (same pattern BeanyBox uses for its
// OAuth tokens) — kept in the main process only, the value never crosses
// the IPC bridge to the renderer.
function createTokenStore(filePath) {
  const fs = require('fs');
  const { safeStorage } = require('electron');
  return {
    save(value) {
      const data = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(value)
        : Buffer.from(value, 'utf8');
      fs.writeFileSync(filePath, data);
    },
    read() {
      if (!fs.existsSync(filePath)) return null;
      const data = fs.readFileSync(filePath);
      try {
        return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString('utf8');
      } catch (e) {
        return null;
      }
    },
    clear() {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    },
  };
}

// Mirrors storage.py's path/category helpers from the original DiscordCloudStorage bot.

function normalizePath(path) {
  if (!path) return '';
  const p = String(path).replace(/\\/g, '/');
  return p.split('/').filter((seg) => seg && seg !== '.').join('/');
}

function joinPath(...parts) {
  return normalizePath(parts.filter(Boolean).join('/'));
}

function parentOf(path) {
  path = normalizePath(path);
  if (!path.includes('/')) return '';
  return path.slice(0, path.lastIndexOf('/'));
}

function basenameOf(path) {
  path = normalizePath(path);
  if (!path.includes('/')) return path;
  return path.slice(path.lastIndexOf('/') + 1);
}

function humanSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  for (const u of units) {
    if (size < 1024 || u === units[units.length - 1]) return `${size.toFixed(u === 'KB' && size >= 100 ? 0 : 1)} ${u}`;
    size /= 1024;
  }
  return `${bytes} B`;
}

const CATEGORY_BY_EXT = {
  audio: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'wma'],
  video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'svg'],
  pdf: ['pdf'],
  word: ['doc', 'docx', 'odt', 'rtf'],
  sheet: ['xls', 'xlsx', 'csv', 'ods'],
  ppt: ['ppt', 'pptx', 'odp'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'],
  code: ['py', 'js', 'ts', 'java', 'c', 'cpp', 'cs', 'rb', 'go', 'rs', 'php', 'html', 'css', 'json', 'xml', 'yaml', 'yml', 'sh', 'ps1', 'sql'],
  text: ['txt', 'md'],
};
const EXT_TO_CATEGORY = {};
for (const [category, exts] of Object.entries(CATEGORY_BY_EXT)) {
  for (const ext of exts) EXT_TO_CATEGORY[ext] = category;
}

const MIME_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
  txt: 'text/plain', md: 'text/plain',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', webm: 'video/webm',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg',
  py: 'text/plain', js: 'text/plain', ts: 'text/plain', java: 'text/plain', c: 'text/plain', cpp: 'text/plain',
  html: 'text/plain', css: 'text/plain', json: 'text/plain', xml: 'text/plain', yaml: 'text/plain', yml: 'text/plain',
  sh: 'text/plain', sql: 'text/plain', csv: 'text/plain',
};

function guessMime(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return MIME_TYPES[filename.slice(dot + 1).toLowerCase()] || 'application/octet-stream';
}

function categoryFor(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return 'other';
  const ext = filename.slice(dot + 1).toLowerCase();
  return EXT_TO_CATEGORY[ext] || 'other';
}

// Immediate sub-folders inside `currentPath`, aggregated recursively from file paths + explicit folder list.
function foldersAt(files, explicitFolders, currentPath) {
  currentPath = normalizePath(currentPath);
  const prefix = currentPath ? currentPath + '/' : '';
  const found = new Map();

  function ensure(fullPath) {
    let info = found.get(fullPath);
    if (!info) {
      info = { name: basenameOf(fullPath), path: fullPath, fileCount: 0, totalSize: 0 };
      found.set(fullPath, info);
    }
    return info;
  }

  for (const f of files) {
    if (!f.path) continue;
    if (currentPath && !(f.path === currentPath || f.path.startsWith(prefix))) continue;
    let rest;
    if (!currentPath) rest = f.path;
    else {
      if (f.path === currentPath) continue;
      rest = f.path.slice(prefix.length);
    }
    const first = rest.split('/')[0];
    const full = joinPath(currentPath, first);
    const info = ensure(full);
    info.fileCount += 1;
    info.totalSize += f.size;
  }

  for (let fp of explicitFolders) {
    fp = normalizePath(fp);
    if (!fp) continue;
    let rest;
    if (currentPath) {
      if (!fp.startsWith(prefix)) continue;
      rest = fp.slice(prefix.length);
    } else rest = fp;
    if (!rest) continue;
    const first = rest.split('/')[0];
    ensure(joinPath(currentPath, first));
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function filesAt(files, currentPath) {
  currentPath = normalizePath(currentPath);
  return files.filter((f) => normalizePath(f.path) === currentPath);
}

module.exports = {
  createTokenStore,
  normalizePath, joinPath, parentOf, basenameOf, humanSize,
  categoryFor, foldersAt, filesAt, guessMime,
};
