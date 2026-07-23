(() => {
  const root = document.getElementById('root');
  const titlebarLabel = document.getElementById('titlebar-label');

  document.getElementById('btn-min').addEventListener('click', () => window.api.minimize());
  document.getElementById('btn-max').addEventListener('click', () => window.api.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.close());

  const TAGS = {
    design: { name: 'design', color: '#5c9eff' },
    work: { name: 'work', color: '#5cd68a' },
    personal: { name: 'personal', color: '#f0c419' },
  };
  const ICONS = {
    folder: '▣', image: '◆', text: '≡', pdf: '▤', video: '▶', audio: '♪',
    sheet: '#', archive: '▦', word: 'W', ppt: 'P', code: '{}', other: '?',
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
  const ACCENTS = [
    { id: 'red', name: 'Red', value: '#ff5c5c' },
    { id: 'orange', name: 'Orange', value: '#ff9d42' },
    { id: 'amber', name: 'Amber', value: '#ffcc4d' },
    { id: 'green', name: 'Green', value: '#5ce87a' },
    { id: 'cyan', name: 'Cyan', value: '#5ae0c0' },
    { id: 'blue', name: 'Blue', value: '#5ac8ff' },
    { id: 'purple', name: 'Purple', value: '#b58aff' },
    { id: 'pink', name: 'Pink', value: '#ff8ac2' },
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtSize(n) {
    if (n == null) return '';
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function fmtDate(epochSeconds) {
    if (!epochSeconds) return '';
    return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
  }

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

  function foldersAt(files, explicitFolders, currentPath) {
    currentPath = normPath(currentPath);
    const prefix = currentPath ? `${currentPath}/` : '';
    const found = new Map();
    function ensure(fullPath) {
      let info = found.get(fullPath);
      if (!info) { info = { name: basenameOf(fullPath), path: fullPath, fileCount: 0, totalSize: 0 }; found.set(fullPath, info); }
      return info;
    }
    for (const f of files) {
      if (!f.path) continue;
      if (currentPath && !(f.path === currentPath || f.path.startsWith(prefix))) continue;
      let rest;
      if (!currentPath) rest = f.path;
      else { if (f.path === currentPath) continue; rest = f.path.slice(prefix.length); }
      const full = joinPath(currentPath, rest.split('/')[0]);
      const info = ensure(full);
      info.fileCount += 1;
      info.totalSize += f.size;
    }
    for (let fp of explicitFolders) {
      fp = normPath(fp);
      if (!fp) continue;
      let rest;
      if (currentPath) { if (!fp.startsWith(prefix)) continue; rest = fp.slice(prefix.length); } else rest = fp;
      if (!rest) continue;
      ensure(joinPath(currentPath, rest.split('/')[0]));
    }
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  function filesAt(files, currentPath) {
    currentPath = normPath(currentPath);
    return files.filter((f) => normPath(f.path) === currentPath && !f.trashed);
  }

  // ---- state ---------------------------------------------------------
  const state = {
    theme: localStorage.getItem('beanydrive_theme') || 'system',
    accent: localStorage.getItem('beanydrive_accent') || 'red',
    density: localStorage.getItem('beanydrive_density') || 'comfortable',
    systemDark: true,

    settings: { channelId: '', chunkSizeMb: 25, hasToken: false },
    connection: { status: 'disconnected', message: '' },
    files: [],
    folders: [],

    nav: 'root',
    selectedId: null,
    searchQuery: '',
    sortBy: 'date',
    compact: false,
    viewMode: 'list',

    settingsOpen: false,
    botTokenInput: '',
    channelIdInput: '',
    chunkSizeInput: 25,
    testResult: null,

    emptyTrashOpen: false,
    dontAskAgainTrash: localStorage.getItem('beanydrive_skip_empty_trash') === '1',

    promptModal: null,
    toast: null,
    uploads: [],
    dragOver: false,
  };

  let rowIds = [];
  let rowMeta = {};
  let toastTimer = null;
  let dragCounter = 0;

  function accentHex() { return (ACCENTS.find((a) => a.id === state.accent) || ACCENTS[0]).value; }
  function effectiveTheme() { return state.theme === 'system' ? (state.systemDark ? 'dark' : 'light') : state.theme; }

  function applyThemeVars() {
    document.documentElement.dataset.theme = effectiveTheme();
    document.documentElement.dataset.density = state.density;
    document.documentElement.style.setProperty('--accent', accentHex());
    localStorage.setItem('beanydrive_accent_hex', accentHex());
  }

  const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  if (mq) {
    state.systemDark = mq.matches;
    mq.addEventListener && mq.addEventListener('change', (e) => { state.systemDark = e.matches; applyThemeVars(); render(); });
  }

  function showToast(msg) {
    state.toast = msg;
    render();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.toast = null; render(); }, 2400);
  }

  // Every fire-and-forget IPC call (star, trash, rename, tag, folder, empty
  // trash, refresh…) goes through here so a rejected invoke — not connected
  // yet, a Discord API error — surfaces as a toast instead of a silent
  // unhandled rejection.
  function apiCall(promise, onSuccess) {
    return promise.then((res) => { if (onSuccess) onSuccess(res); return res; })
      .catch((e) => { showToast(e.message || String(e)); });
  }

  // ---- IPC wiring -----------------------------------------------------
  function applyStatusSnapshot(snap) {
    state.connection.status = snap.status;
    state.connection.channelName = snap.channelName;
    state.connection.guildName = snap.guildName;
    state.connection.chunkLimitMb = snap.chunkLimitMb;
    state.files = snap.files || [];
    state.folders = snap.folders || [];
  }

  window.api.onUpdate((snap) => { applyStatusSnapshot(snap); render(); });
  window.api.onStatus(({ status, message }) => {
    state.connection.status = status;
    state.connection.message = message;
    render();
  });
  window.api.onUploadProgress(({ uploadId, name, progress }) => {
    let u = state.uploads.find((x) => x.id === uploadId);
    if (!u) { u = { id: uploadId, name, progress: 0 }; state.uploads.push(u); }
    u.progress = progress;
    render();
  });
  window.api.onUploadDone(({ name, ok, error, uploadId }) => {
    state.uploads = state.uploads.filter((u) => u.id !== uploadId);
    showToast(ok ? `Uploaded ${name}` : `Failed: ${name}${error ? ' — ' + error : ''}`);
    render();
  });

  async function init() {
    state.settings = await window.api.getSettings();
    state.channelIdInput = state.settings.channelId;
    state.chunkSizeInput = state.settings.chunkSizeMb;
    applyStatusSnapshot(await window.api.getStatus());
    applyThemeVars();
    render();
  }

  // ---- actions ----------------------------------------------------------
  function destForUpload() {
    return ['root', 'starred', 'recent', 'trash'].includes(state.nav) ? '' : state.nav;
  }
  function startUpload(paths) {
    if (state.connection.status !== 'connected') { showToast('Not connected — open Settings (,) first'); return; }
    apiCall(window.api.upload(paths, destForUpload()), (res) => {
      if (!res.ok) showToast(res.error || 'Upload failed');
    });
  }

  function selectNav(id) { state.nav = id; state.searchQuery = ''; state.selectedId = null; render(); }
  function selectFile(id) { state.selectedId = id; render(); }
  function toggleSettings() {
    state.settingsOpen = !state.settingsOpen;
    if (state.settingsOpen) {
      state.botTokenInput = '';
      state.channelIdInput = state.settings.channelId;
      state.chunkSizeInput = state.settings.chunkSizeMb;
      state.testResult = null;
    }
    render();
  }

  function toggleCompact() { state.compact = !state.compact; render(); }
  function toggleViewMode() { state.viewMode = state.viewMode === 'list' ? 'grid' : 'list'; render(); }
  function triggerUpload() { document.getElementById('file-input').click(); }

  function toggleStarSelected() {
    const f = rowMeta[state.selectedId];
    if (f && !f.isFolder) apiCall(window.api.star(f.id, !f.starred));
  }
  function trashOrRestoreSelected() {
    const f = rowMeta[state.selectedId];
    if (!f || f.isFolder) return;
    apiCall(state.nav === 'trash' ? window.api.restore(f.id) : window.api.trash(f.id));
  }
  function downloadSelected() {
    const f = rowMeta[state.selectedId];
    if (!f || f.isFolder) return;
    apiCall(window.api.download(f.id, f.name), (res) => {
      if (res.ok) showToast(`Saved to ${res.path}`);
      else if (!res.canceled) showToast(`Download failed: ${res.error || ''}`);
    });
  }
  function copyLinkSelected() {
    const f = rowMeta[state.selectedId];
    if (!f || f.isFolder) return;
    apiCall(window.api.copyLink(f.id), (r) => {
      showToast(r.multiChunk ? 'Copied first-chunk link (large file — partial, may expire)' : 'Discord CDN link copied — may expire');
    });
  }

  function openPrompt(cfg) {
    state.promptModal = cfg;
    render();
    setTimeout(() => {
      const el = document.getElementById('prompt-input');
      if (el) { el.focus(); el.select(); }
    }, 0);
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

  function renameSelected() {
    const f = rowMeta[state.selectedId];
    if (!f || f.isFolder) return;
    openPrompt({ title: 'Rename file', value: f.name, submitLabel: 'Rename', onSubmit: (val) => apiCall(window.api.rename(f.id, val)) });
  }
  function newFolder() {
    openPrompt({
      title: 'New folder', value: '', submitLabel: 'Create',
      onSubmit: (val) => {
        const clean = val.replace(/[\\/]/g, '-').trim();
        if (!clean) return;
        const parent = ['root', 'starred', 'recent', 'trash'].includes(state.nav) ? '' : state.nav;
        const target = joinPath(parent, clean);
        apiCall(window.api.createFolder(target), () => { state.nav = target; render(); });
      },
    });
  }

  function requestEmptyTrash() {
    if (state.dontAskAgainTrash) confirmEmptyTrash();
    else { state.emptyTrashOpen = true; render(); }
  }
  function confirmEmptyTrash() {
    state.emptyTrashOpen = false;
    render();
    apiCall(window.api.emptyTrash(), () => showToast('Trash emptied'));
  }
  function cancelEmptyTrash() { state.emptyTrashOpen = false; render(); }
  function toggleDontAskAgain() {
    state.dontAskAgainTrash = !state.dontAskAgainTrash;
    localStorage.setItem('beanydrive_skip_empty_trash', state.dontAskAgainTrash ? '1' : '0');
    render();
  }

  function setTheme(t) { state.theme = t; localStorage.setItem('beanydrive_theme', t); applyThemeVars(); render(); }
  function setAccent(a) { state.accent = a; localStorage.setItem('beanydrive_accent', a); applyThemeVars(); render(); }
  function setDensity(d) { state.density = d; localStorage.setItem('beanydrive_density', d); applyThemeVars(); render(); }

  function saveSettingsForm() {
    const token = state.botTokenInput.trim() || undefined;
    const channelId = state.channelIdInput.trim();
    const chunkSizeMb = Number(state.chunkSizeInput) || 25;
    window.api.saveSettings({ token, channelId, chunkSizeMb }).then((res) => {
      state.settings = res.settings;
      state.botTokenInput = '';
      showToast(res.ok ? 'Settings saved' : `Connect failed: ${res.error}`);
      render();
    });
  }
  function testConnectionAction() {
    state.testResult = { testing: true };
    render();
    const token = state.botTokenInput.trim() || undefined;
    const channelId = state.channelIdInput.trim();
    window.api.testConnection({ token, channelId }).then((r) => {
      state.testResult = r.ok
        ? { testing: false, ok: true, message: `Reachable — #${r.channelName} in ${r.guildName}` }
        : { testing: false, ok: false, message: r.error };
      render();
    });
  }

  // ---- keyboard shortcuts -----------------------------------------------
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (inField && e.key !== 'Escape') return;
    switch (e.key) {
      case 'j': case 'k': {
        e.preventDefault();
        if (!rowIds.length) return;
        const idx = rowIds.indexOf(state.selectedId);
        let next = e.key === 'j' ? idx + 1 : idx - 1;
        if (idx === -1) next = 0;
        next = Math.max(0, Math.min(rowIds.length - 1, next));
        state.selectedId = rowIds[next];
        render();
        return;
      }
      case 'Enter': {
        const row = rowMeta[state.selectedId];
        if (row && row.isFolder) selectNav(row.targetNav);
        return;
      }
      case 'u': triggerUpload(); return;
      case 'n': newFolder(); return;
      case 'r': renameSelected(); return;
      case ' ': e.preventDefault(); toggleStarSelected(); return;
      case 'd': if (state.nav !== 'trash') trashOrRestoreSelected(); return;
      case 'x': if (state.nav === 'trash') trashOrRestoreSelected(); return;
      case ',': toggleSettings(); return;
      case 'Escape':
        if (state.emptyTrashOpen) { cancelEmptyTrash(); return; }
        if (state.promptModal) { closePrompt(); return; }
        if (state.settingsOpen) { toggleSettings(); return; }
        if (state.searchQuery) { state.searchQuery = ''; render(); }
        return;
      default: return;
    }
  });

  // ---- render -------------------------------------------------------------
  function computeView() {
    const files = state.files;
    const folders = state.folders;
    const rootFolders = foldersAt(files, folders, '');
    const rootCount = filesAt(files, '').length + rootFolders.length;
    const starredCount = files.filter((f) => f.starred && !f.trashed).length;
    const recentCount = Math.min(6, files.filter((f) => !f.trashed).length);
    const trashCount = files.filter((f) => f.trashed).length;

    const mainNavDefs = [
      { id: 'root', label: 'My Drive', count: rootCount },
      { id: 'starred', label: 'Starred', count: starredCount },
      { id: 'recent', label: 'Recent', count: recentCount },
    ];

    let rows;
    if (state.nav === 'trash') {
      rows = files.filter((f) => f.trashed).map((f) => ({ ...f, isFolder: false }));
    } else if (state.nav === 'starred') {
      rows = files.filter((f) => f.starred && !f.trashed).map((f) => ({ ...f, isFolder: false }));
    } else if (state.nav === 'recent') {
      rows = [...files].filter((f) => !f.trashed).sort((a, b) => b.created - a.created).slice(0, 6).map((f) => ({ ...f, isFolder: false }));
    } else {
      const cur = state.nav === 'root' ? '' : state.nav;
      const subFolders = foldersAt(files, folders, cur).map((fo) => ({
        id: `folder:${fo.path}`, isFolder: true, targetNav: fo.path, name: fo.name, tags: [], size: null, created: null, fileCount: fo.fileCount,
      }));
      rows = [...subFolders, ...filesAt(files, cur).map((f) => ({ ...f, isFolder: false }))];
    }

    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q) || (r.tags || []).some((t) => t.includes(q)));
    }
    if (state.nav !== 'recent') {
      rows = [...rows].sort((a, b) => {
        if (a.isFolder && !b.isFolder) return -1;
        if (!a.isFolder && b.isFolder) return 1;
        if (state.sortBy === 'name') return a.name.localeCompare(b.name);
        if (state.sortBy === 'size') return (b.size || 0) - (a.size || 0);
        return (b.created || 0) - (a.created || 0);
      });
    }

    rowIds = rows.map((r) => r.id);
    rowMeta = {};
    rows.forEach((r) => { rowMeta[r.id] = r; });

    const breadcrumbMap = { root: 'My Drive', starred: 'Starred', recent: 'Recent', trash: 'Trash' };
    const breadcrumb = breadcrumbMap[state.nav] || `My Drive / ${state.nav.split('/').join(' / ')}`;
    const selFile = files.find((f) => f.id === state.selectedId && (state.nav === 'trash' ? f.trashed : true));

    return { mainNavDefs, folderNavItems: rootFolders, rows, breadcrumb, selFile, trashCount };
  }

  function renderRowIcon(r) {
    if (r.isFolder) return ICONS.folder;
    return ICONS[categoryFor(r.name)] || ICONS.other;
  }

  function renderTagChips(tags) {
    return (tags || []).map((t) => TAGS[t]
      ? `<span class="tag-chip" style="border-color:${TAGS[t].color};color:${TAGS[t].color}">${esc(TAGS[t].name)}</span>` : '').join('');
  }

  function connMeta() {
    const accent = accentHex();
    if (state.connection.status === 'connected') return { color: accent, label: 'connected', dot: '●' };
    if (state.connection.status === 'connecting') return { color: 'var(--text-dim)', label: 'connecting…', dot: '○' };
    if (state.connection.status === 'error') return { color: 'var(--bg-close-hover)', label: state.connection.message || 'connection error', dot: '○' };
    return { color: 'var(--text-dim)', label: 'not connected', dot: '○' };
  }

  function buildRows(rows) {
    if (state.viewMode === 'grid') {
      return `<div class="file-grid">${rows.map((r) => `
        <div class="file-card ${r.id === state.selectedId ? 'active' : ''}" data-row="${esc(String(r.id))}">
          <div class="card-icon">${renderRowIcon(r)}${!r.isFolder && r.oversized ? '<span class="card-flag">!</span>' : ''}</div>
          <span class="card-name">${!r.isFolder && r.starred ? '★ ' : ''}${esc(r.name)}</span>
        </div>`).join('')}</div>`;
    }
    return rows.map((r) => {
      const showMeta = !r.isFolder && !state.compact;
      return `
      <div class="file-row ${r.id === state.selectedId ? 'active' : ''}" data-row="${esc(String(r.id))}">
        <div class="file-icon">${renderRowIcon(r)}</div>
        <div class="file-main">
          <span class="file-name" style="${r.id === state.selectedId ? `color:${accentHex()}` : ''}">${!r.isFolder && r.starred ? '★ ' : ''}${esc(r.name)}</span>
          ${showMeta ? `<div class="file-meta">
            <span class="dim">${esc(fmtDate(r.created))}</span>
            <span class="dim">${esc(fmtSize(r.size))}</span>
            ${renderTagChips(r.tags)}
            ${r.chunks && r.chunks.length > 1 ? `<span class="oversize-chip">${r.chunks.length} parts</span>` : ''}
          </div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function buildDetail(selFile) {
    if (!selFile) return '<div class="detail-empty">select a file to preview</div>';
    const cat = categoryFor(selFile.name);
    const previewTexts = {
      image: '[ image preview ]', text: '[ text preview ]', pdf: '[ pdf preview ]',
      video: '[ video — no inline playback ]', audio: '[ audio file ]', sheet: '[ spreadsheet — no inline preview ]',
      archive: '[ archive — no preview available ]', word: '[ document — no inline preview ]', ppt: '[ slides — no inline preview ]',
      code: '[ code file ]', other: '[ no preview available ]',
    };
    const parentLabel = selFile.path ? `My Drive / ${selFile.path.split('/').join(' / ')}` : 'My Drive';
    const addable = Object.keys(TAGS).filter((t) => !(selFile.tags || []).includes(t));
    return `
      <div class="detail-scroll">
        <div class="detail-name">${esc(selFile.name)}</div>
        <div class="detail-meta">
          <div class="detail-meta-row"><span class="k">date</span><span class="v">${esc(fmtDate(selFile.created))}</span></div>
          <div class="detail-meta-row"><span class="k">size</span><span class="v">${esc(fmtSize(selFile.size))}</span></div>
          <div class="detail-meta-row"><span class="k">path</span><span class="v">${esc(parentLabel)}</span></div>
          <div class="detail-meta-row"><span class="k">chunks</span><span class="v">${selFile.chunks ? selFile.chunks.length : 0}</span></div>
        </div>
        <div class="detail-preview">${previewTexts[cat] || previewTexts.other}</div>
        <div class="detail-tags">
          ${(selFile.tags || []).map((t) => TAGS[t] ? `
            <span class="tag-chip" style="border-color:${TAGS[t].color};color:${TAGS[t].color}">${esc(TAGS[t].name)}<span class="tag-remove" data-remove-tag="${esc(t)}">×</span></span>` : '').join('')}
          ${addable.map((t) => `<span class="tag-add-chip" data-add-tag="${esc(t)}">+ ${esc(TAGS[t].name)}</span>`).join('')}
        </div>
        <div class="detail-actions">
          <div class="act-btn" id="act-download">Download</div>
          <div class="act-btn" id="act-copy-link">Copy Link</div>
          <div class="act-btn" id="act-star">${selFile.starred ? 'Unstar' : 'Star'}</div>
          <div class="act-btn" id="act-trash">${state.nav === 'trash' ? 'Restore' : 'Move to Trash'}</div>
          <div class="act-btn" id="act-rename">Rename</div>
          <div class="act-btn primary" id="act-upload">Upload</div>
        </div>
      </div>`;
  }

  function buildSettingsPanel() {
    if (!state.settingsOpen) return '';
    const s = state.settings;
    return `
      <div class="settings-panel" id="settings-panel">
        <div class="settings-head"><span class="title">Settings</span><span class="esc" id="settings-esc">Esc</span></div>

        <div class="settings-section-gap">
          <div class="settings-label">Bot Token</div>
          <input type="password" class="settings-input" id="token-input" placeholder="${s.hasToken ? 'saved — leave blank to keep it' : 'paste your bot token'}" value="${esc(state.botTokenInput)}">
          <div class="settings-row-inline">
            <div class="test-btn" id="test-connection-btn">${state.testResult && state.testResult.testing ? 'testing…' : 'Test connection'}</div>
            ${state.testResult && !state.testResult.testing ? `<span style="font-size:11px;color:${state.testResult.ok ? accentHex() : 'var(--bg-close-hover)'}">${esc(state.testResult.message || '')}</span>` : ''}
          </div>
        </div>

        <div class="settings-section-gap">
          <div class="settings-label">Channel ID</div>
          <input class="settings-input" id="channel-input" value="${esc(state.channelIdInput)}" placeholder="numeric channel ID">
        </div>

        <div class="settings-section-gap">
          <div class="settings-label">Chunk size (MB)</div>
          <input class="settings-input" id="chunk-input" type="number" min="1" max="100" value="${esc(String(state.chunkSizeInput))}">
        </div>

        <div class="settings-row-inline">
          <div class="act-btn primary" id="settings-save-btn">Save &amp; connect</div>
        </div>

        <div class="settings-label" style="margin-top:8px;">Theme</div>
        <div class="option-row">
          ${['dark', 'light', 'system'].map((t) => `<div class="option-btn ${state.theme === t ? 'active' : ''}" data-theme-opt="${t}">${t}</div>`).join('')}
        </div>

        <div class="settings-label">Accent</div>
        <div class="swatch-row">
          ${ACCENTS.map((a) => `<div class="swatch ${state.accent === a.id ? 'active' : ''}" data-accent="${a.id}" style="background:${a.value}" title="${esc(a.name)}"></div>`).join('')}
        </div>

        <div class="settings-label">Density</div>
        <div class="option-row">
          ${['comfortable', 'compact'].map((d) => `<div class="option-btn ${state.density === d ? 'active' : ''}" data-density-opt="${d}">${d}</div>`).join('')}
        </div>
      </div>`;
  }

  function buildEmptyTrashModal(trashCount) {
    if (!state.emptyTrashOpen) return '';
    return `
      <div class="modal-overlay" id="empty-trash-overlay">
        <div class="modal-box">
          <div class="modal-title">Empty Trash?</div>
          <div class="modal-message">This permanently deletes ${trashCount} item(s) from the Discord channel. This cannot be undone.</div>
          <label class="modal-checkbox" id="dontask-toggle">
            <span class="box">${state.dontAskAgainTrash ? '✓' : ''}</span>
            <span class="label">Don't ask again</span>
          </label>
          <div class="modal-actions">
            <div class="act-btn" id="empty-trash-cancel">Cancel</div>
            <div class="act-btn danger" id="empty-trash-confirm">Empty Trash</div>
          </div>
        </div>
      </div>`;
  }

  function buildPromptModal() {
    if (!state.promptModal) return '';
    const cfg = state.promptModal;
    return `
      <div class="modal-overlay" id="prompt-overlay">
        <div class="modal-box prompt-box">
          <div class="modal-title">${esc(cfg.title)}</div>
          <input id="prompt-input" value="${esc(cfg.value || '')}">
          <div class="modal-actions">
            <div class="act-btn" id="prompt-cancel">Cancel</div>
            <div class="act-btn primary" id="prompt-submit">${esc(cfg.submitLabel || 'OK')}</div>
          </div>
        </div>
      </div>`;
  }

  function doRender() {
    const view = computeView();
    const conn = connMeta();
    const listBody = document.getElementById('list-body');
    const prevScroll = listBody ? listBody.scrollTop : 0;

    const totalBytes = state.files.filter((f) => !f.trashed).reduce((a, f) => a + f.size, 0);
    const totalCount = state.files.filter((f) => !f.trashed).length;
    const modeTag = state.nav === 'trash' ? 'TRASH' : (state.searchQuery ? 'SEARCH' : 'DRIVE');

    root.innerHTML = `
      <div class="statusbar-top">
        <span class="conn-dot" style="color:${conn.color}">${conn.dot}</span>
        <span class="conn-label">${esc(conn.label)}</span>
        <span class="sep">|</span>
        <span class="channel-label">${state.settings.channelId ? `#${esc(state.connection.channelName || state.settings.channelId)}` : 'no channel configured'}</span>
        <span class="spacer"></span>
        <span class="settings-link" id="settings-toggle">, settings</span>
      </div>
      <div class="main">
        <div class="sidebar">
          <div class="sidebar-title">My Drive</div>
          ${view.mainNavDefs.map((n) => `
            <div class="nav-item ${state.nav === n.id ? 'active' : ''}" data-nav="${n.id}">
              <span class="nav-arrow">${state.nav === n.id ? '▶' : ''}</span>
              <span class="nav-label">${esc(n.label)}</span>
              <span class="nav-count">${n.count}</span>
            </div>`).join('')}
          <div class="sidebar-title folders">Folders</div>
          ${view.folderNavItems.map((f) => `
            <div class="nav-item sub ${state.nav === f.path ? 'active' : ''}" data-nav="${esc(f.path)}">
              <span class="nav-arrow">${state.nav === f.path ? '▶' : ''}</span>
              <span class="nav-label">${esc(f.name)}</span>
              <span class="nav-count">${f.fileCount}</span>
            </div>`).join('')}
          <div class="sidebar-title folders">Trash</div>
          <div class="nav-item ${state.nav === 'trash' ? 'active' : ''}" data-nav="trash">
            <span class="nav-arrow">${state.nav === 'trash' ? '▶' : ''}</span>
            <span class="nav-label">Trash</span>
            <span class="nav-count">${view.trashCount}</span>
          </div>
        </div>

        <div class="list-pane" id="list-pane">
          <div class="list-header">
            <div class="breadcrumb">${esc(view.breadcrumb)}</div>
            <div class="toolbar-row">
              <input class="search-input" id="search-input" placeholder="/ search" value="${esc(state.searchQuery)}">
              <select class="sort-select" id="sort-select">
                <option value="date" ${state.sortBy === 'date' ? 'selected' : ''}>date</option>
                <option value="name" ${state.sortBy === 'name' ? 'selected' : ''}>name</option>
                <option value="size" ${state.sortBy === 'size' ? 'selected' : ''}>size</option>
              </select>
              <div class="icon-btn" id="toggle-compact" title="toggle row density">${state.compact ? '▤ normal' : '▤ compact'}</div>
              <div class="icon-btn" id="toggle-view" title="toggle grid/list view">${state.viewMode === 'list' ? '▦ grid' : '☰ list'}</div>
              <div class="icon-btn" id="refresh-btn" title="refresh from Discord">↻</div>
              <div class="icon-btn" id="upload-btn" title="upload">+ upload</div>
            </div>
            ${state.nav === 'trash' ? '<div class="empty-trash-link" id="empty-trash-link">Empty Trash</div>' : ''}
          </div>
          <div class="list-body" id="list-body">
            ${state.uploads.map((u) => `
              <div class="upload-row">
                <span class="upload-name">${esc(u.name)}</span>
                <div class="upload-bar-track"><div class="upload-bar-fill" style="width:${u.progress}%"></div></div>
                <span class="upload-pct">${u.progress}%</span>
              </div>`).join('')}
            ${state.connection.status !== 'connected' ? `
              <div class="center-msg">${esc(conn.label === 'not connected' ? 'Not connected — open Settings (,) to add your bot token and channel ID.' : conn.label)}</div>`
              : (view.rows.length === 0 && state.uploads.length === 0 ? `
              <div class="empty-state">${state.searchQuery ? `No results for "${esc(state.searchQuery)}"` : 'This folder is empty. Press u or drag files in to upload.'}</div>`
              : buildRows(view.rows))}
          </div>
        </div>

        <div class="detail-pane">${buildDetail(view.selFile)}</div>
      </div>

      <div class="statusbar-bottom">
        <span class="mode-tag">${modeTag}</span>
        <span class="spacer"></span>
        <span class="storage-label">${fmtSize(totalBytes)} uploaded across ${totalCount} file(s)${state.connection.chunkLimitMb ? ` · ${state.connection.chunkLimitMb} MB chunks` : ''}</span>
      </div>

      ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ''}
      ${buildSettingsPanel()}
      ${buildEmptyTrashModal(view.trashCount)}
      ${buildPromptModal()}
    `;

    titlebarLabel.textContent = 'BeanyDrive';

    const newListBody = document.getElementById('list-body');
    if (newListBody) newListBody.scrollTop = prevScroll;

    wire(view);
  }

  function render() {
    const active = document.activeElement;
    const id = active && active.id;
    const selStart = active && 'selectionStart' in active ? active.selectionStart : null;
    const selEnd = active && 'selectionEnd' in active ? active.selectionEnd : null;
    doRender();
    if (id) {
      const el = document.getElementById(id);
      if (el) {
        el.focus();
        if (selStart != null && el.setSelectionRange) { try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text field */ } }
      }
    }
  }

  function wire(view) {
    root.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => selectNav(el.dataset.nav)));
    root.querySelectorAll('[data-row]').forEach((el) => {
      el.addEventListener('click', () => {
        const r = rowMeta[el.dataset.row] || rowMeta[Number(el.dataset.row)];
        if (!r) return;
        if (r.isFolder) selectNav(r.targetNav); else selectFile(r.id);
      });
      el.addEventListener('dblclick', () => {
        const r = rowMeta[el.dataset.row] || rowMeta[Number(el.dataset.row)];
        if (r && r.isFolder) selectNav(r.targetNav);
      });
    });

    const settingsToggle = document.getElementById('settings-toggle');
    if (settingsToggle) settingsToggle.addEventListener('click', toggleSettings);

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', (e) => { state.searchQuery = e.target.value; render(); });

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortSelect.addEventListener('change', (e) => { state.sortBy = e.target.value; render(); });

    const compactBtn = document.getElementById('toggle-compact');
    if (compactBtn) compactBtn.addEventListener('click', toggleCompact);
    const viewBtn = document.getElementById('toggle-view');
    if (viewBtn) viewBtn.addEventListener('click', toggleViewMode);
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => apiCall(window.api.refresh(), () => showToast('Refreshed')));
    const uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn) uploadBtn.addEventListener('click', triggerUpload);
    const emptyTrashLink = document.getElementById('empty-trash-link');
    if (emptyTrashLink) emptyTrashLink.addEventListener('click', requestEmptyTrash);

    const listPane = document.getElementById('list-pane');
    if (listPane) {
      listPane.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter += 1;
        if (!listPane.classList.contains('drag-over')) listPane.classList.add('drag-over');
      });
      listPane.addEventListener('dragover', (e) => e.preventDefault());
      listPane.addEventListener('dragleave', () => {
        dragCounter = Math.max(0, dragCounter - 1);
        if (dragCounter === 0) listPane.classList.remove('drag-over');
      });
      listPane.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        listPane.classList.remove('drag-over');
        const paths = Array.from(e.dataTransfer.files).map((f) => f.path).filter(Boolean);
        if (paths.length) startUpload(paths);
      });
    }

    // detail pane actions
    const actDownload = document.getElementById('act-download');
    if (actDownload) actDownload.addEventListener('click', downloadSelected);
    const actCopy = document.getElementById('act-copy-link');
    if (actCopy) actCopy.addEventListener('click', copyLinkSelected);
    const actStar = document.getElementById('act-star');
    if (actStar) actStar.addEventListener('click', toggleStarSelected);
    const actTrash = document.getElementById('act-trash');
    if (actTrash) actTrash.addEventListener('click', trashOrRestoreSelected);
    const actRename = document.getElementById('act-rename');
    if (actRename) actRename.addEventListener('click', renameSelected);
    const actUpload = document.getElementById('act-upload');
    if (actUpload) actUpload.addEventListener('click', triggerUpload);
    root.querySelectorAll('[data-add-tag]').forEach((el) => el.addEventListener('click', () => {
      if (view.selFile) apiCall(window.api.addTag(view.selFile.id, el.dataset.addTag));
    }));
    root.querySelectorAll('[data-remove-tag]').forEach((el) => el.addEventListener('click', () => {
      if (view.selFile) apiCall(window.api.removeTag(view.selFile.id, el.dataset.removeTag));
    }));

    // settings panel
    const settingsEsc = document.getElementById('settings-esc');
    if (settingsEsc) settingsEsc.addEventListener('click', toggleSettings);
    const tokenInput = document.getElementById('token-input');
    if (tokenInput) tokenInput.addEventListener('input', (e) => { state.botTokenInput = e.target.value; });
    const channelInput = document.getElementById('channel-input');
    if (channelInput) channelInput.addEventListener('input', (e) => { state.channelIdInput = e.target.value; });
    const chunkInput = document.getElementById('chunk-input');
    if (chunkInput) chunkInput.addEventListener('input', (e) => { state.chunkSizeInput = e.target.value; });
    const testBtn = document.getElementById('test-connection-btn');
    if (testBtn) testBtn.addEventListener('click', testConnectionAction);
    const saveBtn = document.getElementById('settings-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveSettingsForm);
    root.querySelectorAll('[data-theme-opt]').forEach((el) => el.addEventListener('click', () => setTheme(el.dataset.themeOpt)));
    root.querySelectorAll('[data-accent]').forEach((el) => el.addEventListener('click', () => setAccent(el.dataset.accent)));
    root.querySelectorAll('[data-density-opt]').forEach((el) => el.addEventListener('click', () => setDensity(el.dataset.densityOpt)));

    // empty trash modal
    const etOverlay = document.getElementById('empty-trash-overlay');
    if (etOverlay) etOverlay.addEventListener('click', (e) => { if (e.target.id === 'empty-trash-overlay') cancelEmptyTrash(); });
    const etCancel = document.getElementById('empty-trash-cancel');
    if (etCancel) etCancel.addEventListener('click', cancelEmptyTrash);
    const etConfirm = document.getElementById('empty-trash-confirm');
    if (etConfirm) etConfirm.addEventListener('click', confirmEmptyTrash);
    const dontAsk = document.getElementById('dontask-toggle');
    if (dontAsk) dontAsk.addEventListener('click', toggleDontAskAgain);

    // prompt modal
    const promptOverlay = document.getElementById('prompt-overlay');
    if (promptOverlay) promptOverlay.addEventListener('click', (e) => { if (e.target.id === 'prompt-overlay') closePrompt(); });
    const promptCancel = document.getElementById('prompt-cancel');
    if (promptCancel) promptCancel.addEventListener('click', closePrompt);
    const promptSubmit = document.getElementById('prompt-submit');
    if (promptSubmit) promptSubmit.addEventListener('click', submitPrompt);
    const promptInput = document.getElementById('prompt-input');
    if (promptInput) promptInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPrompt(); });
  }

  // file input (static element, wired once)
  const fileInput = document.getElementById('file-input');
  fileInput.addEventListener('change', (e) => {
    const paths = Array.from(e.target.files).map((f) => f.path).filter(Boolean);
    if (paths.length) startUpload(paths);
    e.target.value = '';
  });

  init();
})();
