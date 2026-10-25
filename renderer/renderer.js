(() => {
  'use strict';

  const api = window.api;
  // macOS draws its own traffic lights in the app bar (see main.js).
  const IS_MAC = api.platform === 'darwin';
  document.documentElement.classList.toggle('mac', IS_MAC);
  const root = document.getElementById('root');
  const previewRoot = document.getElementById('preview-root');

  // Opens in the user's browser via the main process — the README section
  // explaining why more parallel chunks isn't automatically faster.
  const UPLOAD_SPEED_DOCS = 'https://github.com/greenythebeany/BeanyDrive#upload-speed';

  // localStorage can throw (blocked storage, private WebView); nothing here is
  // worth crashing the UI over, so every read and write goes through this.
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } },
  };

  // ---- icons -------------------------------------------------------------
  // One stroke set on a 20x20 grid (the BeanyIK set, extended). Every icon is
  // drawn in currentColor, so both UI styles recolour them with plain CSS.
  const ICON_PATHS = {
    menu: '<path d="M3 5.5h14M3 10h14M3 14.5h14"/>',
    search: '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/>',
    close: '<path d="M6 6l8 8M14 6l-8 8"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    upload: '<path d="M10 12V3M6.5 6.5 10 3l3.5 3.5"/><path d="M4 11v5.5h12V11"/>',
    download: '<path d="M10 3v9M6.5 8.5 10 12l3.5-3.5"/><path d="M4 13v3.5h12V13"/>',
    trash: '<path d="M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6"/>',
    restore: '<path d="M7 5 3.5 8.5 7 12"/><path d="M4 8.5h7.5a4.5 4.5 0 0 1 0 9H9"/>',
    star: '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
    starFill: '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z" fill="currentColor"/>',
    folder: '<path d="M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/>',
    folderPlus: '<path d="M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><path d="M10 9.5v4M8 11.5h4"/>',
    move: '<path d="M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/><path d="M7.5 11.5h5M10.5 9.5l2 2-2 2"/>',
    file: '<path d="M5 2.5h6.5l3.5 3.5v11.5H5z"/><path d="M11.5 2.5V6H15"/>',
    text: '<path d="M5 2.5h6.5l3.5 3.5v11.5H5z"/><path d="M11.5 2.5V6H15M7.5 10h5M7.5 13h5"/>',
    doc: '<path d="M5 2.5h6.5l3.5 3.5v11.5H5z"/><path d="M11.5 2.5V6H15M7.5 9.5h5M7.5 12h5M7.5 14.5h3"/>',
    pdf: '<path d="M5 2.5h6.5l3.5 3.5v11.5H5z"/><path d="M11.5 2.5V6H15"/><path d="M7 14.5c2-1.2 3.4-3.5 3.4-6 0 2.5 1.4 4.8 3.4 6"/>',
    image: '<rect x="3" y="3.5" width="14" height="13" rx="2"/><circle cx="7.5" cy="8" r="1.5"/><path d="m3.5 14.5 4-4 3 3 2-2 4 4"/>',
    video: '<rect x="2.5" y="5" width="11" height="10" rx="2"/><path d="m13.5 9 4-2.5v7l-4-2.5"/>',
    music: '<path d="M8 15V4.5l9-2V13"/><circle cx="5.5" cy="15" r="2.5"/><circle cx="14.5" cy="13" r="2.5"/>',
    table: '<rect x="3" y="3.5" width="14" height="13" rx="1.5"/><path d="M3 8h14M3 12.5h14M8 3.5v13"/>',
    slides: '<rect x="2.5" y="3.5" width="15" height="10" rx="1.5"/><path d="M10 13.5v3M7 16.5h6"/>',
    archive: '<rect x="3" y="3.5" width="14" height="4" rx="1"/><path d="M4 7.5v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8M8.5 10.5h3"/>',
    code: '<path d="M7 6 3 10l4 4M13 6l4 4-4 4M11 4.5 9 15.5"/>',
    link: '<path d="M8.5 11.5l3-3"/><path d="M9 6.5 10.5 5a3 3 0 0 1 4.5 4.5L13.5 11M11 13.5 9.5 15A3 3 0 0 1 5 10.5L6.5 9"/>',
    pencil: '<path d="M13.5 3.5l3 3L7 16H4v-3z"/><path d="M11.5 5.5l3 3"/>',
    tag: '<path d="M3 3.5h6.5l7.5 7.5-6 6-7.5-7.5z"/><circle cx="6.8" cy="7.3" r="1.2"/>',
    more: '<path d="M5 10h.01M10 10h.01M15 10h.01" stroke-width="2.6"/>',
    grid: '<rect x="3" y="3" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="3" width="5.5" height="5.5" rx="1"/><rect x="3" y="11.5" width="5.5" height="5.5" rx="1"/><rect x="11.5" y="11.5" width="5.5" height="5.5" rx="1"/>',
    list: '<path d="M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01" stroke-width="1.7"/>',
    sortDesc: '<path d="M6 4v12M3 13l3 3 3-3M11 5h6M11 9h4.5M11 13h3"/>',
    sortAsc: '<path d="M6 16V4M3 7l3-3 3 3M11 5h3M11 9h4.5M11 13h6"/>',
    refresh: '<path d="M16 10a6 6 0 1 1-2-4.47"/><path d="M14.5 2.5v3.5H11"/>',
    settings: '<path d="M4 6h7M15 6h1M4 14h1M9 14h7"/><circle cx="13" cy="6" r="2"/><circle cx="7" cy="14" r="2"/>',
    check: '<path d="M4 10.5 8 14.5 16 5.5"/>',
    info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5h.01"/>',
    warn: '<path d="M10 3 18 17H2z"/><path d="M10 8v4M10 14.5h.01"/>',
    back: '<path d="M12.5 5 7.5 10l5 5"/>',
    chevronRight: '<path d="M8 5.5 12.5 10 8 14.5"/>',
    chevronDown: '<path d="M5.5 8 10 12.5 14.5 8"/>',
    pause: '<path d="M7 4.5v11M13 4.5v11"/>',
    play: '<path d="M6 4l10 6-10 6z"/>',
    clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2"/>',
    drive: '<rect x="2.5" y="11" width="15" height="5.5" rx="1.5"/><path d="M4.5 11 6.5 4h7l2 7M13.5 13.75h.01"/>',
    theme: '<circle cx="10" cy="10" r="6.5"/><path d="M10 3.5v13a6.5 6.5 0 0 0 0-13z" fill="currentColor"/>',
    keyboard: '<rect x="2.5" y="5" width="15" height="10" rx="2"/><path d="M5.5 8h.01M8.5 8h.01M11.5 8h.01M14.5 8h.01M5.5 11h.01M14.5 11h.01M8 11.5h4" stroke-width="1.8"/>',
    selectAll: '<rect x="3.5" y="3.5" width="13" height="13" rx="2.5"/><path d="m7 10 2 2 4-4"/>',
    eye: '<path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z"/><circle cx="10" cy="10" r="2.5"/>',
    panel: '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M12.5 3.5v13"/>',
    winMin: '<path d="M5 10h10"/>',
    winMax: '<rect x="5" y="5" width="10" height="10" rx="1"/>',
    winClose: '<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>',
    dot: '<circle cx="10" cy="10" r="3.5" fill="currentColor" stroke="none"/>',
  };
  const iconCache = new Map();
  function icon(name, size = 20) {
    const key = `${name}:${size}`;
    let s = iconCache.get(key);
    if (!s) {
      s = `<svg class="ico" viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.file}</svg>`;
      iconCache.set(key, s);
    }
    return s;
  }

  // ---- file kinds ----------------------------------------------------------
  const TAGS = {
    design: { name: 'design', color: '#5c9eff' },
    work: { name: 'work', color: '#5cd68a' },
    personal: { name: 'personal', color: '#f0c419' },
  };
  const EXT_MAP = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image', webp: 'image', svg: 'image',
    txt: 'text', md: 'text',
    pdf: 'pdf',
    mp4: 'video', mov: 'video', mkv: 'video', avi: 'video', webm: 'video',
    mp3: 'audio', m4a: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio',
    xlsx: 'sheet', xls: 'sheet', csv: 'sheet', ods: 'sheet',
    doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
    ppt: 'ppt', pptx: 'ppt', odp: 'ppt',
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
    js: 'code', ts: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code',
    html: 'code', css: 'code', json: 'code', sh: 'code', sql: 'code',
  };
  const CATEGORY = {
    folder: { glyph: 'folder', label: 'Folder' },
    tag: { glyph: 'tag', label: 'Tag' },
    image: { glyph: 'image', label: 'Image' },
    video: { glyph: 'video', label: 'Video' },
    audio: { glyph: 'music', label: 'Audio' },
    pdf: { glyph: 'pdf', label: 'PDF' },
    sheet: { glyph: 'table', label: 'Spreadsheet' },
    word: { glyph: 'doc', label: 'Document' },
    ppt: { glyph: 'slides', label: 'Presentation' },
    archive: { glyph: 'archive', label: 'Archive' },
    code: { glyph: 'code', label: 'Code' },
    text: { glyph: 'text', label: 'Text' },
    other: { glyph: 'file', label: 'File' },
  };
  const TYPE_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'image', label: 'Images', cats: ['image'] },
    { id: 'docs', label: 'Documents', cats: ['pdf', 'word', 'ppt', 'sheet', 'text'] },
    { id: 'media', label: 'Video & audio', cats: ['video', 'audio'] },
    { id: 'archive', label: 'Archives', cats: ['archive'] },
    { id: 'code', label: 'Code', cats: ['code'] },
  ];
  // 'default' follows the UI style: Spectrum blue for Studio, Nothing red.
  const ACCENTS = [
    { id: 'default', name: 'Style default', value: null },
    { id: 'red', name: 'Red', value: '#ff5c5c' },
    { id: 'orange', name: 'Orange', value: '#ff9d42' },
    { id: 'amber', name: 'Amber', value: '#ffcc4d' },
    { id: 'green', name: 'Green', value: '#3fb96a' },
    { id: 'cyan', name: 'Cyan', value: '#2bb9a0' },
    { id: 'blue', name: 'Blue', value: '#3b8cff' },
    { id: 'purple', name: 'Purple', value: '#9b6dff' },
    { id: 'pink', name: 'Pink', value: '#ff6fb1' },
  ];
  const UI_STYLES = [
    { id: 'studio', name: 'Studio', sub: 'Clean panels, Acrobat-like' },
    { id: 'nothing', name: 'Nothing', sub: 'Monochrome, dot matrix' },
  ];
  // Categories the in-app preview overlay knows how to render. 'word' and
  // 'ppt' also cover legacy/OpenDocument extensions that ooxml.js can't read;
  // those open the preview and explain why rather than being unclickable.
  const PREVIEWABLE = new Set(['image', 'pdf', 'text', 'code', 'video', 'audio', 'word', 'ppt']);
  const THUMBABLE = new Set(['image', 'pdf']);

  // User-created tags, layered on top of the built-in TAGS map and persisted
  // locally — there's no server-side tag registry, just per-file tag ids, so
  // the id → {name,color} mapping itself has to live somewhere durable.
  const CUSTOM_TAG_IDS = new Set();
  try {
    JSON.parse(ls.get('beanydrive_custom_tags', '[]')).forEach((t) => {
      if (t && t.id && t.name && !TAGS[t.id]) { TAGS[t.id] = { name: t.name, color: t.color || '#8a8a8a' }; CUSTOM_TAG_IDS.add(t.id); }
    });
  } catch (e) { /* corrupt entry — start with no custom tags */ }

  function saveCustomTags() {
    ls.set('beanydrive_custom_tags', JSON.stringify([...CUSTOM_TAG_IDS].map((id) => ({ id, name: TAGS[id].name, color: TAGS[id].color }))));
  }
  function createCustomTag(rawName) {
    const name = rawName.trim();
    if (!name) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tag';
    let id = slug, n = 1;
    while (TAGS[id]) { n += 1; id = `${slug}-${n}`; }
    const palette = ACCENTS.filter((a) => a.value);
    TAGS[id] = { name, color: palette[CUSTOM_TAG_IDS.size % palette.length].value };
    CUSTOM_TAG_IDS.add(id);
    saveCustomTags();
    return id;
  }

  // ---- formatting ----------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  function fmtDate(epochSeconds) {
    if (!epochSeconds) return '';
    return dateFmt.format(new Date(epochSeconds * 1000));
  }
  function fmtSpeed(bytesPerSec) {
    if (!bytesPerSec) return '';
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  // Coarse on purpose — chunked uploads over a rate limit make anything
  // finer-grained than this look like it's lying.
  function fmtEta(seconds) {
    if (seconds == null || !Number.isFinite(seconds)) return '';
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s left`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m left`;
    const hours = Math.floor(seconds / 3600);
    return `${hours}h ${Math.round((seconds % 3600) / 60)}m left`;
  }
  function plural(n, one, many) { return `${n} ${n === 1 ? one : (many || `${one}s`)}`; }
  function categoryFor(filename) {
    const dot = filename.lastIndexOf('.');
    if (dot === -1) return 'other';
    return EXT_MAP[filename.slice(dot + 1).toLowerCase()] || 'other';
  }

  // ---- path helpers (mirrors util.js — duplicated here since the renderer
  // has no Node integration and can't require() the main-process module) ----
  function normPath(p) {
    if (!p) return '';
    return String(p).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').join('/');
  }
  function joinPath(...parts) { return normPath(parts.filter(Boolean).join('/')); }
  function basenameOf(p) { p = normPath(p); return p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p; }
  function parentOf(p) { p = normPath(p); const i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); }

  // ---- state -----------------------------------------------------------------
  const state = {
    uiStyle: ls.get('beanydrive_ui', 'nothing'),
    theme: ls.get('beanydrive_theme', 'system'),
    accent: ls.get('beanydrive_accent', 'default'),
    density: ls.get('beanydrive_density', 'comfortable'),
    viewMode: ls.get('beanydrive_view', 'list'),
    sortBy: ls.get('beanydrive_sort', 'date'),
    sortDir: ls.get('beanydrive_sort_dir', 'desc'),
    detailOpen: ls.get('beanydrive_detail', '1') === '1',
    systemDark: true,

    settings: { channelId: '', chunkSizeMb: 10, hasToken: false },
    connection: { status: 'disconnected', message: '' },
    files: [],
    folders: [],

    nav: 'root',
    searchQuery: '',
    typeFilter: 'all',
    selected: new Set(), // row keys
    anchorKey: null,     // where a shift-click range starts
    focusKey: null,      // the row the keyboard and the detail panel follow
    selectMode: false,   // touch: taps toggle selection instead of opening
    expanded: new Set((() => { try { return JSON.parse(ls.get('beanydrive_expanded', '[]')); } catch (e) { return []; } })()),
    scrollToFocus: false,

    settingsOpen: false,
    botTokenInput: '',
    channelIdInput: '',
    chunkSizeInput: 10,
    concurrencyInput: 4,
    testResult: null,

    dontAskAgainTrash: ls.get('beanydrive_skip_empty_trash', '0') === '1',
    menu: null,        // { x, y, title, items } — popover on desktop, sheet on mobile
    sheet: null,       // mobile: row key whose action sheet is open
    promptModal: null,
    confirmModal: null,
    movePicker: null,  // { keys, target }
    shortcutsOpen: false,
    updatePrompt: null,
    updateDl: null,    // { phase: 'downloading' | 'ready' | 'error', received, total }
    mobileSearch: false,
    dropActive: false,
    transfersOpen: true,

    appVersion: '',
    toasts: [],
    uploads: [],
    tasks: [], // long-running drive operations (Empty Trash, drag prep), shown as progress rows
    dragReady: new Set(),     // file ids with a local copy, draggable right now
    dragPreparing: new Set(), // file ids currently being fetched for a drag
    previewOverlay: null,
    detailThumb: null,
  };

  let pdfjsLibPromise = null; // lazy-loaded, cached — only fetched the first time a PDF is previewed
  let pdfPreviewToken = 0; // bumped on every openPreview()/close so a stale async render can't stomp a newer one
  let detailThumbToken = 0; // bumped whenever the selection changes so a stale thumb fetch can't stomp a newer one
  let toastSeq = 0;
  let dragCounter = 0;

  // Thumbnails cost a full download from Discord, so the ones already fetched
  // for the detail pane are kept (LRU) and reused by the grid view.
  const THUMB_CACHE_MAX = 60;
  const thumbCache = new Map(); // file id → blob URL
  function cacheThumb(id, url) {
    thumbCache.delete(id);
    thumbCache.set(id, url);
    while (thumbCache.size > THUMB_CACHE_MAX) {
      const [oldId, oldUrl] = thumbCache.entries().next().value;
      thumbCache.delete(oldId);
      URL.revokeObjectURL(oldUrl);
    }
  }

  // ---- theme -----------------------------------------------------------------
  function effectiveTheme() { return state.theme === 'system' ? (state.systemDark ? 'dark' : 'light') : state.theme; }
  function styleDefaultAccent() {
    if (state.uiStyle === 'nothing') return '#d71921';
    return effectiveTheme() === 'dark' ? '#378ef0' : '#1473e6';
  }
  function accentHex() {
    const a = ACCENTS.find((x) => x.id === state.accent);
    return a && a.value ? a.value : styleDefaultAccent();
  }
  // Text on an accent fill: amber and green need black, the rest white.
  function onAccent(hex) {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#ffffff';
  }
  function applyThemeVars() {
    const el = document.documentElement;
    el.dataset.theme = effectiveTheme();
    el.dataset.ui = state.uiStyle;
    el.dataset.density = state.density;
    const hex = accentHex();
    el.style.setProperty('--accent', hex);
    el.style.setProperty('--on-accent', onAccent(hex));
    ls.set('beanydrive_accent_hex', hex);
  }

  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (mq) {
    state.systemDark = mq.matches;
    if (mq.addEventListener) mq.addEventListener('change', (e) => { state.systemDark = e.matches; applyThemeVars(); render(); });
  }

  // ---- toasts ------------------------------------------------------------------
  function showToast(msg, opts = {}) {
    const id = ++toastSeq;
    state.toasts = [...state.toasts.slice(-2), { id, msg, kind: opts.kind || 'info', action: opts.action || null }];
    render();
    setTimeout(() => dismissToast(id), opts.action ? 6000 : 3200);
  }
  function dismissToast(id) {
    if (!state.toasts.some((t) => t.id === id)) return;
    state.toasts = state.toasts.filter((t) => t.id !== id);
    render();
  }

  // Every fire-and-forget IPC call goes through here so a rejected invoke —
  // not connected yet, a Discord API error — surfaces as a toast instead of
  // a silent unhandled rejection. A failure also re-syncs from main, since the
  // UI may have applied the change optimistically.
  function apiCall(promise, onSuccess) {
    return promise.then((res) => { if (onSuccess) onSuccess(res); return res; })
      .catch((e) => {
        showToast(e.message || String(e), { kind: 'err' });
        resync();
      });
  }
  function resync() {
    api.getStatus().then((snap) => { applyStatusSnapshot(snap); render(); }).catch(() => {});
  }

  // Applies a change locally before main confirms it, so a star or a trash
  // lands instantly instead of after three Discord round trips. The snapshot
  // main pushes afterwards replaces state.files wholesale either way.
  function patchLocal(ids, fn) {
    const set = new Set(ids.map(String));
    state.files = state.files.map((f) => (set.has(String(f.id)) ? fn({ ...f }) : f));
    render();
  }

  // ---- IPC wiring ----------------------------------------------------------------
  function applyStatusSnapshot(snap) {
    state.connection.status = snap.status;
    state.connection.channelName = snap.channelName;
    state.connection.guildName = snap.guildName;
    state.connection.chunkLimitMb = snap.chunkLimitMb;
    state.files = snap.files || [];
    state.folders = snap.folders || [];
  }

  api.onUpdate((snap) => { applyStatusSnapshot(snap); render(); });
  api.onStatus(({ status, message }) => {
    state.connection.status = status;
    state.connection.message = message;
    render();
  });
  // Main owns the row list; this is a wholesale replace, not a patch.
  api.onUploads((rows) => { state.uploads = rows; render(); });
  api.onDragCache(({ ready, preparing }) => {
    state.dragReady = new Set(ready);
    state.dragPreparing = new Set(preparing);
    render();
  });
  api.onTaskProgress(({ taskId, label, progress, detail }) => {
    let t = state.tasks.find((x) => x.taskId === taskId);
    if (!t) { t = { taskId, label, progress: 0, detail: '' }; state.tasks = [...state.tasks, t]; }
    t.label = label;
    t.progress = progress;
    t.detail = detail;
    render();
  });
  api.onTaskDone(({ taskId, ok, message }) => {
    state.tasks = state.tasks.filter((t) => t.taskId !== taskId);
    showToast(message, { kind: ok ? 'ok' : 'err' });
  });
  // Terminal outcomes only — a paused or failed upload keeps its row instead.
  api.onUploadDone(({ name, ok, error, canceled }) => {
    if (ok) showToast(`Uploaded ${name}`, { kind: 'ok' });
    else if (canceled) showToast(`Canceled ${name}`);
    else showToast(`Failed: ${name}${error ? ' — ' + error : ''}`, { kind: 'err' });
  });
  api.onPreviewProgress(({ fileId, progress }) => {
    if (state.previewOverlay && state.previewOverlay.fileId === fileId) {
      state.previewOverlay.progress = progress;
      renderPreviewOverlay();
    }
  });

  // ---- derived data ----------------------------------------------------------------
  // Everything below is recomputed only when main sends a new snapshot (it
  // replaces state.files/state.folders, so identity is the cache key) — not on
  // every upload tick, toast or keypress, which is what render() mostly runs for.
  let indexMemo = null;
  function getIndex() {
    const files = state.files;
    const folders = state.folders;
    if (indexMemo && indexMemo.files === files && indexMemo.folders === folders) return indexMemo;

    const live = [], trash = [], starred = [];
    const byPath = new Map();   // folder → live files directly inside it
    const folderSet = new Set();
    const stats = new Map();    // folder → { count, size }, recursive
    const tagCounts = {};
    const byKey = new Map();
    let totalBytes = 0;

    const addChain = (p) => {
      while (p && !folderSet.has(p)) { folderSet.add(p); p = parentOf(p); }
    };
    for (const f of files) {
      byKey.set(String(f.id), f);
      if (f.trashed) { trash.push(f); continue; }
      live.push(f);
      totalBytes += f.size || 0;
      if (f.starred) starred.push(f);
      for (const t of f.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
      const p = normPath(f.path);
      let bucket = byPath.get(p);
      if (!bucket) { bucket = []; byPath.set(p, bucket); }
      bucket.push(f);
      if (p) {
        addChain(p);
        for (let q = p; q; q = parentOf(q)) {
          let s = stats.get(q);
          if (!s) { s = { count: 0, size: 0 }; stats.set(q, s); }
          s.count += 1;
          s.size += f.size || 0;
        }
      }
    }
    for (const fp of folders) addChain(normPath(fp));

    const children = new Map(); // parent → child folder paths, by name
    for (const p of folderSet) {
      const parent = parentOf(p);
      let arr = children.get(parent);
      if (!arr) { arr = []; children.set(parent, arr); }
      arr.push(p);
    }
    for (const arr of children.values()) arr.sort((a, b) => collator.compare(basenameOf(a), basenameOf(b)));
    const recent = [...live].sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 50);

    indexMemo = { files, folders, live, trash, starred, recent, byPath, folderSet, children, stats, tagCounts, byKey, totalBytes };
    return indexMemo;
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  // Row objects are cached per file object; a snapshot hands over new objects
  // only for files that changed in main… or all of them, which is still fine.
  const fileRowCache = new WeakMap();
  function fileRow(f) {
    let r = fileRowCache.get(f);
    if (!r) {
      r = {
        key: String(f.id), id: f.id, isFolder: false, file: f, name: f.name, lname: f.name.toLowerCase(),
        size: f.size, created: f.created, tags: f.tags || [], starred: !!f.starred, trashed: !!f.trashed,
        path: normPath(f.path), chunks: f.chunks, cat: categoryFor(f.name),
      };
      fileRowCache.set(f, r);
    }
    return r;
  }
  function folderRow(p, idx) {
    const s = idx.stats.get(p) || { count: 0, size: 0 };
    const name = basenameOf(p);
    return { key: `folder:${p}`, isFolder: true, targetNav: p, path: p, name, lname: name.toLowerCase(), fileCount: s.count, size: s.size, created: null, tags: [], cat: 'folder' };
  }
  function tagRow(id, idx) {
    const t = TAGS[id];
    return { key: `tag:${id}`, isFolder: true, isTag: true, targetNav: `tag:${id}`, name: t.name, lname: t.name.toLowerCase(), fileCount: idx.tagCounts[id] || 0, size: null, created: null, tags: [], cat: 'tag', color: t.color };
  }

  function isVirtualNav(nav) {
    return ['root', 'starred', 'recent', 'trash', 'tags'].includes(nav) || nav.startsWith('tag:');
  }
  // 'root' and the virtual views aren't real folder paths — uploads and new
  // folders made while viewing one of them land at the drive root.
  function currentFolder() { return isVirtualNav(state.nav) ? '' : state.nav; }

  let rowsMemo = null;
  function getRows() {
    const idx = getIndex();
    const key = [state.nav, state.searchQuery, state.typeFilter, state.sortBy, state.sortDir, Object.keys(TAGS).length].join('\u0001');
    if (rowsMemo && rowsMemo.idx === idx && rowsMemo.key === key) return rowsMemo;

    const nav = state.nav;
    const q = state.searchQuery.trim().toLowerCase();
    const matches = (r) => r.lname.includes(q) || r.tags.some((t) => t.includes(q) || (TAGS[t] && TAGS[t].name.toLowerCase().includes(q)));
    let rows;
    let searchedDrive = false;
    if (nav === 'trash') rows = idx.trash.map(fileRow);
    else if (nav === 'starred') rows = idx.starred.map(fileRow);
    else if (nav === 'recent') rows = idx.recent.map(fileRow);
    else if (nav === 'tags') rows = Object.keys(TAGS).map((id) => tagRow(id, idx));
    else if (nav.startsWith('tag:')) {
      const tagId = nav.slice(4);
      rows = idx.live.filter((f) => (f.tags || []).includes(tagId)).map(fileRow);
    } else if (q) {
      // Searching from My Drive or a folder searches the whole drive — the
      // file you're looking for is rarely in the folder you happen to be in.
      searchedDrive = true;
      rows = [
        ...[...idx.folderSet].map((p) => folderRow(p, idx)),
        ...idx.live.map(fileRow),
      ].filter(matches);
    } else {
      const cur = nav === 'root' ? '' : nav;
      rows = [
        ...(idx.children.get(cur) || []).map((p) => folderRow(p, idx)),
        ...(idx.byPath.get(cur) || []).map(fileRow),
      ];
    }
    if (q && !searchedDrive) rows = rows.filter(matches);
    const filter = TYPE_FILTERS.find((t) => t.id === state.typeFilter);
    if (filter && filter.cats && nav !== 'tags') rows = rows.filter((r) => !r.isFolder && filter.cats.includes(r.cat));

    if (nav !== 'recent' || state.sortBy !== 'date') {
      const dir = state.sortDir === 'asc' ? 1 : -1;
      const by = state.sortBy;
      rows = rows.slice().sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        let d = 0;
        if (by === 'size') d = (a.size || 0) - (b.size || 0);
        else if (by === 'date') d = (a.created || 0) - (b.created || 0);
        else if (by === 'type') d = collator.compare(a.cat, b.cat);
        if (!d) d = collator.compare(a.name, b.name) * (by === 'name' ? 1 : -1);
        return d * dir;
      });
    }

    const meta = new Map();
    const keys = rows.map((r) => { meta.set(r.key, r); return r.key; });
    rowsMemo = { idx, key, rows, meta, keys, searchedDrive };
    return rowsMemo;
  }

  function rowFor(key) { return key ? getRows().meta.get(key) : null; }
  function selectedRows() {
    const { meta } = getRows();
    return [...state.selected].map((k) => meta.get(k)).filter(Boolean);
  }
  function selectedFiles() { return selectedRows().filter((r) => !r.isFolder); }
  // Selection drops anything that left the view (trashed, moved, renamed away).
  function pruneSelection() {
    const { meta } = getRows();
    for (const k of state.selected) if (!meta.has(k)) state.selected.delete(k);
    if (state.focusKey && !meta.has(state.focusKey)) state.focusKey = null;
    if (state.anchorKey && !meta.has(state.anchorKey)) state.anchorKey = null;
    if (state.sheet && !meta.has(state.sheet)) state.sheet = null;
    if (state.selectMode && !state.selected.size && layout !== 'mobile') state.selectMode = false;
  }

  // ---- layout ----------------------------------------------------------------------
  // Phones (and very narrow windows) get their own shell: app bar, bottom
  // navigation, action sheets. Tablets running the APK keep the desktop panes.
  let layout = null;
  let R = {};
  let searchInput = null;

  function wantLayout() {
    const w = window.innerWidth;
    return (w < 760 || (api.isMobile && w < 900)) ? 'mobile' : 'desktop';
  }

  const DESKTOP_SKELETON = `
    <header class="appbar">
      <div class="appbar-left">
        <img class="brand-mark" src="logo.png" alt="" draggable="false">
        <span class="brand-name">BeanyDrive</span>
        <label class="search-box">
          ${icon('search', 16)}
          <input id="search-input" type="search" placeholder="Search your drive" spellcheck="false" autocomplete="off">
          <kbd>/</kbd>
        </label>
      </div>
      <div class="appbar-right">
        <div data-region="conn"></div>
        <button class="icon-btn" data-act="toggle-theme" title="Toggle light / dark">${icon('theme')}</button>
        <button class="icon-btn" data-act="shortcuts" title="Keyboard shortcuts (?)">${icon('keyboard')}</button>
        <button class="icon-btn" data-act="toggle-detail" title="Details panel (i)">${icon('panel')}</button>
        <button class="icon-btn" data-act="settings" title="Settings (,)">${icon('settings')}</button>
        <div class="win-buttons">
          <button class="win-btn" data-act="win-min" title="Minimize">${icon('winMin', 16)}</button>
          <button class="win-btn" data-act="win-max" title="Maximize">${icon('winMax', 16)}</button>
          <button class="win-btn win-close" data-act="win-close" title="Close">${icon('winClose', 16)}</button>
        </div>
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar" data-region="sidebar"></aside>
      <main class="content" data-region-host="content">
        <div class="content-head" data-region="head"></div>
        <div class="selbar-host" data-region="selbar"></div>
        <div class="content-body" data-region="body"></div>
        <div class="content-foot" data-region="status"></div>
      </main>
      <aside class="detail" data-region="detail"></aside>
    </div>
    <div class="transfers-host" data-region="transfers"></div>
    <div data-region="overlay"></div>
    <div class="toast-host" data-region="toasts"></div>`;

  const MOBILE_SKELETON = `
    <header class="m-appbar" data-region="mbar"></header>
    <div class="m-search">
      <label class="search-box">
        ${icon('search', 16)}
        <input id="search-input" type="search" placeholder="Search your drive" spellcheck="false" autocomplete="off" enterkeyhint="search">
      </label>
    </div>
    <div class="m-head" data-region="head"></div>
    <div class="selbar-host" data-region="selbar"></div>
    <main class="m-body content-body" data-region="body"></main>
    <button class="m-fab" data-act="new-menu" aria-label="Upload or create">${icon('plus', 24)}</button>
    <div class="transfers-host" data-region="transfers"></div>
    <nav class="m-nav" data-region="mnav"></nav>
    <div data-region="sheet"></div>
    <div data-region="overlay"></div>
    <div class="toast-host" data-region="toasts"></div>`;

  function ensureLayout() {
    const want = wantLayout();
    if (want === layout) return;
    layout = want;
    document.documentElement.dataset.layout = want;
    state.menu = null;
    root.innerHTML = want === 'mobile' ? MOBILE_SKELETON : DESKTOP_SKELETON;
    R = {};
    root.querySelectorAll('[data-region]').forEach((el) => { R[el.dataset.region] = el; });
    R.overlay.innerHTML = OVERLAY_HTML;
    searchInput = document.getElementById('search-input');
    searchInput.value = state.searchQuery;
  }

  // Each region is rebuilt as a string and only touches the DOM when that
  // string changed — an upload tick re-renders the transfers card and
  // nothing else, and the file list keeps its nodes (and hover, and scroll)
  // through everything that isn't about the list.
  // Entry animations hang off an .enter class added only when a region goes
  // from empty to filled — so a modal or the transfers card animates in once,
  // not again on every progress tick that rebuilds it.
  function patch(el, html) {
    if (!el || el.__html === html) return false;
    const wasEmpty = !el.__html;
    el.innerHTML = html;
    el.__html = html;
    if (wasEmpty && el.firstElementChild) el.firstElementChild.classList.add('enter');
    return true;
  }

  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(flushQueued);
    // rAF never fires in a hidden or minimised window; state still has to land.
    setTimeout(flushQueued, 100);
  }
  function flushQueued() { if (renderQueued) flush(); }
  // For the few callers that read the DOM straight after changing state.
  function renderSync() { flush(); }
  function flush() {
    renderQueued = false;
    const active = document.activeElement;
    const id = active && active.id;
    const selStart = active && 'selectionStart' in active ? active.selectionStart : null;
    const selEnd = active && 'selectionEnd' in active ? active.selectionEnd : null;
    doRender();
    if (id && document.activeElement !== active) {
      const el = document.getElementById(id);
      if (el && el !== active) {
        el.focus();
        if (selStart != null && el.setSelectionRange) { try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text field */ } }
      }
    }
  }

  function doRender() {
    ensureLayout();
    pruneSelection();
    const view = getRows();
    const focus = rowFor(state.focusKey);
    const thumbTarget = layout === 'mobile' ? rowFor(state.sheet) : (state.detailOpen ? focus : null);
    ensureDetailThumb(thumbTarget && !thumbTarget.isFolder && state.selected.size <= 1 ? thumbTarget.file : null);

    document.documentElement.classList.toggle('detail-closed', !state.detailOpen);
    if (layout === 'desktop') {
      patch(R.conn, buildConn());
      patch(R.sidebar, buildSidebar());
      patch(R.detail, state.detailOpen ? buildDetail(view, focus) : '');
    } else {
      patch(R.mbar, buildMobileBar());
      patch(R.mnav, buildMobileNav());
      patch(R.sheet, buildMobileSheet());
      root.classList.toggle('m-searching', state.mobileSearch || !!state.searchQuery);
      root.classList.toggle('m-selecting', state.selectMode || state.selected.size > 0);
    }
    patch(R.head, buildHead(view));
    patch(R.selbar, buildSelectionBar());
    const bodyChanged = patch(R.body, buildBody(view));
    patch(R.status, layout === 'desktop' ? buildStatus(view) : '');
    patch(R.transfers, buildTransfers());
    renderOverlays();
    patch(R.toasts, buildToasts());
    if (searchInput && document.activeElement !== searchInput && searchInput.value !== state.searchQuery) searchInput.value = state.searchQuery;

    if (state.scrollToFocus || bodyChanged) {
      if (state.scrollToFocus && state.focusKey) {
        const el = R.body.querySelector('.focus');
        if (el) el.scrollIntoView({ block: 'nearest' });
      }
      state.scrollToFocus = false;
    }
    positionMenu();
  }

  // ---- region builders: shared --------------------------------------------------------
  function tile(r, size) {
    const cat = r.cat || 'other';
    const style = r.isTag ? ` style="--tile:${r.color}"` : '';
    return `<span class="tile t-${cat}${size ? ` tile-${size}` : ''}"${style}>${icon(CATEGORY[cat] ? CATEGORY[cat].glyph : 'file')}</span>`;
  }
  function tagChips(tags, removable) {
    return (tags || []).map((t) => (TAGS[t]
      ? `<span class="tag-chip" style="--tag:${TAGS[t].color}"><i></i>${esc(TAGS[t].name)}${removable ? `<button class="tag-x" data-act="remove-tag" data-tag="${esc(t)}" title="Remove tag">${icon('close', 12)}</button>` : ''}</span>`
      : '')).join('');
  }
  function navLabel(nav) {
    if (nav === 'root') return 'My Drive';
    if (nav === 'starred') return 'Starred';
    if (nav === 'recent') return 'Recent';
    if (nav === 'trash') return 'Trash';
    if (nav === 'tags') return 'Tags';
    if (nav.startsWith('tag:')) return (TAGS[nav.slice(4)] || {}).name || nav.slice(4);
    return basenameOf(nav);
  }
  function crumbs() {
    const nav = state.nav;
    if (nav.startsWith('tag:')) return [{ nav: 'tags', label: 'Tags' }, { nav, label: navLabel(nav) }];
    if (isVirtualNav(nav)) return [{ nav, label: navLabel(nav) }];
    const out = [{ nav: 'root', label: 'My Drive' }];
    let acc = '';
    for (const part of nav.split('/')) { acc = joinPath(acc, part); out.push({ nav: acc, label: part }); }
    return out;
  }
  function connMeta() {
    const s = state.connection.status;
    if (s === 'connected') return { cls: 'ok', label: state.connection.channelName ? `#${state.connection.channelName}` : 'Connected' };
    if (s === 'connecting') return { cls: 'busy', label: 'Connecting…' };
    if (s === 'error') return { cls: 'err', label: state.connection.message || 'Connection error' };
    return { cls: 'off', label: 'Not connected' };
  }
  function sortLabel() {
    return ({ name: 'Name', date: 'Date', size: 'Size', type: 'Type' })[state.sortBy] || 'Date';
  }

  function buildHead(view) {
    const cs = crumbs();
    const title = cs[cs.length - 1].label;
    const trashBusy = emptyingTrash();
    const count = view.rows.length;
    const crumbHtml = cs.map((c, i) => (i === cs.length - 1
      ? `<span class="crumb current">${esc(c.label)}</span>`
      : `<button class="crumb" data-nav="${esc(c.nav)}">${esc(c.label)}</button><span class="crumb-sep">${icon('chevronRight', 14)}</span>`)).join('');
    const filters = state.nav === 'tags' ? '' : `
      <div class="chips" role="tablist">
        ${TYPE_FILTERS.map((t) => `<button class="chip ${state.typeFilter === t.id ? 'on' : ''}" data-act="type-filter" data-type="${t.id}">${esc(t.label)}</button>`).join('')}
      </div>`;
    const sortBtn = `<button class="tb-btn" data-act="sort-menu" title="Sort">${icon(state.sortDir === 'asc' ? 'sortAsc' : 'sortDesc', 18)}<span>${sortLabel()}</span></button>`;
    const viewToggle = `
      <div class="segmented icon-seg">
        <button class="${state.viewMode === 'list' ? 'on' : ''}" data-act="view" data-view="list" title="List">${icon('list', 18)}</button>
        <button class="${state.viewMode === 'grid' ? 'on' : ''}" data-act="view" data-view="grid" title="Grid">${icon('grid', 18)}</button>
      </div>`;

    if (layout === 'mobile') {
      return `
        ${cs.length > 1 ? `<div class="crumbs">${crumbHtml}</div>` : ''}
        <div class="m-tools">
          ${sortBtn}
          ${viewToggle}
          ${state.nav === 'trash' && view.idx.trash.length ? `<button class="tb-btn danger" data-act="empty-trash" ${trashBusy ? 'disabled' : ''}>${icon('trash', 18)}<span>${trashBusy ? 'Emptying…' : 'Empty'}</span></button>` : ''}
        </div>
        ${filters}`;
    }
    return `
      <div class="crumbs">${crumbHtml}</div>
      <div class="head-row">
        <h1 class="view-title">${esc(title)}</h1>
        <span class="view-count">${plural(count, 'item')}</span>
        <div class="toolbar">
          ${state.nav === 'trash'
            ? `<button class="btn btn-quiet danger" data-act="empty-trash" ${trashBusy || !view.idx.trash.length ? 'disabled' : ''}>${icon('trash', 18)}${trashBusy ? 'Emptying…' : 'Empty Trash'}</button>`
            : `<button class="btn" data-act="new-folder">${icon('folderPlus', 18)}New folder</button>
               <button class="btn btn-primary" data-act="upload">${icon('upload', 18)}Upload</button>`}
          <span class="tb-sep"></span>
          ${sortBtn}
          ${viewToggle}
          <button class="icon-btn" data-act="refresh" title="Refresh from Discord (F5)">${icon('refresh')}</button>
        </div>
      </div>
      ${filters}`;
  }

  function buildSelectionBar() {
    const n = state.selected.size;
    const showOnDesktop = n > 1 || (n === 1 && !state.detailOpen);
    if (!n || (layout === 'desktop' && !showOnDesktop)) {
      return (layout === 'mobile' && state.selectMode)
        ? `<div class="selbar"><button class="icon-btn" data-act="clear-selection" title="Done">${icon('close')}</button><span class="sel-count">Tap items to select</span></div>`
        : '';
    }
    const rows = selectedRows();
    const files = rows.filter((r) => !r.isFolder);
    const bytes = files.reduce((a, r) => a + (r.size || 0), 0);
    const inTrash = state.nav === 'trash';
    const allStarred = files.length && files.every((r) => r.starred);
    const btn = (act, ic, label, extra = '') => `<button class="tb-btn ${extra}" data-act="${act}" title="${label}">${icon(ic, 18)}<span>${label}</span></button>`;
    return `
      <div class="selbar">
        <button class="icon-btn" data-act="clear-selection" title="Clear selection (Esc)">${icon('close')}</button>
        <span class="sel-count">${plural(n, 'selected', 'selected')}${bytes ? ` <span class="dim">· ${fmtSize(bytes)}</span>` : ''}</span>
        <span class="grow"></span>
        ${files.length ? (inTrash
          ? btn('restore', 'restore', 'Restore')
          : `${btn('star', allStarred ? 'starFill' : 'star', allStarred ? 'Unstar' : 'Star')}
             ${btn('download', 'download', 'Download')}
             ${btn('move', 'move', 'Move')}
             ${btn('trash', 'trash', 'Trash', 'danger')}`) : ''}
        <button class="icon-btn" data-act="select-all" title="Select all (Ctrl+A)">${icon('selectAll')}</button>
      </div>`;
  }

  function buildEmpty(view) {
    const s = state.connection.status;
    if (s !== 'connected') {
      const busy = s === 'connecting';
      return `
        <div class="empty-state hero-empty">
          <div class="empty-art">${icon('drive', 40)}</div>
          <h2>${busy ? 'Connecting to Discord…' : 'Connect your drive'}</h2>
          <p>${busy ? 'Loading the file index from your channel.' : (s === 'error' ? esc(state.connection.message || 'The connection failed.') : 'BeanyDrive stores files as chunks in a Discord channel. Add a bot token and channel ID to start.')}</p>
          ${busy ? '' : `<button class="btn btn-primary" data-act="settings">${icon('settings', 18)}Open settings</button>`}
        </div>`;
    }
    if (state.searchQuery) {
      return `<div class="empty-state"><div class="empty-art">${icon('search', 36)}</div><h2>No results</h2><p>Nothing matches “${esc(state.searchQuery)}”${state.typeFilter !== 'all' ? ' with this type filter' : ''}.</p></div>`;
    }
    if (state.typeFilter !== 'all') {
      return `<div class="empty-state"><div class="empty-art">${icon('file', 36)}</div><h2>Nothing of this type here</h2><button class="btn" data-act="type-filter" data-type="all">Show all files</button></div>`;
    }
    const msgs = {
      trash: ['Trash is empty', 'Files you delete wait here until you empty it.', 'trash'],
      starred: ['No starred files', 'Star files to keep them one click away.', 'star'],
      recent: ['Nothing yet', 'Files you upload show up here.', 'clock'],
      tags: ['No tags', 'Add a tag to a file from its details.', 'tag'],
    };
    const m = msgs[state.nav] || (state.nav.startsWith('tag:')
      ? ['No files with this tag', 'Add it to a file from the details panel.', 'tag']
      : ['This folder is empty', layout === 'mobile' ? 'Tap + to upload files here.' : 'Drop files anywhere in the window, or use Upload.', 'folder']);
    const canUpload = !['trash', 'starred', 'recent', 'tags'].includes(state.nav) && !state.nav.startsWith('tag:');
    return `
      <div class="empty-state ${canUpload ? 'drop-empty' : ''}">
        <div class="empty-art">${icon(m[2], 36)}</div>
        <h2>${m[0]}</h2><p>${m[1]}</p>
        ${canUpload ? `<button class="btn btn-primary" data-act="upload">${icon('upload', 18)}Upload files</button>` : ''}
      </div>`;
  }

  function rowSub(r, view) {
    if (r.isFolder) return plural(r.fileCount, 'file');
    const parts = [fmtSize(r.size), fmtDate(r.created)];
    if (view.searchedDrive || ['starred', 'recent', 'trash'].includes(state.nav) || state.nav.startsWith('tag:')) parts.push(r.path ? r.path : 'My Drive');
    return parts.filter(Boolean).join(' · ');
  }
  function dragClass(r) {
    if (r.isFolder || layout === 'mobile') return '';
    if (state.dragPreparing.has(r.id)) return ' drag-preparing';
    return state.dragReady.has(r.id) ? ' drag-ready' : '';
  }

  function buildBody(view) {
    const rows = view.rows;
    if (!rows.length || state.connection.status !== 'connected') return buildEmpty(view);
    const sel = state.selected;
    const draggable = layout === 'desktop';

    if (state.viewMode === 'grid') {
      return `<div class="grid">${rows.map((r) => {
        const thumb = !r.isFolder && thumbCache.get(r.id);
        return `
          <div class="card${sel.has(r.key) ? ' sel' : ''}${state.focusKey === r.key ? ' focus' : ''}${dragClass(r)}" data-row="${esc(r.key)}"${draggable && !r.isFolder ? ' draggable="true"' : ''}>
            <div class="card-art">${thumb ? `<img src="${thumb}" alt="" loading="lazy" decoding="async">` : tile(r, 'xl')}
              ${r.starred ? `<span class="card-star">${icon('starFill', 14)}</span>` : ''}
              <span class="card-check">${icon('check', 14)}</span>
            </div>
            <div class="card-name" title="${esc(r.name)}">${esc(r.name)}</div>
            <div class="card-sub">${esc(rowSub(r, view))}</div>
          </div>`;
      }).join('')}</div>`;
    }

    // The desktop list has columns for size and date, so its second line only
    // says where a file lives — and only in views that mix folders.
    const showLoc = view.searchedDrive || ['starred', 'recent', 'trash'].includes(state.nav) || state.nav.startsWith('tag:');
    const sub = (r) => {
      if (layout === 'mobile') return rowSub(r, view);
      if (!showLoc) return '';
      return (r.isFolder ? parentOf(r.path) : r.path) || 'My Drive';
    };
    const arrow = (k) => (state.sortBy === k ? icon(state.sortDir === 'asc' ? 'sortAsc' : 'sortDesc', 14) : '');
    const head = layout === 'desktop' ? `
      <div class="list-head">
        <button class="c-name" data-act="sort-by" data-sort="name">Name ${arrow('name')}</button>
        <button class="c-date" data-act="sort-by" data-sort="date">Added ${arrow('date')}</button>
        <button class="c-size" data-act="sort-by" data-sort="size">Size ${arrow('size')}</button>
        <span class="c-tags">Tags</span>
        <span class="c-more"></span>
      </div>` : '';
    return `<div class="list">${head}${rows.map((r) => `
      <div class="row${sel.has(r.key) ? ' sel' : ''}${state.focusKey === r.key ? ' focus' : ''}${dragClass(r)}" data-row="${esc(r.key)}"${draggable && !r.isFolder ? ' draggable="true"' : ''}>
        <span class="c-check">${icon('check', 14)}</span>
        <span class="c-name">
          ${tile(r)}
          <span class="name-stack">
            <span class="name-text">${esc(r.name)}${r.starred ? `<span class="star-mark">${icon('starFill', 13)}</span>` : ''}${r.chunks && r.chunks.length > 1 ? `<span class="parts-chip" title="Stored as ${r.chunks.length} chunks">${r.chunks.length}×</span>` : ''}</span>
            ${(() => { const s = sub(r); return s ? `<span class="name-sub">${esc(s)}</span>` : ''; })()}
          </span>
        </span>
        <span class="c-date">${r.isFolder ? '' : esc(fmtDate(r.created))}</span>
        <span class="c-size">${r.isFolder ? esc(plural(r.fileCount, 'file')) : esc(fmtSize(r.size))}</span>
        <span class="c-tags">${tagChips(r.tags)}</span>
        <span class="c-more"><button class="icon-btn small" data-act="row-menu" title="More actions">${icon('more')}</button></span>
      </div>`).join('')}</div>`;
  }

  function buildStatus(view) {
    const idx = view.idx;
    return `
      <span>${plural(view.rows.length, 'item')}${state.selected.size ? ` · ${state.selected.size} selected` : ''}</span>
      <span class="grow"></span>
      <span>${fmtSize(idx.totalBytes)} in ${plural(idx.live.length, 'file')}${state.connection.chunkLimitMb ? ` · ${state.connection.chunkLimitMb} MB chunks` : ''}</span>`;
  }

  function buildTransfers() {
    const ups = state.uploads;
    const tasks = state.tasks;
    if (!ups.length && !tasks.length) return '';
    const running = ups.filter((u) => u.state === 'running' || u.state === 'queued').length;
    const all = [...ups.map((u) => u.progress || 0), ...tasks.map((t) => t.progress || 0)];
    const avg = Math.round(all.reduce((a, b) => a + b, 0) / all.length);
    const failed = ups.filter((u) => u.state === 'failed').length;
    const speed = ups.reduce((a, u) => a + (u.state === 'running' && u.bytesPerSec ? u.bytesPerSec : 0), 0);
    const title = running ? `Uploading ${plural(running, 'file')}` : (tasks.length ? tasks[0].label : (failed ? `${plural(failed, 'upload')} failed` : 'Transfers paused'));
    const btn = (u, action, ic, t) => `<button class="icon-btn small" data-act="upload-${action}" data-upload-id="${esc(u.uploadId)}" title="${t}">${icon(ic, 16)}</button>`;
    const list = state.transfersOpen ? `
      <div class="tr-list">
        ${tasks.map((t) => `
          <div class="tr-row">
            <span class="tile t-other">${icon('refresh')}</span>
            <div class="tr-main">
              <div class="tr-name">${esc(t.label)}</div>
              <div class="bar"><span style="width:${t.progress}%"></span></div>
              <div class="tr-sub">${esc(t.detail || '')}</div>
            </div>
            <span class="tr-pct">${t.progress}%</span>
          </div>`).join('')}
        ${ups.map((u) => {
          let detail;
          if (u.state === 'failed') detail = u.error || 'failed';
          else if (u.state === 'paused') detail = 'Paused';
          else if (u.state === 'queued') detail = 'Queued';
          else detail = [fmtSpeed(u.bytesPerSec), fmtEta(u.etaSeconds)].filter(Boolean).join(' · ') || 'Starting…';
          let ctl = '';
          if (u.state === 'running') ctl = btn(u, 'pause', 'pause', 'Pause');
          else if (u.state === 'queued') ctl = btn(u, 'pause', 'pause', 'Hold this file');
          else if (u.state === 'paused') ctl = btn(u, 'resume', 'play', 'Resume');
          else if (u.state === 'failed') ctl = btn(u, 'resume', 'refresh', 'Retry — re-sends only the missing chunks');
          return `
            <div class="tr-row ${u.state}">
              ${tile({ cat: categoryFor(u.name) })}
              <div class="tr-main">
                <div class="tr-name" title="${esc(u.name)}">${esc(u.name)}</div>
                <div class="bar ${u.state}"><span style="width:${u.progress}%"></span></div>
                <div class="tr-sub" title="${esc(u.error || '')}">${esc(detail)}</div>
              </div>
              <span class="tr-pct">${u.progress}%</span>
              ${ctl}
              ${btn(u, 'cancel', 'close', u.state === 'running' ? 'Cancel upload' : 'Discard — deletes the chunks already uploaded')}
            </div>`;
        }).join('')}
      </div>` : '';
    return `
      <div class="transfers ${state.transfersOpen ? 'open' : ''}">
        <button class="tr-head" data-act="toggle-transfers">
          <span class="tr-icon">${icon('upload', 18)}</span>
          <span class="tr-title">${esc(title)}</span>
          ${speed ? `<span class="tr-speed">${fmtSpeed(speed)}</span>` : ''}
          <span class="tr-pct">${avg}%</span>
          ${icon(state.transfersOpen ? 'chevronDown' : 'chevronRight', 16)}
        </button>
        <div class="bar total"><span style="width:${avg}%"></span></div>
        ${list}
      </div>`;
  }

  function buildToasts() {
    return state.toasts.map((t) => `
      <div class="toast ${t.kind}">
        ${icon(t.kind === 'err' ? 'warn' : (t.kind === 'ok' ? 'check' : 'info'), 18)}
        <span class="toast-msg">${esc(t.msg)}</span>
        ${t.action ? `<button class="toast-btn" data-act="toast-action" data-toast="${t.id}">${esc(t.action.label)}</button>` : ''}
      </div>`).join('');
  }

  // ---- desktop regions --------------------------------------------------------------
  function buildConn() {
    const c = connMeta();
    return `<button class="conn-pill ${c.cls}" data-act="settings" title="${esc(state.connection.guildName ? `${state.connection.guildName} — open settings` : 'Open settings')}"><i></i><span>${esc(c.label)}</span></button>`;
  }

  function buildFolderTree(idx, parent, depth) {
    const kids = idx.children.get(parent) || [];
    return kids.map((p) => {
      const hasKids = (idx.children.get(p) || []).length > 0;
      const open = state.expanded.has(p);
      const s = idx.stats.get(p);
      return `
        <div class="nav-item tree ${state.nav === p ? 'active' : ''}" data-nav="${esc(p)}" style="--depth:${depth}" title="${esc(p)}">
          ${hasKids ? `<button class="caret ${open ? 'open' : ''}" data-act="toggle-expand" data-path="${esc(p)}">${icon('chevronRight', 14)}</button>` : '<span class="caret-pad"></span>'}
          ${icon('folder', 18)}
          <span class="nav-label">${esc(basenameOf(p))}</span>
          <span class="nav-count">${s ? s.count : 0}</span>
        </div>
        ${hasKids && open ? buildFolderTree(idx, p, depth + 1) : ''}`;
    }).join('');
  }

  function buildSidebar() {
    const idx = getIndex();
    const item = (id, ic, label, count) => `
      <div class="nav-item ${state.nav === id ? 'active' : ''}" data-nav="${id}">
        ${icon(ic, 18)}<span class="nav-label">${label}</span>${count != null ? `<span class="nav-count">${count}</span>` : ''}
      </div>`;
    const rootCount = (idx.children.get('') || []).length + (idx.byPath.get('') || []).length;
    const tags = Object.keys(TAGS);
    return `
      <div class="side-top">
        <button class="btn btn-primary btn-block" data-act="new-menu">${icon('plus', 18)}New</button>
      </div>
      <div class="side-scroll">
        ${item('root', 'drive', 'My Drive', rootCount)}
        ${item('recent', 'clock', 'Recent', null)}
        ${item('starred', 'star', 'Starred', idx.starred.length)}
        <div class="nav-title">Folders</div>
        ${buildFolderTree(idx, '', 0) || '<div class="nav-empty">No folders yet</div>'}
        <div class="nav-title">Tags</div>
        ${tags.map((t) => `
          <div class="nav-item ${state.nav === `tag:${t}` ? 'active' : ''}" data-nav="tag:${esc(t)}">
            <span class="tag-dot" style="--tag:${TAGS[t].color}"></span>
            <span class="nav-label">${esc(TAGS[t].name)}</span>
            <span class="nav-count">${idx.tagCounts[t] || 0}</span>
          </div>`).join('')}
        <div class="nav-sep"></div>
        ${item('trash', 'trash', 'Trash', idx.trash.length)}
      </div>
      <div class="storage">
        <div class="storage-k">Stored on Discord</div>
        <div class="storage-v">${fmtSize(idx.totalBytes) || '0 KB'}</div>
        <div class="storage-sub">${plural(idx.live.length, 'file')} · ${plural(idx.folderSet.size, 'folder')}</div>
      </div>`;
  }

  function buildDetailBody(r, opts = {}) {
    const f = r.file;
    let art;
    if (THUMBABLE.has(r.cat) && (r.size || 0) > THUMB_MAX_BYTES) {
      art = `${tile(r, 'xl')}<span class="art-note">Click to preview</span>`;
    } else if (THUMBABLE.has(r.cat)) {
      const t = state.detailThumb;
      if (t && t.fileId === f.id && t.blobUrl) art = `<img src="${t.blobUrl}" alt="${esc(r.name)}">`;
      else if (t && t.fileId === f.id && t.error) art = `${tile(r, 'xl')}<span class="art-note">${esc(t.error)}</span>`;
      else art = `${tile(r, 'xl')}<span class="art-note">Loading preview…</span>`;
    } else art = tile(r, 'xl');
    const previewable = PREVIEWABLE.has(r.cat);
    const addable = Object.keys(TAGS).filter((t) => !r.tags.includes(t));
    const inTrash = r.trashed;
    return `
      <div class="detail-art ${previewable ? 'clickable' : ''}" ${previewable ? 'data-act="preview" title="Preview (p)"' : ''}>${art}</div>
      <div class="detail-name">${esc(r.name)}</div>
      <div class="detail-kind">${esc(CATEGORY[r.cat].label)} · ${esc(fmtSize(r.size))}</div>
      ${opts.compact ? '' : `
      <div class="detail-actions">
        ${previewable ? `<button class="btn btn-primary" data-act="preview">${icon('eye', 18)}Preview</button>` : ''}
        <button class="btn" data-act="download">${icon('download', 18)}Download</button>
      </div>`}
      <dl class="props">
        <dt>Added</dt><dd>${esc(fmtDate(r.created))}</dd>
        <dt>Location</dt><dd>${r.path ? `<button class="link" data-nav="${esc(r.path)}">${esc(r.path)}</button>` : '<button class="link" data-nav="root">My Drive</button>'}</dd>
        <dt>Chunks</dt><dd>${r.chunks ? r.chunks.length : 0}</dd>
      </dl>
      <div class="detail-section">
        <div class="detail-label">Tags</div>
        <div class="tag-edit">
          ${tagChips(r.tags, !inTrash)}
          ${inTrash ? '' : addable.map((t) => `<button class="tag-add" data-act="add-tag" data-tag="${esc(t)}" style="--tag:${TAGS[t].color}">+ ${esc(TAGS[t].name)}</button>`).join('')}
          ${inTrash ? '' : `<button class="tag-add new" data-act="new-tag">${icon('plus', 12)} New tag</button>`}
        </div>
      </div>
      ${opts.compact ? '' : `
      <div class="action-list">
        ${inTrash
          ? `<button data-act="restore">${icon('restore', 18)}Restore</button>`
          : `<button data-act="copy-link">${icon('link', 18)}Copy link</button>
             <button data-act="star">${icon(r.starred ? 'starFill' : 'star', 18)}${r.starred ? 'Unstar' : 'Star'}</button>
             <button data-act="rename">${icon('pencil', 18)}Rename</button>
             <button data-act="move">${icon('move', 18)}Move to…</button>
             <button class="danger" data-act="trash">${icon('trash', 18)}Move to Trash</button>`}
      </div>`}`;
  }

  function buildDetail(view, focus) {
    const head = `<div class="detail-head"><span class="detail-title">Details</span><button class="icon-btn small" data-act="toggle-detail" title="Hide panel (i)">${icon('close')}</button></div>`;
    const n = state.selected.size;
    if (n > 1) {
      const rows = selectedRows();
      const files = rows.filter((r) => !r.isFolder);
      const bytes = files.reduce((a, r) => a + (r.size || 0), 0);
      const cats = {};
      files.forEach((r) => { cats[r.cat] = (cats[r.cat] || 0) + 1; });
      return `${head}
        <div class="detail-scroll">
          <div class="detail-art multi">${rows.slice(0, 3).map((r) => tile(r, 'lg')).join('')}</div>
          <div class="detail-name">${plural(n, 'item')} selected</div>
          <div class="detail-kind">${fmtSize(bytes)}${rows.length !== files.length ? ` · ${plural(rows.length - files.length, 'folder')}` : ''}</div>
          <dl class="props">${Object.keys(cats).map((c) => `<dt>${esc(CATEGORY[c].label)}</dt><dd>${cats[c]}</dd>`).join('')}</dl>
          <div class="hint">Use the bar above the list to act on all of them.</div>
        </div>`;
    }
    if (!focus) {
      const idx = view.idx;
      return `${head}
        <div class="detail-scroll detail-none">
          <div class="detail-art">${tile({ cat: 'folder' }, 'xl')}</div>
          <div class="detail-name">${esc(navLabel(state.nav))}</div>
          <div class="detail-kind">${plural(view.rows.length, 'item')}</div>
          <dl class="props">
            <dt>Drive total</dt><dd>${fmtSize(idx.totalBytes) || '0 KB'}</dd>
            <dt>Files</dt><dd>${idx.live.length}</dd>
            <dt>In Trash</dt><dd>${idx.trash.length}</dd>
          </dl>
          <div class="hint">Select a file to see its details. Double-click to open.</div>
        </div>`;
    }
    if (focus.isFolder) {
      return `${head}
        <div class="detail-scroll">
          <div class="detail-art">${tile(focus, 'xl')}</div>
          <div class="detail-name">${esc(focus.name)}</div>
          <div class="detail-kind">${focus.isTag ? 'Tag' : 'Folder'} · ${plural(focus.fileCount, 'file')}${focus.size ? ` · ${fmtSize(focus.size)}` : ''}</div>
          <div class="detail-actions"><button class="btn btn-primary" data-act="open">${icon('folder', 18)}Open</button></div>
          ${focus.isTag ? '' : `
          <dl class="props"><dt>Path</dt><dd>${esc(focus.path)}</dd></dl>
          <div class="action-list">
            <button data-act="rename">${icon('pencil', 18)}Rename</button>
            <button data-act="new-subfolder">${icon('folderPlus', 18)}New folder inside</button>
            <button class="danger" data-act="delete-folder">${icon('trash', 18)}Delete folder…</button>
          </div>`}
        </div>`;
    }
    return `${head}<div class="detail-scroll">${buildDetailBody(focus)}</div>`;
  }

  // ---- mobile regions ---------------------------------------------------------------------
  function buildMobileBar() {
    const cs = crumbs();
    const title = cs[cs.length - 1].label;
    const canGoUp = !['root', 'starred', 'recent', 'trash', 'tags'].includes(state.nav);
    const c = connMeta();
    return `
      ${canGoUp
        ? `<button class="icon-btn" data-act="go-up" aria-label="Back">${icon('back', 22)}</button>`
        : `<img class="brand-mark" src="logo.png" alt="" draggable="false">`}
      <div class="m-title-wrap">
        <h1 class="view-title">${esc(title)}</h1>
        <button class="m-conn ${c.cls}" data-act="settings"><i></i>${esc(c.label)}</button>
      </div>
      <button class="icon-btn" data-act="m-search" aria-label="Search">${icon('search', 22)}</button>
      <button class="icon-btn" data-act="m-select" aria-label="Select">${icon('selectAll', 22)}</button>
      <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('settings', 22)}</button>`;
  }

  function buildMobileNav() {
    const idx = getIndex();
    const navs = [
      { id: 'root', ic: 'drive', label: 'Drive', on: !isVirtualNav(state.nav) || state.nav === 'root' },
      { id: 'recent', ic: 'clock', label: 'Recent' },
      { id: 'starred', ic: 'star', label: 'Starred' },
      { id: 'tags', ic: 'tag', label: 'Tags', on: state.nav === 'tags' || state.nav.startsWith('tag:') },
      { id: 'trash', ic: 'trash', label: 'Trash', badge: idx.trash.length },
    ];
    return navs.map((n) => {
      const on = n.on != null ? n.on : state.nav === n.id;
      return `<button class="m-nav-item ${on ? 'on' : ''}" data-nav="${n.id}">${icon(n.ic, 22)}<span>${n.label}</span>${n.badge ? `<b>${n.badge > 99 ? '99+' : n.badge}</b>` : ''}</button>`;
    }).join('');
  }

  function buildMobileSheet() {
    const r = rowFor(state.sheet);
    if (!r) return '';
    let body;
    if (r.isFolder) {
      body = `
        <div class="sheet-head">${tile(r, 'lg')}<div><div class="detail-name">${esc(r.name)}</div><div class="detail-kind">${plural(r.fileCount, 'file')}</div></div></div>
        <div class="action-list">
          <button data-act="open">${icon('folder', 20)}Open</button>
          ${r.isTag ? '' : `<button data-act="rename">${icon('pencil', 20)}Rename</button>
          <button class="danger" data-act="delete-folder">${icon('trash', 20)}Delete folder…</button>`}
        </div>`;
    } else {
      body = `${buildDetailBody(r)}`;
    }
    return `
      <div class="sheet-wrap">
        <div class="scrim" data-act="close-sheet"></div>
        <div class="sheet"><div class="sheet-grip"></div><div class="sheet-scroll">${body}</div></div>
      </div>`;
  }

  // ---- overlays -------------------------------------------------------------------------
  // One slot per overlay, in stacking order, each patched on its own.
  const OVERLAY_SLOTS = {
    settings: () => (state.settingsOpen ? buildSettingsPanel() : ''),
    move: () => (state.movePicker ? buildMovePicker() : ''),
    confirm: () => (state.confirmModal ? buildConfirmModal() : ''),
    prompt: () => (state.promptModal ? buildPromptModal() : ''),
    shortcuts: () => (state.shortcutsOpen ? buildShortcuts() : ''),
    update: () => (state.updatePrompt ? buildUpdateModal() : ''),
    menu: () => (state.menu ? buildMenu() : ''),
    drop: () => (state.dropActive ? `<div class="drop-overlay"><div class="drop-card">${icon('upload', 36)}<div>Drop to upload to <b>${esc(currentFolder() || 'My Drive')}</b></div></div></div>` : ''),
  };
  const OVERLAY_HTML = Object.keys(OVERLAY_SLOTS).map((k) => `<div data-slot="${k}"></div>`).join('');
  function renderOverlays() {
    for (const [key, build] of Object.entries(OVERLAY_SLOTS)) patch(R.overlay.querySelector(`[data-slot="${key}"]`), build());
  }

  function buildMenu() {
    const m = state.menu;
    const items = m.items.map((it, i) => (it.sep
      ? '<div class="menu-sep"></div>'
      : `<button class="menu-item ${it.danger ? 'danger' : ''} ${it.on ? 'on' : ''}" data-menu="${i}" ${it.disabled ? 'disabled' : ''}>
          ${it.icon ? icon(it.icon, 18) : '<span class="ico-pad"></span>'}<span>${esc(it.label)}</span>${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}${it.on ? icon('check', 16) : ''}
        </button>`)).join('');
    if (layout === 'mobile') {
      return `
        <div class="sheet-wrap">
          <div class="scrim" data-act="close-menu"></div>
          <div class="sheet menu-sheet"><div class="sheet-grip"></div>${m.title ? `<div class="sheet-title">${esc(m.title)}</div>` : ''}<div class="sheet-scroll">${items}</div></div>
        </div>`;
    }
    return `<div class="menu" id="ctx-menu" style="left:${m.x}px;top:${m.y}px">${m.title ? `<div class="menu-title">${esc(m.title)}</div>` : ''}${items}</div>`;
  }
  // Keeps a popover inside the window once its real size is known.
  function positionMenu() {
    const el = document.getElementById('ctx-menu');
    if (!el || !state.menu) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = state.menu.x, y = state.menu.y;
    if (x + rect.width > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height > window.innerHeight - pad) y = Math.max(pad, (state.menu.flipY != null ? state.menu.flipY : window.innerHeight) - rect.height - pad);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function modal(id, inner, cls = '') {
    return `<div class="modal ${cls}" id="${id}"><div class="scrim" data-act="close-top"></div><div class="modal-card">${inner}</div></div>`;
  }

  function buildSettingsPanel() {
    const s = state.settings;
    const seg = (cur, opts, act) => `<div class="segmented">${opts.map((o) => `<button class="${cur === o ? 'on' : ''}" data-act="${act}" data-val="${o}">${o}</button>`).join('')}</div>`;
    return `
      <div class="settings-wrap" id="settings-panel">
        <div class="scrim" data-act="settings"></div>
        <section class="settings">
          <div class="settings-head">
            <h2 class="settings-title">Settings</h2>
            <button class="icon-btn" data-act="settings" id="settings-esc" title="Close (Esc)">${icon('close')}</button>
          </div>
          <div class="settings-scroll">
            <div class="settings-section">
              <h3>Connection</h3>
              <div class="field">
                <label for="token-input">Bot token</label>
                <input type="password" class="input mono" id="token-input" data-bind="botTokenInput" placeholder="${s.hasToken ? 'Saved — leave blank to keep it' : 'Paste your bot token'}" value="${esc(state.botTokenInput)}" autocomplete="off">
              </div>
              <div class="field">
                <label for="channel-input">Channel ID</label>
                <input class="input mono" id="channel-input" data-bind="channelIdInput" value="${esc(state.channelIdInput)}" placeholder="Numeric channel ID" inputmode="numeric">
              </div>
              <div class="settings-row">
                <button class="btn" data-act="test-connection" ${state.testResult && state.testResult.testing ? 'disabled' : ''}>${state.testResult && state.testResult.testing ? 'Testing…' : 'Test connection'}</button>
                <button class="btn btn-primary" data-act="save-settings">Save &amp; connect</button>
              </div>
              ${state.testResult && !state.testResult.testing ? `<div class="notice ${state.testResult.ok ? 'ok' : 'err'}">${icon(state.testResult.ok ? 'check' : 'warn', 18)}<span>${esc(state.testResult.message || '')}</span></div>` : ''}
            </div>

            <div class="settings-section">
              <h3>Transfers</h3>
              <div class="field">
                <label>Chunk size <span class="unit">MB</span></label>
                <div class="stepper">
                  <button class="icon-btn" data-act="step-chunk" data-delta="-1">−</button>
                  <input class="input" id="chunk-input" data-bind="chunkSizeInput" type="number" min="1" max="100" value="${esc(String(state.chunkSizeInput))}">
                  <button class="icon-btn" data-act="step-chunk" data-delta="1">+</button>
                </div>
              </div>
              <div class="field">
                <label>Parallel chunk uploads</label>
                <div class="stepper">
                  <button class="icon-btn" data-act="step-conc" data-delta="-1">−</button>
                  <input class="input" id="conc-input" data-bind="concurrencyInput" type="number" min="1" max="8" value="${esc(String(state.concurrencyInput))}">
                  <button class="icon-btn" data-act="step-conc" data-delta="1">+</button>
                </div>
                <div class="hint">Several chunks at once instead of one after another. Past 4, Discord's rate limit usually caps you anyway. <button class="link" data-act="upload-docs">What does this do? ↗</button></div>
              </div>
              <div class="hint">Saved together with the connection.</div>
            </div>

            <div class="settings-section">
              <h3>Appearance</h3>
              <div class="field">
                <label>Interface style</label>
                <div class="style-picker">
                  ${UI_STYLES.map((u) => `
                    <button class="style-opt ${state.uiStyle === u.id ? 'on' : ''}" data-act="set-ui" data-val="${u.id}">
                      <span class="style-thumb st-${u.id}"><i></i><i></i><i></i></span>
                      <span class="style-name">${u.name}</span>
                      <span class="style-sub">${u.sub}</span>
                    </button>`).join('')}
                </div>
              </div>
              <div class="field"><label>Theme</label>${seg(state.theme, ['light', 'dark', 'system'], 'set-theme')}</div>
              <div class="field">
                <label>Accent</label>
                <div class="swatches">
                  ${ACCENTS.map((a) => `<button class="swatch ${state.accent === a.id ? 'on' : ''} ${a.value ? '' : 'auto'}" data-act="set-accent" data-val="${a.id}" title="${esc(a.name)}" style="--sw:${a.value || styleDefaultAccent()}"></button>`).join('')}
                </div>
              </div>
              <div class="field"><label>Density</label>${seg(state.density, ['comfortable', 'compact'], 'set-density')}</div>
            </div>

            <div class="settings-section">
              <h3>About</h3>
              <div class="settings-row">
                <span class="about-v">BeanyDrive ${esc(state.appVersion ? `v${state.appVersion}` : '')}</span>
                <span class="grow"></span>
                <button class="btn" data-act="check-updates">Check for updates</button>
              </div>
            </div>
          </div>
        </section>
      </div>`;
  }

  function buildMovePicker() {
    const mp = state.movePicker;
    const idx = getIndex();
    const all = [...idx.folderSet].sort((a, b) => collator.compare(a, b));
    const opt = (p, label, depth) => `
      <button class="pick-row ${mp.target === p ? 'on' : ''}" data-act="pick-folder" data-path="${esc(p)}" style="--depth:${depth}">
        ${icon(p ? 'folder' : 'drive', 18)}<span>${esc(label)}</span>${mp.target === p ? icon('check', 16) : ''}
      </button>`;
    return modal('move-overlay', `
      <div class="modal-head"><h2>Move ${plural(mp.keys.length, 'item')}</h2><button class="icon-btn" data-act="close-top">${icon('close')}</button></div>
      <div class="pick-list">
        ${opt('', 'My Drive', 0)}
        ${all.map((p) => opt(p, basenameOf(p), p.split('/').length)).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-quiet" data-act="pick-new-folder">${icon('folderPlus', 18)}New folder</button>
        <span class="grow"></span>
        <button class="btn" data-act="close-top">Cancel</button>
        <button class="btn btn-primary" data-act="move-confirm">Move here</button>
      </div>`, 'move-modal');
  }

  function buildConfirmModal() {
    const c = state.confirmModal;
    return modal('confirm-overlay', `
      <div class="modal-head"><h2>${esc(c.title)}</h2></div>
      <div class="confirm-body">${icon(c.danger ? 'warn' : 'info', 22)}<p>${esc(c.message)}</p></div>
      ${c.checkbox ? `<label class="check-row" data-act="confirm-check"><span class="box ${c.checked ? 'on' : ''}">${c.checked ? icon('check', 14) : ''}</span>${esc(c.checkbox)}</label>` : ''}
      <div class="modal-actions">
        <span class="grow"></span>
        <button class="btn" data-act="close-top">Cancel</button>
        <button class="btn ${c.danger ? 'btn-danger' : 'btn-primary'}" data-act="confirm-ok">${esc(c.confirmLabel || 'OK')}</button>
      </div>`, 'confirm-modal');
  }

  function buildPromptModal() {
    const cfg = state.promptModal;
    return modal('prompt-overlay', `
      <div class="modal-head"><h2>${esc(cfg.title)}</h2></div>
      <input class="input" id="prompt-input" value="${esc(cfg.value || '')}" spellcheck="false" autocomplete="off" enterkeyhint="done">
      <div class="modal-actions">
        <span class="grow"></span>
        <button class="btn" data-act="close-top">Cancel</button>
        <button class="btn btn-primary" data-act="prompt-submit">${esc(cfg.submitLabel || 'OK')}</button>
      </div>`, 'prompt-modal');
  }

  // GitHub release notes are Markdown; only headings, bullets and bold are
  // worth rendering here, everything else stays plain (and escaped) text.
  function renderNotes(md) {
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    let html = '', inList = false;
    for (const raw of String(md || '').split(/\r?\n/)) {
      const line = raw.trim();
      const bullet = /^[-*]\s+(.*)/.exec(line);
      if (bullet) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(bullet[1])}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      const head = /^#{1,6}\s+(.*)/.exec(line);
      if (head) html += `<h4>${inline(head[1])}</h4>`;
      else if (line) html += `<p>${inline(line)}</p>`;
    }
    return inList ? `${html}</ul>` : html;
  }

  function buildUpdateModal() {
    const u = state.updatePrompt;
    const dl = state.updateDl || { phase: 'idle' };
    const busyUploads = state.uploads.some((x) => x.state === 'running' || x.state === 'queued');
    const pct = dl.total ? Math.round((dl.received / dl.total) * 100) : 0;
    let primary;
    if (!u.canInstall) primary = `<button class="btn btn-primary" data-act="update-open">${icon('download', 18)}${api.isMobile ? 'Download APK' : 'Open release page'}</button>`;
    else if (dl.phase === 'ready') primary = `<button class="btn btn-primary" data-act="update-install">${icon('refresh', 18)}${u.platform === 'darwin' ? 'Quit &amp; open installer' : 'Restart &amp; install'}</button>`;
    else primary = `<button class="btn btn-primary" data-act="update-download" ${dl.phase === 'downloading' ? 'disabled' : ''}>${icon('download', 18)}${dl.phase === 'downloading' ? 'Downloading…' : (u.portable ? 'Download new version' : 'Download &amp; install')}</button>`;
    return modal('update-overlay', `
      <div class="update-head">
        <img class="brand-mark big" src="logo.png" alt="" draggable="false">
        <div><h2>BeanyDrive ${esc(u.version)}</h2><p>You have ${esc(u.current || state.appVersion)}${u.size ? ` · ${fmtSize(u.size)}` : ''}</p></div>
      </div>
      ${u.notes ? `<div class="update-notes">${renderNotes(u.notes)}</div>` : ''}
      ${dl.phase === 'downloading' || dl.phase === 'ready' ? `
        <div class="update-progress">
          <div class="bar"><span style="width:${dl.phase === 'ready' ? 100 : pct}%"></span></div>
          <div class="hint">${dl.phase === 'ready' ? `Downloaded${dl.verified ? ' and verified' : ''} — ${u.platform === 'darwin' ? 'BeanyDrive quits and opens the disk image; drag BeanyDrive onto Applications to replace this version.' : 'BeanyDrive closes while the installer runs.'}` : `${fmtSize(dl.received)} of ${fmtSize(dl.total)} · ${pct}%`}</div>
        </div>` : ''}
      ${dl.phase === 'error' ? `<div class="notice err">${icon('warn', 18)}<span>${esc(dl.error)}</span></div>` : ''}
      ${busyUploads && u.canInstall ? `<div class="notice warn">${icon('info', 18)}<span>Uploads are running. Installing stops them; start them again afterwards and they resume where they left off.</span></div>` : ''}
      <div class="modal-actions">
        <button class="btn btn-quiet" data-act="update-open">Release page ↗</button>
        <span class="grow"></span>
        <button class="btn" data-act="close-top">Later</button>
        ${primary}
      </div>`, 'update-modal');
  }

  function downloadUpdate() {
    state.updateDl = { phase: 'downloading', received: 0, total: state.updatePrompt.size || 0 };
    render();
    api.downloadUpdate().then((res) => {
      state.updateDl = res.ok
        ? { phase: 'ready', verified: res.verified }
        : { phase: 'error', error: res.error || 'Download failed' };
      render();
    });
  }
  if (api.onUpdateProgress) {
    api.onUpdateProgress(({ received, total }) => {
      if (!state.updateDl || state.updateDl.phase !== 'downloading') return;
      state.updateDl.received = received;
      state.updateDl.total = total;
      render();
    });
  }

  const SHORTCUTS = [
    ['Navigate', [['↑ ↓ / j k', 'Move focus'], ['Shift + ↑ ↓', 'Extend selection'], ['Enter', 'Open'], ['Backspace', 'Up one folder'], ['/', 'Search']]],
    ['Select', [['Click', 'Select one'], ['Ctrl + click', 'Add / remove'], ['Shift + click', 'Select range'], ['Ctrl + A', 'Select all'], ['Esc', 'Clear']]],
    ['Act', [['u', 'Upload'], ['n', 'New folder'], ['p', 'Preview'], ['Space', 'Star'], ['F2 / r', 'Rename'], ['m', 'Move'], ['Delete / d', 'Move to Trash'], ['x', 'Restore (Trash)']]],
    ['App', [[',', 'Settings'], ['i', 'Details panel'], ['g', 'Grid / list'], ['F5', 'Refresh'], ['?', 'This list']]],
  ];
  function buildShortcuts() {
    return modal('shortcuts-overlay', `
      <div class="modal-head"><h2>Keyboard shortcuts</h2><button class="icon-btn" data-act="close-top">${icon('close')}</button></div>
      <div class="shortcut-grid">
        ${SHORTCUTS.map(([title, rows]) => `<div><h3>${title}</h3>${rows.map(([k, d]) => `<div class="shortcut-row"><span>${d}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>`).join('')}
      </div>`, 'wide');
  }

  // ---- actions ---------------------------------------------------------------------------
  function closeTransient() { state.menu = null; }

  function selectNav(id) {
    state.nav = id;
    state.searchQuery = '';
    state.selected.clear();
    state.focusKey = null;
    state.anchorKey = null;
    state.sheet = null;
    state.menu = null;
    if (layout === 'mobile') state.selectMode = false;
    if (!isVirtualNav(id)) {
      for (let p = parentOf(id); p; p = parentOf(p)) state.expanded.add(p);
      saveExpanded();
    }
    if (R.body) R.body.scrollTop = 0;
    render();
  }
  function goUp() {
    if (state.nav.startsWith('tag:')) { selectNav(layout === 'mobile' ? 'tags' : 'root'); return true; }
    if (isVirtualNav(state.nav)) { if (state.nav !== 'root') { selectNav('root'); return true; } return false; }
    const prev = state.nav;
    selectNav(parentOf(prev) || 'root');
    state.focusKey = `folder:${prev}`;
    state.selected.add(state.focusKey);
    state.scrollToFocus = true;
    return true;
  }
  function saveExpanded() { ls.set('beanydrive_expanded', JSON.stringify([...state.expanded])); }

  function setSelection(keys, focusKey) {
    state.selected = new Set(keys);
    state.focusKey = focusKey != null ? focusKey : (keys[keys.length - 1] || null);
    state.anchorKey = state.focusKey;
  }
  function clearSelection() {
    state.selected.clear();
    state.anchorKey = null;
    state.selectMode = false;
    render();
  }

  function onRowClick(key, e) {
    const { keys } = getRows();
    const toggle = e.ctrlKey || e.metaKey || state.selectMode || (layout === 'mobile' && state.selected.size > 0);
    if (layout === 'mobile' && !toggle) {
      const r = rowFor(key);
      if (!r) return;
      if (r.isFolder) selectNav(r.targetNav);
      else { state.focusKey = key; state.sheet = key; render(); }
      return;
    }
    if (e.shiftKey && state.anchorKey && keys.includes(state.anchorKey)) {
      const a = keys.indexOf(state.anchorKey), b = keys.indexOf(key);
      const range = keys.slice(Math.min(a, b), Math.max(a, b) + 1);
      state.selected = new Set(e.ctrlKey || e.metaKey ? [...state.selected, ...range] : range);
      state.focusKey = key;
    } else if (toggle) {
      if (state.selected.has(key)) state.selected.delete(key); else state.selected.add(key);
      state.focusKey = key;
      state.anchorKey = key;
      if (layout === 'mobile' && !state.selected.size) state.selectMode = false;
    } else {
      setSelection([key], key);
    }
    render();
  }

  function openRow(key) {
    const r = rowFor(key);
    if (!r) return;
    if (r.isFolder) { selectNav(r.targetNav); return; }
    if (PREVIEWABLE.has(r.cat)) openPreview(r.file);
    else downloadFiles([r]);
  }

  // Keyboard focus movement; shift extends from the anchor like a click would.
  function moveFocus(delta, extend) {
    const { keys } = getRows();
    if (!keys.length) return;
    let i = keys.indexOf(state.focusKey);
    i = i === -1 ? (delta > 0 ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, i + delta));
    const key = keys[i];
    if (extend && state.anchorKey) {
      const a = keys.indexOf(state.anchorKey);
      state.selected = new Set(keys.slice(Math.min(a, i), Math.max(a, i) + 1));
      state.focusKey = key;
    } else setSelection([key], key);
    state.scrollToFocus = true;
    render();
  }

  // What the bulk actions act on: the selection, or the focused row when the
  // selection is empty (the detail panel's buttons, a row's own menu).
  function targetRows() {
    const rows = selectedRows();
    if (rows.length) return rows;
    const f = rowFor(state.sheet || state.focusKey);
    return f ? [f] : [];
  }
  function targetFiles() { return targetRows().filter((r) => !r.isFolder); }
  function ids(rows) { return rows.map((r) => r.id); }

  function starTargets() {
    const files = targetFiles().filter((r) => !r.trashed);
    if (!files.length) return;
    const value = !files.every((r) => r.starred);
    patchLocal(ids(files), (f) => { f.starred = value; return f; });
    if (api.updateFiles) apiCall(api.updateFiles(ids(files), { starred: value }));
    else files.forEach((r) => apiCall(api.star(r.id, value)));
  }
  function setTrashed(files, value) {
    patchLocal(ids(files), (f) => { f.trashed = value; if (value) f.starred = false; return f; });
    if (api.updateFiles) return apiCall(api.updateFiles(ids(files), { trashed: value }));
    return Promise.all(files.map((r) => apiCall(value ? api.trash(r.id) : api.restore(r.id))));
  }
  function trashTargets() {
    const files = targetFiles();
    if (!files.length) return;
    state.sheet = null;
    if (files[0].trashed) { restoreTargets(); return; }
    setTrashed(files, true);
    const restoreList = files.map((r) => ({ ...r }));
    showToast(files.length === 1 ? `Moved “${files[0].name}” to Trash` : `Moved ${files.length} files to Trash`, {
      action: { label: 'Undo', fn: () => setTrashed(restoreList, false) },
    });
  }
  function restoreTargets() {
    const files = targetFiles().filter((r) => r.trashed);
    if (!files.length) return;
    state.sheet = null;
    setTrashed(files, false);
    showToast(files.length === 1 ? `Restored “${files[0].name}”` : `Restored ${files.length} files`, { kind: 'ok' });
  }
  async function downloadFiles(files) {
    for (const r of files) {
      // eslint-disable-next-line no-await-in-loop
      const res = await apiCall(api.download(r.id, r.name));
      if (!res) return;
      if (res.ok) { if (res.path) showToast(`Saved to ${res.path}`, { kind: 'ok' }); } else if (res.canceled) return;
      else showToast(`Download failed: ${res.error || ''}`, { kind: 'err' });
    }
  }
  function copyLink() {
    const f = targetFiles()[0];
    if (!f) return;
    apiCall(api.copyLink(f.id), (r) => {
      showToast(r && r.multiChunk ? 'Copied first-chunk link (large file — partial, may expire)' : 'Discord CDN link copied — may expire', { kind: 'ok' });
    });
  }

  function addTag(tag) {
    const f = targetFiles()[0];
    if (!f) return;
    patchLocal([f.id], (x) => { x.tags = [...(x.tags || []), tag]; return x; });
    apiCall(api.addTag(f.id, tag));
  }
  function removeTag(tag) {
    const f = targetFiles()[0];
    if (!f) return;
    patchLocal([f.id], (x) => { x.tags = (x.tags || []).filter((t) => t !== tag); return x; });
    apiCall(api.removeTag(f.id, tag));
  }
  function newTag() {
    const f = targetFiles()[0];
    openPrompt({
      title: 'New tag', value: '', submitLabel: 'Create',
      onSubmit: (val) => {
        const id = createCustomTag(val);
        if (id && f) { state.focusKey = f.key; addTag(id); } else render();
      },
    });
  }

  function openPrompt(cfg) {
    state.promptModal = cfg;
    state.menu = null;
    renderSync();
    const el = document.getElementById('prompt-input');
    if (el) {
      el.focus();
      // Select the name without its extension, the way file managers do.
      const dot = cfg.selectStem ? el.value.lastIndexOf('.') : -1;
      if (dot > 0) el.setSelectionRange(0, dot); else el.select();
    }
  }
  function closePrompt() { state.promptModal = null; render(); }
  function submitPrompt() {
    const el = document.getElementById('prompt-input');
    const val = el ? el.value.trim() : '';
    const cfg = state.promptModal;
    state.promptModal = null;
    render();
    if (cfg && cfg.onSubmit && val) cfg.onSubmit(val);
  }
  function openConfirm(cfg) { state.confirmModal = { ...cfg, checked: false }; state.menu = null; render(); }

  function renameTarget() {
    const r = targetRows()[0];
    if (!r || r.isTag || r.trashed) return;
    state.sheet = null;
    if (r.isFolder) {
      openPrompt({
        title: 'Rename folder', value: r.name, submitLabel: 'Rename',
        onSubmit: (val) => {
          const clean = val.replace(/[\\/]/g, '-').trim();
          if (!clean || clean === r.name) return;
          const next = joinPath(parentOf(r.path), clean);
          if (!api.renameFolder) { showToast('Folder rename needs the updated app', { kind: 'err' }); return; }
          apiCall(api.renameFolder(r.path, next), () => {
            if (state.expanded.delete(r.path)) { state.expanded.add(next); saveExpanded(); }
            const key = `folder:${next}`;
            setSelection([key], key);
            render();
          });
        },
      });
      return;
    }
    openPrompt({
      title: 'Rename file', value: r.name, submitLabel: 'Rename', selectStem: true,
      onSubmit: (val) => {
        if (val === r.name) return;
        patchLocal([r.id], (f) => { f.name = val; return f; });
        apiCall(api.rename(r.id, val));
      },
    });
  }
  function newFolder(parent = currentFolder()) {
    openPrompt({
      title: parent ? `New folder in ${basenameOf(parent)}` : 'New folder', value: '', submitLabel: 'Create',
      onSubmit: (val) => {
        const clean = val.replace(/[\\/]/g, '-').trim();
        if (!clean) return;
        const target = joinPath(parent, clean);
        apiCall(api.createFolder(target), () => {
          if (state.movePicker) { state.movePicker.target = target; render(); return; }
          selectNav(target);
        });
      },
    });
  }
  function deleteFolderTarget() {
    const r = targetRows()[0];
    if (!r || !r.isFolder || r.isTag) return;
    state.sheet = null;
    openConfirm({
      title: `Delete “${r.name}”?`,
      message: `This permanently deletes the folder and ${plural(r.fileCount, 'file')} inside it from the Discord channel. It does not go to Trash and cannot be undone.`,
      confirmLabel: 'Delete permanently', danger: true,
      onConfirm: () => apiCall(api.deleteFolder(r.path), () => {
        showToast(`Deleted ${r.name}`, { kind: 'ok' });
        if (state.nav === r.path || state.nav.startsWith(`${r.path}/`)) selectNav(parentOf(r.path) || 'root');
      }),
    });
  }

  function openMovePicker() {
    const files = targetFiles().filter((r) => !r.trashed);
    if (!files.length) { showToast('Select files to move — folders move by renaming them'); return; }
    state.sheet = null;
    state.menu = null;
    state.movePicker = { keys: files.map((r) => r.key), target: currentFolder() };
    render();
  }
  function confirmMove() {
    const mp = state.movePicker;
    if (!mp) return;
    const { meta } = getRows();
    const files = mp.keys.map((k) => meta.get(k)).filter(Boolean);
    state.movePicker = null;
    if (!files.length) { render(); return; }
    const dest = mp.target;
    const fallback = () => showToast('Moving needs the updated app', { kind: 'err' });
    if (!api.moveFiles) { fallback(); render(); return; }
    patchLocal(ids(files), (f) => { f.path = dest; return f; });
    apiCall(api.moveFiles(ids(files), dest), () => {
      showToast(`Moved ${plural(files.length, 'file')} to ${dest || 'My Drive'}`, {
        kind: 'ok', action: { label: 'Open', fn: () => selectNav(dest || 'root') },
      });
    });
  }

  function triggerUpload() {
    state.menu = null;
    if (state.connection.status !== 'connected') { showToast('Not connected — open Settings first', { kind: 'err' }); return; }
    document.getElementById('file-input').click();
  }
  // Desktop only: main walks the folder and recreates it under the current one.
  function triggerFolderUpload() {
    state.menu = null;
    if (state.connection.status !== 'connected') { showToast('Not connected — open Settings first', { kind: 'err' }); return; }
    api.pickFolder().then((dir) => { if (dir) startUpload([dir]); });
  }
  function startUpload(paths) {
    if (state.connection.status !== 'connected') { showToast('Not connected — open Settings first', { kind: 'err' }); return; }
    state.transfersOpen = true;
    apiCall(api.upload(paths, currentFolder()), (res) => {
      if (res && !res.ok) showToast(res.error || 'Upload failed', { kind: 'err' });
    });
  }
  // Upload rows are owned by the main process, so these just fire the request —
  // the row updates when the resulting snapshot arrives. Cancel takes a moment
  // on a running upload: the in-flight chunk POSTs have to unwind and their
  // partial chunks be deleted first.
  function uploadAction(fn, uploadId) {
    apiCall(fn(uploadId), (res) => { if (res && !res.ok && res.error) showToast(res.error, { kind: 'err' }); });
  }

  // Dragging a file to the desktop needs a real file on disk, and these live on
  // Discord — so the first drag can't be the one that lands. It kicks off the
  // download instead (progress shows as a task row) and the next drag works.
  function startRowDrag(ev, r) {
    ev.preventDefault(); // Electron's startDrag replaces the HTML5 drag
    if (state.dragReady.has(r.id)) { api.startDrag(r.id); return; }
    if (state.dragPreparing.has(r.id)) { showToast(`Still preparing ${r.name}…`); return; }
    apiCall(api.prepareDrag(r.id), (res) => {
      if (!res.ok) showToast(res.error || 'Could not prepare that file', { kind: 'err' });
      else if (res.ready) showToast(`${r.name} is ready — drag it again`, { kind: 'ok' });
      else showToast(`Fetching ${r.name} — drag it again when it's ready`);
    });
  }

  function emptyingTrash() { return state.tasks.some((t) => t.label === 'Emptying Trash'); }
  function requestEmptyTrash() {
    if (emptyingTrash()) { showToast('Already emptying the Trash'); return; }
    const n = getIndex().trash.length;
    if (!n) return;
    if (state.dontAskAgainTrash) { apiCall(api.emptyTrash()); return; }
    openConfirm({
      title: 'Empty Trash?',
      message: `This permanently deletes ${plural(n, 'file')} from the Discord channel. This cannot be undone.`,
      confirmLabel: 'Empty Trash', danger: true, checkbox: "Don't ask again",
      // The toast comes from the task's done event — this can run for minutes,
      // and the transfers card is what reports it in the meantime.
      onConfirm: (checked) => {
        if (checked) { state.dontAskAgainTrash = true; ls.set('beanydrive_skip_empty_trash', '1'); }
        apiCall(api.emptyTrash());
      },
    });
  }

  async function manualCheckForUpdates() {
    showToast('Checking for updates…');
    const result = await api.checkForUpdates();
    if (result.status === 'available') { state.updatePrompt = result; render(); } else if (result.status === 'error') showToast('Could not check for updates.', { kind: 'err' });
    else showToast("You're up to date.", { kind: 'ok' });
  }

  function setPref(key, storageKey, value) {
    state[key] = value;
    ls.set(storageKey, value);
    applyThemeVars();
    render();
  }
  function toggleSettings() {
    state.settingsOpen = !state.settingsOpen;
    state.menu = null;
    if (state.settingsOpen) {
      state.botTokenInput = '';
      state.channelIdInput = state.settings.channelId;
      state.chunkSizeInput = state.settings.chunkSizeMb;
      state.concurrencyInput = state.settings.uploadConcurrency || 4;
      state.testResult = null;
    }
    render();
  }
  function saveSettingsForm() {
    const token = state.botTokenInput.trim() || undefined;
    const channelId = String(state.channelIdInput).trim();
    const chunkSizeMb = Number(state.chunkSizeInput) || 10;
    const uploadConcurrency = Number(state.concurrencyInput) || 4;
    api.saveSettings({ token, channelId, chunkSizeMb, uploadConcurrency }).then((res) => {
      state.settings = res.settings;
      state.botTokenInput = '';
      showToast(res.ok ? 'Settings saved' : `Connect failed: ${res.error}`, { kind: res.ok ? 'ok' : 'err' });
      render();
    });
  }
  function testConnectionAction() {
    state.testResult = { testing: true };
    render();
    const token = state.botTokenInput.trim() || undefined;
    api.testConnection({ token, channelId: String(state.channelIdInput).trim() }).then((r) => {
      state.testResult = r.ok
        ? { testing: false, ok: true, message: `Reachable — #${r.channelName} in ${r.guildName}` }
        : { testing: false, ok: false, message: r.error };
      render();
    });
  }

  // ---- menus --------------------------------------------------------------------------
  function openMenu(x, y, items, title, flipY) {
    state.menu = { x, y, items, title, flipY };
    render();
  }
  function menuAt(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.bottom + 4, flipY: r.top - 4 };
  }
  function rowMenuItems(r) {
    if (r.isFolder) {
      return [
        { label: 'Open', icon: 'folder', run: () => selectNav(r.targetNav), kbd: 'Enter' },
        ...(r.isTag ? [] : [
          { label: 'New folder inside', icon: 'folderPlus', run: () => newFolder(r.path) },
          { label: 'Rename', icon: 'pencil', run: renameTarget, kbd: 'F2' },
          { sep: true },
          { label: 'Delete folder…', icon: 'trash', danger: true, run: deleteFolderTarget },
        ]),
      ];
    }
    const multi = state.selected.size > 1;
    const files = targetFiles();
    if (r.trashed) {
      return [
        { label: multi ? `Restore ${files.length} files` : 'Restore', icon: 'restore', run: restoreTargets, kbd: 'x' },
        { label: 'Download', icon: 'download', run: () => downloadFiles(files) },
      ];
    }
    const allStarred = files.every((f) => f.starred);
    return [
      ...(multi ? [] : [
        PREVIEWABLE.has(r.cat) ? { label: 'Preview', icon: 'eye', run: () => openPreview(r.file), kbd: 'p' } : null,
      ].filter(Boolean)),
      { label: multi ? `Download ${files.length} files` : 'Download', icon: 'download', run: () => downloadFiles(files) },
      ...(multi ? [] : [{ label: 'Copy link', icon: 'link', run: copyLink }]),
      { sep: true },
      { label: allStarred ? 'Unstar' : 'Star', icon: allStarred ? 'starFill' : 'star', run: starTargets, kbd: 'Space' },
      ...(multi ? [] : [{ label: 'Rename', icon: 'pencil', run: renameTarget, kbd: 'F2' }]),
      { label: 'Move to…', icon: 'move', run: openMovePicker, kbd: 'm' },
      { sep: true },
      { label: multi ? `Move ${files.length} to Trash` : 'Move to Trash', icon: 'trash', danger: true, run: trashTargets, kbd: 'Del' },
    ];
  }
  function openRowMenu(key, x, y, flipY) {
    if (!state.selected.has(key)) setSelection([key], key);
    else state.focusKey = key;
    const r = rowFor(key);
    if (!r) return;
    const title = state.selected.size > 1 ? `${state.selected.size} selected` : r.name;
    openMenu(x, y, rowMenuItems(r), layout === 'mobile' ? title : null, flipY);
  }
  function newMenuItems() {
    return [
      { label: 'Upload files', icon: 'upload', run: triggerUpload, kbd: 'u' },
      ...(api.pickFolder ? [{ label: 'Upload folder', icon: 'folder', run: triggerFolderUpload, kbd: 'Shift+U' }] : []),
      { label: 'New folder', icon: 'folderPlus', run: () => newFolder(), kbd: 'n' },
    ];
  }
  function sortMenuItems() {
    const opts = [['name', 'Name'], ['date', 'Date added'], ['size', 'Size'], ['type', 'Type']];
    return [
      ...opts.map(([k, label]) => ({ label, on: state.sortBy === k, run: () => setPref('sortBy', 'beanydrive_sort', k) })),
      { sep: true },
      { label: 'Ascending', icon: 'sortAsc', on: state.sortDir === 'asc', run: () => setPref('sortDir', 'beanydrive_sort_dir', 'asc') },
      { label: 'Descending', icon: 'sortDesc', on: state.sortDir === 'desc', run: () => setPref('sortDir', 'beanydrive_sort_dir', 'desc') },
    ];
  }

  // Closes whatever sits on top. Escape and Android's back button both use it.
  function closeTop() {
    if (state.previewOverlay) { closePreviewOverlay(); return true; }
    if (state.menu) { state.menu = null; render(); return true; }
    if (state.confirmModal) { state.confirmModal = null; render(); return true; }
    if (state.promptModal) { closePrompt(); return true; }
    if (state.movePicker) { state.movePicker = null; render(); return true; }
    if (state.updatePrompt) { state.updatePrompt = null; render(); return true; }
    if (state.shortcutsOpen) { state.shortcutsOpen = false; render(); return true; }
    if (state.settingsOpen) { toggleSettings(); return true; }
    if (state.sheet) { state.sheet = null; render(); return true; }
    if (state.selected.size || state.selectMode) { clearSelection(); return true; }
    if (state.searchQuery || state.mobileSearch) {
      state.searchQuery = ''; state.mobileSearch = false;
      if (searchInput) { searchInput.value = ''; searchInput.blur(); }
      render(); return true;
    }
    return false;
  }

  const ACTIONS = {
    'win-min': () => api.minimize(),
    'win-max': () => api.maximize(),
    'win-close': () => api.close(),
    'toggle-theme': () => setPref('theme', 'beanydrive_theme', effectiveTheme() === 'dark' ? 'light' : 'dark'),
    shortcuts: () => { state.shortcutsOpen = true; render(); },
    'toggle-detail': () => { state.detailOpen = !state.detailOpen; ls.set('beanydrive_detail', state.detailOpen ? '1' : '0'); render(); },
    settings: toggleSettings,
    upload: triggerUpload,
    'new-folder': () => newFolder(),
    'new-subfolder': () => { const r = targetRows()[0]; if (r && r.isFolder) newFolder(r.path); },
    'new-menu': (el) => {
      const m = menuAt(el);
      openMenu(m.x, m.y, newMenuItems(), layout === 'mobile' ? 'Add to this folder' : null, m.flipY);
    },
    'sort-menu': (el) => { const m = menuAt(el); openMenu(m.x, m.y, sortMenuItems(), layout === 'mobile' ? 'Sort by' : null, m.flipY); },
    'sort-by': (el) => {
      const k = el.dataset.sort;
      if (state.sortBy === k) setPref('sortDir', 'beanydrive_sort_dir', state.sortDir === 'asc' ? 'desc' : 'asc');
      else { state.sortDir = k === 'name' ? 'asc' : 'desc'; ls.set('beanydrive_sort_dir', state.sortDir); setPref('sortBy', 'beanydrive_sort', k); }
    },
    view: (el) => setPref('viewMode', 'beanydrive_view', el.dataset.view),
    'type-filter': (el) => { state.typeFilter = el.dataset.type; render(); },
    refresh: () => apiCall(api.refresh(), () => showToast('Refreshed', { kind: 'ok' })),
    'empty-trash': requestEmptyTrash,
    'toggle-expand': (el, e) => {
      e.stopPropagation();
      const p = el.dataset.path;
      if (state.expanded.has(p)) state.expanded.delete(p); else state.expanded.add(p);
      saveExpanded();
      render();
    },
    'row-menu': (el) => {
      const row = el.closest('[data-row]');
      const m = menuAt(el);
      openRowMenu(row.dataset.row, m.x - 180, m.y, m.flipY);
    },
    'clear-selection': clearSelection,
    'select-all': () => { const { keys } = getRows(); setSelection(keys, state.focusKey); render(); },
    open: () => { const r = targetRows()[0]; state.sheet = null; if (r) openRow(r.key); },
    preview: () => { const r = targetFiles()[0]; if (r && PREVIEWABLE.has(r.cat)) openPreview(r.file); },
    download: () => downloadFiles(targetFiles()),
    'copy-link': copyLink,
    star: starTargets,
    trash: trashTargets,
    restore: restoreTargets,
    rename: renameTarget,
    move: openMovePicker,
    'delete-folder': deleteFolderTarget,
    'add-tag': (el) => addTag(el.dataset.tag),
    'remove-tag': (el, e) => { e.stopPropagation(); removeTag(el.dataset.tag); },
    'new-tag': newTag,
    'toggle-transfers': () => { state.transfersOpen = !state.transfersOpen; render(); },
    'upload-pause': (el) => uploadAction(api.pauseUpload, el.dataset.uploadId),
    'upload-resume': (el) => uploadAction(api.resumeUpload, el.dataset.uploadId),
    'upload-cancel': (el) => uploadAction(api.cancelUpload, el.dataset.uploadId),
    'toast-action': (el) => {
      const t = state.toasts.find((x) => String(x.id) === el.dataset.toast);
      if (t && t.action) { dismissToast(t.id); t.action.fn(); }
    },
    'close-top': closeTop,
    'close-menu': () => { state.menu = null; render(); },
    'close-sheet': () => { state.sheet = null; render(); },
    'go-up': goUp,
    'm-search': () => {
      state.mobileSearch = !state.mobileSearch;
      renderSync();
      if (state.mobileSearch && searchInput) searchInput.focus();
      else if (!state.mobileSearch) { state.searchQuery = ''; render(); }
    },
    'm-select': () => {
      state.selectMode = !state.selectMode;
      if (!state.selectMode) state.selected.clear();
      render();
    },
    // settings
    'test-connection': testConnectionAction,
    'save-settings': saveSettingsForm,
    'step-chunk': (el) => { state.chunkSizeInput = Math.max(1, Math.min(100, (Number(state.chunkSizeInput) || 0) + Number(el.dataset.delta))); render(); },
    'step-conc': (el) => { state.concurrencyInput = Math.max(1, Math.min(8, (Number(state.concurrencyInput) || 0) + Number(el.dataset.delta))); render(); },
    'upload-docs': () => api.openExternal(UPLOAD_SPEED_DOCS),
    'set-ui': (el) => setPref('uiStyle', 'beanydrive_ui', el.dataset.val),
    'set-theme': (el) => setPref('theme', 'beanydrive_theme', el.dataset.val),
    'set-accent': (el) => setPref('accent', 'beanydrive_accent', el.dataset.val),
    'set-density': (el) => setPref('density', 'beanydrive_density', el.dataset.val),
    'check-updates': manualCheckForUpdates,
    // modals
    'prompt-submit': submitPrompt,
    'confirm-check': () => { state.confirmModal.checked = !state.confirmModal.checked; render(); },
    'confirm-ok': () => { const c = state.confirmModal; state.confirmModal = null; render(); if (c && c.onConfirm) c.onConfirm(c.checked); },
    'pick-folder': (el) => { state.movePicker.target = el.dataset.path; render(); },
    'pick-new-folder': () => newFolder(state.movePicker ? state.movePicker.target : ''),
    'move-confirm': confirmMove,
    'update-open': () => { if (state.updatePrompt) api.openExternal(state.updatePrompt.url); },
    'update-download': downloadUpdate,
    'update-install': () => {
      api.installUpdate().then((res) => {
        if (res && !res.ok) { state.updateDl = { phase: 'error', error: res.error }; render(); }
      });
    },
    'upload-folder': triggerFolderUpload,
  };

  // ---- events (bound once; regions only carry data-* attributes) ---------------------
  let suppressClick = false;

  document.addEventListener('click', (e) => {
    if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); return; }
    const t = e.target;
    if (t.closest('#preview-root')) return;

    const menuItem = t.closest('[data-menu]');
    if (menuItem && state.menu) {
      const item = state.menu.items[Number(menuItem.dataset.menu)];
      state.menu = null;
      render();
      if (item && item.run) item.run();
      return;
    }
    // Any click outside an open popover dismisses it and does nothing else.
    if (state.menu && layout === 'desktop' && !t.closest('.menu')) {
      state.menu = null;
      render();
      if (!t.closest('[data-act="row-menu"],[data-act="sort-menu"],[data-act="new-menu"]')) return;
    }

    const actEl = t.closest('[data-act]');
    if (actEl && !actEl.disabled) {
      const fn = ACTIONS[actEl.dataset.act];
      if (fn) { fn(actEl, e); return; }
    }
    const navEl = t.closest('[data-nav]');
    if (navEl) {
      state.settingsOpen = false;
      selectNav(navEl.dataset.nav);
      return;
    }
    const rowEl = t.closest('[data-row]');
    if (rowEl) { onRowClick(rowEl.dataset.row, e); return; }
    // A click on empty space in the list clears the selection, like Explorer.
    if (layout === 'desktop' && t.closest('[data-region="body"]') && !e.ctrlKey && !e.shiftKey && state.selected.size) clearSelection();
  });

  document.addEventListener('dblclick', (e) => {
    const rowEl = e.target.closest('[data-row]');
    if (rowEl && layout === 'desktop' && !e.target.closest('[data-act]')) openRow(rowEl.dataset.row);
  });

  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea, #preview-root')) return;
    // Android fires contextmenu on long-press; the long-press handler owns that.
    if (layout === 'mobile') { e.preventDefault(); return; }
    const rowEl = e.target.closest('[data-row]');
    if (rowEl) {
      e.preventDefault();
      openRowMenu(rowEl.dataset.row, e.clientX, e.clientY);
      return;
    }
    if (e.target.closest('[data-region="body"]') && layout === 'desktop' && state.connection.status === 'connected' && !['trash', 'tags'].includes(state.nav)) {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, [...newMenuItems(), { sep: true }, { label: 'Refresh', icon: 'refresh', run: ACTIONS.refresh, kbd: 'F5' }]);
    }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'search-input') {
      state.searchQuery = t.value;
      state.selected.clear();
      state.focusKey = null;
      render();
      return;
    }
    if (t.dataset && t.dataset.bind) state[t.dataset.bind] = t.value;
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'prompt-input' && e.key === 'Enter') { e.preventDefault(); submitPrompt(); }
  }, true);

  document.addEventListener('dragstart', (e) => {
    const rowEl = e.target.closest && e.target.closest('[data-row]');
    if (!rowEl) return;
    const r = rowFor(rowEl.dataset.row);
    if (r && !r.isFolder) startRowDrag(e, r);
  });

  // Files dragged in from the OS: only external drags carry 'Files' (rows
  // dragged out go through Electron's startDrag and never get here).
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || layout !== 'desktop') return;
    e.preventDefault();
    dragCounter += 1;
    if (!state.dropActive && state.connection.status === 'connected' && isDropTarget()) { state.dropActive = true; render(); }
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragCounter = Math.max(0, dragCounter - 1);
    if (!dragCounter && state.dropActive) { state.dropActive = false; render(); }
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter = 0;
    const was = state.dropActive;
    state.dropActive = false;
    render();
    if (!was) return;
    const dropped = Array.from(e.dataTransfer.files);
    const paths = dropped.map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) startUpload(paths);
    else if (dropped.length) showToast('Could not resolve the dropped file(s) on disk', { kind: 'err' });
  });
  function isDropTarget() { return !['trash', 'starred', 'recent', 'tags'].includes(state.nav) && !state.nav.startsWith('tag:'); }

  // Long-press selects on touch screens (the desktop's ctrl-click).
  let pressTimer = null, pressStart = null;
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    const rowEl = e.target.closest('[data-row]');
    if (!rowEl || e.target.closest('[data-act]')) return;
    pressStart = { x: e.clientX, y: e.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null;
      suppressClick = true;
      const key = rowEl.dataset.row;
      state.selectMode = true;
      state.selected.add(key);
      state.focusKey = key;
      state.anchorKey = key;
      if (navigator.vibrate) navigator.vibrate(12);
      render();
    }, 450);
  }, { passive: true });
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  document.addEventListener('pointermove', (e) => {
    if (pressTimer && pressStart && Math.hypot(e.clientX - pressStart.x, e.clientY - pressStart.y) > 10) cancelPress();
  }, { passive: true });
  document.addEventListener('pointerup', () => {
    // A long press already fired: the click that follows must not toggle again.
    if (!pressTimer && suppressClick) setTimeout(() => { suppressClick = false; }, 400);
    cancelPress();
  });
  document.addEventListener('pointercancel', cancelPress);

  window.addEventListener('resize', () => {
    if (state.menu && layout === 'desktop') state.menu = null;
    fitOfficeSlides();
    render();
  });

  // ---- keyboard shortcuts ----------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    // The preview overlay is modal — it owns the keyboard until closed.
    if (state.previewOverlay) {
      if (e.key === 'Escape') { closePreviewOverlay(); return; }
      if (e.key === 'ArrowLeft') { changePreviewPage(-1); return; }
      if (e.key === 'ArrowRight') { changePreviewPage(1); return; }
      return;
    }
    const tag = (e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (e.key === 'Escape') {
      if (inField && e.target.id === 'search-input' && state.searchQuery) { state.searchQuery = ''; e.target.value = ''; render(); return; }
      if (inField) e.target.blur();
      closeTop();
      return;
    }
    if (inField) {
      if (e.target.id === 'search-input' && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); e.target.blur(); moveFocus(1, false); }
      return;
    }
    const blocking = state.settingsOpen || state.promptModal || state.confirmModal || state.movePicker || state.shortcutsOpen || state.updatePrompt;
    if (state.menu) { if (e.key !== 'Shift') { state.menu = null; render(); } return; }
    if (blocking) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); ACTIONS['select-all'](); return; }
    if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); focusSearch(); return; }
    // Mac conventions: Cmd+Delete moves to Trash (a Mac keyboard's Delete is
    // Backspace), Cmd+, opens settings.
    if (IS_MAC && e.metaKey && e.key === 'Backspace') { e.preventDefault(); if (state.nav === 'trash') restoreTargets(); else trashTargets(); return; }
    if (e.metaKey && e.key === ',') { e.preventDefault(); toggleSettings(); return; }
    if (mod) return;
    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); moveFocus(state.viewMode === 'grid' && e.key === 'ArrowDown' ? gridColumns() : 1, e.shiftKey); return;
      case 'ArrowUp': case 'k': e.preventDefault(); moveFocus(state.viewMode === 'grid' && e.key === 'ArrowUp' ? -gridColumns() : -1, e.shiftKey); return;
      case 'ArrowRight': if (state.viewMode === 'grid') { e.preventDefault(); moveFocus(1, e.shiftKey); } return;
      case 'ArrowLeft': if (state.viewMode === 'grid') { e.preventDefault(); moveFocus(-1, e.shiftKey); } return;
      case 'Home': e.preventDefault(); moveFocus(-1e9, e.shiftKey); return;
      case 'End': e.preventDefault(); moveFocus(1e9, e.shiftKey); return;
      case 'Enter': if (state.focusKey) openRow(state.focusKey); return;
      case 'Backspace': e.preventDefault(); goUp(); return;
      case '/': e.preventDefault(); focusSearch(); return;
      case 'u': triggerUpload(); return;
      case 'U': if (api.pickFolder) triggerFolderUpload(); return;
      case 'n': newFolder(); return;
      case 'r': case 'F2': renameTarget(); return;
      case 'p': ACTIONS.preview(); return;
      case 'm': openMovePicker(); return;
      case ' ': e.preventDefault(); starTargets(); return;
      case 'Delete': case 'd': if (state.nav !== 'trash') trashTargets(); return;
      case 'x': if (state.nav === 'trash') restoreTargets(); return;
      case ',': toggleSettings(); return;
      case 'i': ACTIONS['toggle-detail'](); return;
      case 'g': setPref('viewMode', 'beanydrive_view', state.viewMode === 'list' ? 'grid' : 'list'); return;
      case '?': state.shortcutsOpen = true; render(); return;
      case 'F5': e.preventDefault(); ACTIONS.refresh(); return;
      default:
    }
  });
  function focusSearch() {
    if (layout === 'mobile') { state.mobileSearch = true; renderSync(); }
    if (searchInput) { searchInput.focus(); searchInput.select(); }
  }
  function gridColumns() {
    const grid = R.body && R.body.querySelector('.grid');
    if (!grid) return 1;
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length);
  }

  // Android's back button (mobile/src/mobile-ui.js) lands here.
  window.beanyUI = {
    back() { return closeTop() || goUp(); },
  };

  // ---- preview overlay -----------------------------------------------------------
  // Rendered into its own persistent DOM node (#preview-root, a sibling of
  // #root) instead of going through render() — the region patches would
  // otherwise risk replacing a <canvas> mid-paint. renderPreviewOverlay() is
  // only ever called from preview-specific state transitions.
  // Loaded as a classic <script>, not an ES module import() — Chromium
  // blocks dynamic import() of local files from a file:// document (an
  // opaque-origin CORS restriction that doesn't apply to classic scripts),
  // which is how this app is loaded via BrowserWindow.loadFile(). The
  // vendored bundle is pre-built (esbuild --format=iife) from pdfjs-dist's
  // ES module build for exactly that reason.
  function loadPdfjs() {
    if (!pdfjsLibPromise) {
      pdfjsLibPromise = new Promise((resolve, reject) => {
        if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
        const script = document.createElement('script');
        script.src = 'vendor/pdfjs/pdf.bundle.js';
        script.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.bundle.js';
          resolve(window.pdfjsLib);
        };
        script.onerror = () => reject(new Error('Failed to load pdf.js'));
        document.head.appendChild(script);
      });
    }
    return pdfjsLibPromise;
  }

  // Auto-loads a small thumbnail for the focused image or PDF (first page
  // only) — separate from openPreview()'s full-size view, which still only
  // opens on click/'p'. Finished thumbnails go into thumbCache for the grid.
  // The bytes behind a preview, shared by the thumbnail and the full preview
  // so opening a file you just selected doesn't download it a second time.
  // Small LRU; anything big is dropped once used rather than held.
  const BYTES_CACHE_MAX = 3;
  const BYTES_CACHE_LIMIT = 60 * 1024 * 1024;
  const bytesCache = new Map(); // file id → Promise<previewFile result>
  function getPreviewBytes(id) {
    let p = bytesCache.get(id);
    if (p) { bytesCache.delete(id); bytesCache.set(id, p); return p; }
    p = api.previewFile(id);
    bytesCache.set(id, p);
    p.then((res) => {
      if (!res.ok || (res.bytes && res.bytes.byteLength > BYTES_CACHE_LIMIT)) bytesCache.delete(id);
    }, () => bytesCache.delete(id));
    while (bytesCache.size > BYTES_CACHE_MAX) bytesCache.delete(bytesCache.keys().next().value);
    return p;
  }

  // Selecting a file shouldn't quietly pull hundreds of MB off Discord, so
  // only small files get an automatic thumbnail; bigger ones preview on click.
  const THUMB_MAX_BYTES = 25 * 1024 * 1024;
  function ensureDetailThumb(selFile) {
    const cat = selFile ? categoryFor(selFile.name) : null;
    const wantId = cat && THUMBABLE.has(cat) && (selFile.size || 0) <= THUMB_MAX_BYTES ? selFile.id : null;
    if (state.detailThumb && state.detailThumb.fileId === wantId) return;
    if (!wantId) { state.detailThumb = null; return; }
    const cached = thumbCache.get(wantId);
    if (cached) { state.detailThumb = { fileId: wantId, loading: false, blobUrl: cached, error: null }; return; }
    const token = ++detailThumbToken;
    state.detailThumb = { fileId: wantId, loading: true, blobUrl: null, error: null };
    const done = (url) => {
      if (token !== detailThumbToken || !state.detailThumb) return;
      cacheThumb(wantId, url);
      state.detailThumb.blobUrl = url;
      state.detailThumb.loading = false;
      render();
    };
    const fail = (msg) => {
      if (token !== detailThumbToken || !state.detailThumb) return;
      state.detailThumb.loading = false;
      state.detailThumb.error = msg;
      render();
    };
    getPreviewBytes(wantId).then(async (res) => {
      if (token !== detailThumbToken) return;
      if (!res.ok) { fail(res.error || 'Preview failed'); return; }
      const blob = new Blob([res.bytes], { type: res.mime });
      if (cat === 'image') { done(URL.createObjectURL(blob)); return; }
      // pdf: render page 1 onto an offscreen canvas, then snapshot it to an
      // image blob — keeps the thumbnail a plain <img>, like the image case.
      try {
        const pdfjsLib = await loadPdfjs();
        if (token !== detailThumbToken) return;
        const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (token !== detailThumbToken) return;
        const page = await pdfDoc.getPage(1);
        if (token !== detailThumbToken) return;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = Math.min(1.5, 360 / unscaled.width, 360 / unscaled.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (token !== detailThumbToken) return;
        canvas.toBlob((pngBlob) => done(URL.createObjectURL(pngBlob)));
      } catch (err) {
        fail(`Couldn't render PDF: ${err.message}`);
      }
    }).catch((err) => fail(err.message || String(err)));
  }

  function openPreview(f) {
    pdfPreviewToken += 1;
    const token = pdfPreviewToken;
    releasePreview();
    state.menu = null;
    state.sheet = null;
    state.previewOverlay = {
      fileId: f.id, name: f.name, category: categoryFor(f.name),
      loading: true, progress: 0, error: null, blobUrl: null, textContent: null,
      pdfDoc: null, pdfPage: 1, pdfPageCount: 0,
      officeHtml: null, officeSummary: null, objectUrls: [],
    };
    render();
    renderPreviewOverlay();

    getPreviewBytes(f.id).then(async (res) => {
      if (token !== pdfPreviewToken) return; // closed or replaced while this was in flight
      const p = state.previewOverlay;
      if (!res.ok) { p.loading = false; p.error = res.error || 'Preview failed'; renderPreviewOverlay(); return; }
      const blob = new Blob([res.bytes], { type: res.mime });
      const cat = p.category;
      if (cat === 'text' || cat === 'code') {
        p.textContent = await blob.text();
        p.loading = false;
        renderPreviewOverlay();
      } else if (cat === 'pdf') {
        try {
          const pdfjsLib = await loadPdfjs();
          const buf = await blob.arrayBuffer();
          if (token !== pdfPreviewToken) return;
          const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
          if (token !== pdfPreviewToken) return;
          p.pdfDoc = pdfDoc;
          p.pdfPageCount = pdfDoc.numPages;
          p.loading = false;
          renderPreviewOverlay();
          await drawPdfPage(token);
        } catch (err) {
          if (token !== pdfPreviewToken) return;
          p.loading = false;
          p.error = `Couldn't render PDF: ${err.message}`;
          renderPreviewOverlay();
        }
      } else if (cat === 'word' || cat === 'ppt') {
        try {
          const buf = await blob.arrayBuffer();
          if (token !== pdfPreviewToken) return;
          const rendered = await window.ooxml.renderOffice(buf, p.name);
          if (token !== pdfPreviewToken) { rendered.objectUrls.forEach((u) => URL.revokeObjectURL(u)); return; }
          p.officeHtml = rendered.html;
          p.officeSummary = rendered.summary;
          p.objectUrls = rendered.objectUrls;
          p.loading = false;
          renderPreviewOverlay();
        } catch (err) {
          if (token !== pdfPreviewToken) return;
          p.loading = false;
          p.error = err.message || String(err);
          renderPreviewOverlay();
        }
      } else {
        p.blobUrl = URL.createObjectURL(blob);
        p.loading = false;
        renderPreviewOverlay();
      }
    }).catch((err) => {
      if (token !== pdfPreviewToken || !state.previewOverlay) return;
      state.previewOverlay.loading = false;
      state.previewOverlay.error = err.message || String(err);
      renderPreviewOverlay();
    });
  }

  async function drawPdfPage(token) {
    const p = state.previewOverlay;
    if (!p || !p.pdfDoc || token !== pdfPreviewToken) return;
    const page = await p.pdfDoc.getPage(p.pdfPage);
    if (token !== pdfPreviewToken) return;
    const canvas = document.getElementById('pdf-canvas');
    if (!canvas) return;
    const container = canvas.parentElement;
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.max(0.2, Math.min(
      (container.clientWidth - 32) / unscaled.width,
      (container.clientHeight - 32) / unscaled.height,
    ));
    // Render at device resolution so text stays sharp on HiDPI screens.
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * dpr });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }

  function changePreviewPage(delta) {
    const p = state.previewOverlay;
    if (!p || !p.pdfDoc) return;
    const next = p.pdfPage + delta;
    if (next < 1 || next > p.pdfPageCount) return;
    p.pdfPage = next;
    renderPreviewOverlay();
    drawPdfPage(pdfPreviewToken);
  }

  function releasePreview() {
    const p = state.previewOverlay;
    if (!p) return;
    if (p.blobUrl) URL.revokeObjectURL(p.blobUrl);
    // Every image pulled out of a Word/PowerPoint file is its own blob.
    if (p.objectUrls) p.objectUrls.forEach((u) => URL.revokeObjectURL(u));
  }
  function closePreviewOverlay() {
    pdfPreviewToken += 1; // invalidates any in-flight load/render for the closed preview
    releasePreview();
    state.previewOverlay = null;
    renderPreviewOverlay();
  }

  function buildPreviewOverlayHtml(p) {
    let body;
    if (p.loading) {
      body = `<div class="preview-status"><div class="bar"><span style="width:${p.progress}%"></span></div>Loading preview… ${p.progress}%</div>`;
    } else if (p.error) {
      body = `<div class="preview-status error">${icon('warn', 28)}<span>${esc(p.error)}</span></div>`;
    } else if (p.category === 'image') {
      body = `<img class="preview-media" src="${p.blobUrl}" alt="${esc(p.name)}">`;
    } else if (p.category === 'video') {
      body = `<video class="preview-media" src="${p.blobUrl}" controls autoplay playsinline></video>`;
    } else if (p.category === 'audio') {
      body = `<div class="preview-audio-wrap">${tile({ cat: 'audio' }, 'xl')}<audio class="preview-audio" src="${p.blobUrl}" controls autoplay></audio></div>`;
    } else if (p.category === 'text' || p.category === 'code') {
      body = `<pre class="preview-text">${esc(p.textContent || '')}</pre>`;
    } else if (p.category === 'pdf') {
      body = '<div class="preview-pdf-wrap"><canvas id="pdf-canvas"></canvas></div>';
    } else if (p.officeHtml) {
      // Built by ooxml.js, which escapes every value taken from the document.
      body = `<div class="preview-office">${p.officeHtml}</div>`;
    } else {
      body = '<div class="preview-status">No preview available</div>';
    }
    const pager = (p.category === 'pdf' && !p.loading && !p.error && p.pdfPageCount > 1) ? `
      <div class="preview-pager">
        <button class="icon-btn" id="preview-prev-page" ${p.pdfPage <= 1 ? 'disabled' : ''} title="Previous page (←)">${icon('back')}</button>
        <span class="preview-page-label">${p.pdfPage} / ${p.pdfPageCount}</span>
        <button class="icon-btn" id="preview-next-page" ${p.pdfPage >= p.pdfPageCount ? 'disabled' : ''} title="Next page (→)">${icon('chevronRight')}</button>
      </div>` : '';
    return `
      <div class="preview" id="preview-overlay">
        <div class="preview-head">
          ${tile({ cat: p.category })}
          <span class="preview-title">${esc(p.name)}${p.officeSummary ? `<span class="preview-sub">${esc(p.officeSummary)}</span>` : ''}</span>
          ${pager}
          <button class="icon-btn" id="preview-download" title="Download">${icon('download')}</button>
          <button class="icon-btn" id="preview-close" title="Close (Esc)">${icon('close')}</button>
        </div>
        <div class="preview-body" id="preview-body">${body}</div>
      </div>`;
  }

  // Slides are laid out at a fixed 960px and scaled to whatever the preview
  // pane actually is. transform doesn't affect layout, so the wrapper gets the
  // scaled size explicitly or the slides would overlap.
  function fitOfficeSlides() {
    const pane = previewRoot.querySelector('.preview-office');
    if (!pane) return;
    const available = pane.clientWidth - 48;
    if (available <= 0) return;
    previewRoot.querySelectorAll('.ooxml-slide').forEach((slide) => {
      const w = parseFloat(slide.style.width) || 960;
      const h = parseFloat(slide.style.height) || 540;
      const scale = Math.min(1, available / w);
      slide.style.transform = `scale(${scale})`;
      const wrap = slide.parentElement;
      wrap.style.width = `${Math.round(w * scale)}px`;
      wrap.style.height = `${Math.round(h * scale) + 18}px`;
    });
  }

  function renderPreviewOverlay() {
    const p = state.previewOverlay;
    if (!p) { previewRoot.innerHTML = ''; return; }
    // Progress ticks only move the bar; rebuilding would restart the layout.
    if (p.loading && previewRoot.querySelector('.preview-status .bar')) {
      const span = previewRoot.querySelector('.preview-status .bar span');
      span.style.width = `${p.progress}%`;
      span.parentElement.nextSibling.textContent = `Loading preview… ${p.progress}%`;
      return;
    }
    previewRoot.innerHTML = buildPreviewOverlayHtml(p);
    fitOfficeSlides();
    document.getElementById('preview-close').addEventListener('click', closePreviewOverlay);
    document.getElementById('preview-download').addEventListener('click', () => {
      const entry = getIndex().byKey.get(String(p.fileId));
      if (entry) downloadFiles([fileRow(entry)]);
    });
    document.getElementById('preview-body').addEventListener('click', (e) => { if (e.target.id === 'preview-body') closePreviewOverlay(); });
    const prevBtn = document.getElementById('preview-prev-page');
    if (prevBtn) prevBtn.addEventListener('click', () => changePreviewPage(-1));
    const nextBtn = document.getElementById('preview-next-page');
    if (nextBtn) nextBtn.addEventListener('click', () => changePreviewPage(1));
  }

  // ---- startup -----------------------------------------------------------------------
  // file input (static element, wired once)
  document.getElementById('file-input').addEventListener('change', (e) => {
    const picked = Array.from(e.target.files);
    const paths = picked.map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) startUpload(paths);
    else if (picked.length) showToast('Could not resolve the selected file(s) on disk', { kind: 'err' });
    e.target.value = '';
  });

  api.onUpdateAvailable((info) => { state.updatePrompt = info; render(); });

  // Old builds stored a style name that no longer exists.
  if (!UI_STYLES.some((u) => u.id === state.uiStyle)) state.uiStyle = 'nothing';

  async function init() {
    applyThemeVars();
    renderSync();
    state.settings = await api.getSettings();
    state.channelIdInput = state.settings.channelId;
    state.chunkSizeInput = state.settings.chunkSizeMb;
    state.concurrencyInput = state.settings.uploadConcurrency || 4;
    applyStatusSnapshot(await api.getStatus());
    render();
    api.getAppVersion().then((v) => { state.appVersion = v; if (state.settingsOpen) render(); });
  }

  init();
})();
