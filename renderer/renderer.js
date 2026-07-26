(() => {
  const root = document.getElementById('root');
  const previewRoot = document.getElementById('preview-root');
  const titlebarLabel = document.getElementById('titlebar-label');

  document.getElementById('btn-min').addEventListener('click', () => window.api.minimize());
  document.getElementById('btn-max').addEventListener('click', () => window.api.maximize());
  document.getElementById('btn-close').addEventListener('click', () => window.api.close());

  const TAGS = {
    design: { name: 'design', color: '#5c9eff' },
    work: { name: 'work', color: '#5cd68a' },
    personal: { name: 'personal', color: '#f0c419' },
  };
  // Font Awesome Free (Solid) icon paths — embedded inline so the app has
  // no runtime dependency on a font file or CDN. Icons are CC BY 4.0:
  // https://fontawesome.com/license/free
  const FA_PATHS = {
    folder: ['0 0 512 512', 'M64 448l384 0c35.3 0 64-28.7 64-64l0-240c0-35.3-28.7-64-64-64L298.7 80c-6.9 0-13.7-2.2-19.2-6.4L241.1 44.8C230 36.5 216.5 32 202.7 32L64 32C28.7 32 0 60.7 0 96L0 384c0 35.3 28.7 64 64 64z'],
    folderOpen: ['0 0 576 512', 'M56 225.6L32.4 296.2 32.4 96c0-35.3 28.7-64 64-64l138.7 0c13.8 0 27.3 4.5 38.4 12.8l38.4 28.8c5.5 4.2 12.3 6.4 19.2 6.4l117.3 0c35.3 0 64 28.7 64 64l0 16-365.4 0c-41.3 0-78 26.4-91.1 65.6zM477.8 448L99 448c-32.8 0-55.9-32.1-45.5-63.2l48-144C108 221.2 126.4 208 147 208l378.8 0c32.8 0 55.9 32.1 45.5 63.2l-48 144c-6.5 19.6-24.9 32.8-45.5 32.8z'],
    file: ['0 0 384 512', 'M64 0C28.7 0 0 28.7 0 64L0 448c0 35.3 28.7 64 64 64l256 0c35.3 0 64-28.7 64-64l0-277.5c0-17-6.7-33.3-18.7-45.3L258.7 18.7C246.7 6.7 230.5 0 213.5 0L64 0zM325.5 176L232 176c-13.3 0-24-10.7-24-24L208 58.5 325.5 176z'],
    fileLines: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM120 256c-13.3 0-24 10.7-24 24s10.7 24 24 24l144 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-144 0zm0 96c-13.3 0-24 10.7-24 24s10.7 24 24 24l144 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-144 0z'],
    filePdf: ['0 0 576 512', 'M96 0C60.7 0 32 28.7 32 64l0 384c0 35.3 28.7 64 64 64l80 0 0-112c0-35.3 28.7-64 64-64l176 0 0-165.5c0-17-6.7-33.3-18.7-45.3L290.7 18.7C278.7 6.7 262.5 0 245.5 0L96 0zM357.5 176L264 176c-13.3 0-24-10.7-24-24L240 58.5 357.5 176zM240 380c-11 0-20 9-20 20l0 128c0 11 9 20 20 20s20-9 20-20l0-28 12 0c33.1 0 60-26.9 60-60s-26.9-60-60-60l-32 0zm32 80l-12 0 0-40 12 0c11 0 20 9 20 20s-9 20-20 20zm96-80c-11 0-20 9-20 20l0 128c0 11 9 20 20 20l32 0c28.7 0 52-23.3 52-52l0-64c0-28.7-23.3-52-52-52l-32 0zm20 128l0-88 12 0c6.6 0 12 5.4 12 12l0 64c0 6.6-5.4 12-12 12l-12 0zm88-108l0 128c0 11 9 20 20 20s20-9 20-20l0-44 28 0c11 0 20-9 20-20s-9-20-20-20l-28 0 0-24 28 0c11 0 20-9 20-20s-9-20-20-20l-48 0c-11 0-20 9-20 20z'],
    fileImage: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM128 256a32 32 0 1 0 -64 0 32 32 0 1 0 64 0zM92.6 448l198.8 0c15.8 0 28.6-12.8 28.6-28.6 0-7.3-2.8-14.4-7.9-19.7L215.3 297.9c-6-6.3-14.4-9.9-23.2-9.9l-.3 0c-8.8 0-17.1 3.6-23.2 9.9L71.9 399.7C66.8 405 64 412.1 64 419.4 64 435.2 76.8 448 92.6 448z'],
    fileVideo: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM80 304l0 96c0 17.7 14.3 32 32 32l96 0c17.7 0 32-14.3 32-32l0-24 35 35c3.2 3.2 7.5 5 12 5 9.4 0 17-7.6 17-17l0-94.1c0-9.4-7.6-17-17-17-4.5 0-8.8 1.8-12 5l-35 35 0-24c0-17.7-14.3-32-32-32l-96 0c-17.7 0-32 14.3-32 32z'],
    fileAudio: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zm53.8 185.2c-9.1-6.3-21.5-4.1-27.8 5s-4.1 21.5 5 27.8c23.9 16.7 39.4 44.3 39.4 75.5s-15.6 58.9-39.4 75.5c-9.1 6.3-11.3 18.8-5 27.8s18.8 11.3 27.8 5c34.1-23.8 56.6-63.5 56.6-108.3S296 267.5 261.8 243.7zM80 312c-8.8 0-16 7.2-16 16l0 48c0 8.8 7.2 16 16 16l24 0 27.2 34c3 3.8 7.6 6 12.5 6l.3 0c8.8 0 16-7.2 16-16l0-128c0-8.8-7.2-16-16-16l-.3 0c-4.9 0-9.5 2.2-12.5 6l-27.2 34-24 0zm128 72.2c0 10.7 10.5 18.2 18.9 11.6 12.9-10.3 21.1-26.1 21.1-43.8s-8.2-33.5-21.1-43.8c-8.4-6.7-18.9 .9-18.9 11.6l0 64.5z'],
    fileExcel: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM164 266.7c-7.4-11-22.3-14-33.3-6.7s-14 22.3-6.7 33.3L163.2 352 124 410.7c-7.4 11-4.4 25.9 6.7 33.3s25.9 4.4 33.3-6.7l28-42 28 42c7.4 11 22.3 14 33.3 6.7s14-22.3 6.7-33.3L220.8 352 260 293.3c7.4-11 4.4-25.9-6.7-33.3s-25.9-4.4-33.3 6.7l-28 42-28-42z'],
    fileWord: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM135.4 274.8c-2.9-12.9-15.7-21.1-28.6-18.2s-21.1 15.7-18.2 28.6l32 144c2.3 10.5 11.4 18.2 22.2 18.8s20.6-6.1 24-16.4l25.2-75.7 25.2 75.7c3.4 10.2 13.2 16.9 24 16.4s19.9-8.2 22.2-18.8l32-144c2.9-12.9-5.3-25.8-18.2-28.6s-25.8 5.3-28.6 18.2l-13.2 59.4-20.6-61.8c-3.3-9.8-12.4-16.4-22.8-16.4s-19.5 6.6-22.8 16.4l-20.6 61.8-13.2-59.4z'],
    filePowerpoint: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM152 256c-13.3 0-24 10.7-24 24l0 144c0 13.3 10.7 24 24 24s24-10.7 24-24l0-24 24 0c39.8 0 72-32.2 72-72s-32.2-72-72-72l-48 0zm48 96l-24 0 0-48 24 0c13.3 0 24 10.7 24 24s-10.7 24-24 24z'],
    fileZipper: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM64 72c0 13.3 10.7 24 24 24l48 0c13.3 0 24-10.7 24-24s-10.7-24-24-24L88 48C74.7 48 64 58.7 64 72zm0 96c0 13.3 10.7 24 24 24l48 0c13.3 0 24-10.7 24-24s-10.7-24-24-24l-48 0c-13.3 0-24 10.7-24 24zm64 72l-32 0c-17.7 0-32 14.3-32 32l0 48c0 26.5 21.5 48 48 48s48-21.5 48-48l0-48c0-17.7-14.3-32-32-32zm-16 64a16 16 0 1 1 0 32 16 16 0 1 1 0-32z'],
    fileCode: ['0 0 384 512', 'M0 64C0 28.7 28.7 0 64 0L213.5 0c17 0 33.3 6.7 45.3 18.7L365.3 125.3c12 12 18.7 28.3 18.7 45.3L384 448c0 35.3-28.7 64-64 64L64 512c-35.3 0-64-28.7-64-64L0 64zm208-5.5l0 93.5c0 13.3 10.7 24 24 24L325.5 176 208 58.5zM154.2 295.6c8.6-10.1 7.5-25.2-2.6-33.8s-25.2-7.5-33.8 2.6l-48 56c-7.7 9-7.7 22.2 0 31.2l48 56c8.6 10.1 23.8 11.2 33.8 2.6s11.2-23.8 2.6-33.8l-34.6-40.4 34.6-40.4zm112-31.2c-8.6-10.1-23.8-11.2-33.8-2.6s-11.2 23.8-2.6 33.8l34.6 40.4-34.6 40.4c-8.6 10.1-7.5 25.2 2.6 33.8s25.2 7.5 33.8-2.6l48-56c7.7-9 7.7-22.2 0-31.2l-48-56z'],
    trashCan: ['0 0 448 512', 'M136.7 5.9C141.1-7.2 153.3-16 167.1-16l113.9 0c13.8 0 26 8.8 30.4 21.9L320 32 416 32c17.7 0 32 14.3 32 32s-14.3 32-32 32L32 96C14.3 96 0 81.7 0 64S14.3 32 32 32l96 0 8.7-26.1zM32 144l384 0 0 304c0 35.3-28.7 64-64 64L96 512c-35.3 0-64-28.7-64-64l0-304zm88 64c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24zm104 0c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24zm104 0c-13.3 0-24 10.7-24 24l0 192c0 13.3 10.7 24 24 24s24-10.7 24-24l0-192c0-13.3-10.7-24-24-24z'],
    boxOpen: ['0 0 640 512', 'M560.3 237.2c10.4 11.8 28.3 14.4 41.8 5.5 14.7-9.8 18.7-29.7 8.9-44.4l-48-72c-2.8-4.2-6.6-7.7-11.1-10.2L351.4 4.7c-19.3-10.7-42.8-10.7-62.2 0L88.8 116c-5.4 3-9.7 7.4-12.6 12.8L27.7 218.7c-12.6 23.4-3.8 52.5 19.6 65.1l33 17.7 0 53.3c0 23 12.4 44.3 32.4 55.7l176 99.7c19.6 11.1 43.5 11.1 63.1 0l176-99.7c20.1-11.4 32.4-32.6 32.4-55.7l0-117.5zm-240-9.8L170.2 144 320.3 60.6 470.4 144 320.3 227.4zm-41.5 50.2l-21.3 46.2-165.8-88.8 25.4-47.2 161.7 89.8z'],
  };

  function faIcon(name, size) {
    const entry = FA_PATHS[name] || FA_PATHS.file;
    const [viewBox, d] = entry;
    return `<svg class="fa-icon" viewBox="${viewBox}" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  }

  const CATEGORY_ICON = {
    image: 'fileImage', video: 'fileVideo', audio: 'fileAudio', pdf: 'filePdf',
    sheet: 'fileExcel', word: 'fileWord', ppt: 'filePowerpoint', archive: 'fileZipper',
    code: 'fileCode', text: 'fileLines', other: 'file',
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
  // Categories the in-app preview overlay knows how to render. Everything
  // else (office docs, archives) still only offers Download.
  const PREVIEWABLE = new Set(['image', 'pdf', 'text', 'code', 'video', 'audio']);

  // User-created tags, layered on top of the built-in TAGS map (design/work/
  // personal) and persisted locally — there's no server-side tag registry,
  // just per-file tag ids, so the id → {name,color} mapping itself has to
  // live somewhere durable.
  const CUSTOM_TAG_IDS = new Set();
  try {
    const savedCustomTags = JSON.parse(localStorage.getItem('beanydrive_custom_tags') || '[]');
    savedCustomTags.forEach((t) => {
      if (t && t.id && t.name && !TAGS[t.id]) { TAGS[t.id] = { name: t.name, color: t.color || '#8a8a8a' }; CUSTOM_TAG_IDS.add(t.id); }
    });
  } catch (e) { /* corrupt/missing localStorage entry — start with no custom tags */ }

  function saveCustomTags() {
    const list = [...CUSTOM_TAG_IDS].map((id) => ({ id, name: TAGS[id].name, color: TAGS[id].color }));
    localStorage.setItem('beanydrive_custom_tags', JSON.stringify(list));
  }

  function createCustomTag(rawName) {
    const name = rawName.trim();
    if (!name) return null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tag';
    let id = slug, n = 1;
    while (TAGS[id]) { n += 1; id = `${slug}-${n}`; }
    const color = ACCENTS[CUSTOM_TAG_IDS.size % ACCENTS.length].value;
    TAGS[id] = { name, color };
    CUSTOM_TAG_IDS.add(id);
    saveCustomTags();
    return id;
  }

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

    settings: { channelId: '', chunkSizeMb: 10, hasToken: false },
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
    chunkSizeInput: 10,
    testResult: null,

    emptyTrashOpen: false,
    dontAskAgainTrash: localStorage.getItem('beanydrive_skip_empty_trash') === '1',

    promptModal: null,
    updatePrompt: null,
    appVersion: '',
    toast: null,
    uploads: [],
    dragOver: false,
    previewOverlay: null,
    detailThumb: null,
  };

  let rowIds = [];
  let rowMeta = {};
  let toastTimer = null;
  let dragCounter = 0;
  let pdfjsLibPromise = null; // lazy-loaded, cached — only fetched the first time a PDF is previewed
  let pdfPreviewToken = 0; // bumped on every openPreview()/close so a stale async render can't stomp a newer one
  let detailThumbToken = 0; // bumped whenever the selection changes so a stale thumb fetch can't stomp a newer one

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
  window.api.onPreviewProgress(({ fileId, progress }) => {
    if (state.previewOverlay && state.previewOverlay.fileId === fileId) {
      state.previewOverlay.progress = progress;
      render();
    }
  });

  async function init() {
    state.settings = await window.api.getSettings();
    state.channelIdInput = state.settings.channelId;
    state.chunkSizeInput = state.settings.chunkSizeMb;
    applyStatusSnapshot(await window.api.getStatus());
    applyThemeVars();
    render();
    window.api.getAppVersion().then((v) => { state.appVersion = v; if (state.settingsOpen) render(); });
  }

  // ---- actions ----------------------------------------------------------
  // 'root'/'starred'/'recent'/'trash'/'tag:*' are virtual views, not real
  // folder paths — uploads/new-folders made while viewing one of them land
  // at the drive root instead of nesting under a fake path.
  function isRealFolderNav(nav) {
    return !['root', 'starred', 'recent', 'trash'].includes(nav) && !nav.startsWith('tag:');
  }
  function destForUpload() {
    return isRealFolderNav(state.nav) ? state.nav : '';
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

  // ---- preview overlay ---------------------------------------------------
  // Rendered into its own persistent DOM node (#preview-root, a sibling of
  // #root) instead of going through the normal render()/doRender() cycle —
  // that cycle rebuilds #root's innerHTML on every unrelated state change
  // (a toast, an upload tick), which would wipe out a <canvas> mid-paint.
  // renderPreviewOverlay() is only ever called from preview-specific state
  // transitions, so it never fights with anything already drawn.
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

  // Auto-loads a small in-panel thumbnail for the currently selected image or
  // PDF (first page only) file (detail pane, right side) — separate from
  // openPreview()'s full-size modal, which still only opens on click/'p'.
  function ensureDetailThumb(selFile) {
    const cat = selFile ? categoryFor(selFile.name) : null;
    const wantId = (cat === 'image' || cat === 'pdf') ? selFile.id : null;
    if (state.detailThumb && state.detailThumb.fileId === wantId) return;
    if (state.detailThumb && state.detailThumb.blobUrl) URL.revokeObjectURL(state.detailThumb.blobUrl);
    if (!wantId) { state.detailThumb = null; return; }
    const token = ++detailThumbToken;
    state.detailThumb = { fileId: wantId, loading: true, blobUrl: null, error: null };
    window.api.previewFile(wantId).then(async (res) => {
      if (token !== detailThumbToken) return;
      if (!res.ok) { state.detailThumb.loading = false; state.detailThumb.error = res.error || 'Preview failed'; render(); return; }
      const blob = new Blob([res.bytes], { type: res.mime });
      if (cat === 'image') {
        state.detailThumb.blobUrl = URL.createObjectURL(blob);
        state.detailThumb.loading = false;
        render();
        return;
      }
      // pdf: render page 1 onto an offscreen canvas, then snapshot it to an
      // image blob — keeps the detail pane a plain <img>, like the image
      // case, instead of a live <canvas> that doRender()'s innerHTML churn
      // would tear out from under an in-flight render.
      try {
        const pdfjsLib = await loadPdfjs();
        if (token !== detailThumbToken) return;
        const buf = await blob.arrayBuffer();
        if (token !== detailThumbToken) return;
        const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
        if (token !== detailThumbToken) return;
        const page = await pdfDoc.getPage(1);
        if (token !== detailThumbToken) return;
        const unscaled = page.getViewport({ scale: 1 });
        const scale = Math.min(1, 240 / unscaled.width, 240 / unscaled.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (token !== detailThumbToken) return;
        canvas.toBlob((pngBlob) => {
          if (token !== detailThumbToken || !state.detailThumb) return;
          state.detailThumb.blobUrl = URL.createObjectURL(pngBlob);
          state.detailThumb.loading = false;
          render();
        });
      } catch (err) {
        if (token !== detailThumbToken || !state.detailThumb) return;
        state.detailThumb.loading = false;
        state.detailThumb.error = `Couldn't render PDF: ${err.message}`;
        render();
      }
    }).catch((err) => {
      if (token !== detailThumbToken || !state.detailThumb) return;
      state.detailThumb.loading = false;
      state.detailThumb.error = err.message || String(err);
      render();
    });
  }

  function previewSelected() {
    const f = rowMeta[state.selectedId];
    if (!f || f.isFolder) return;
    if (!PREVIEWABLE.has(categoryFor(f.name))) return;
    openPreview(f);
  }

  function openPreview(f) {
    pdfPreviewToken += 1;
    const token = pdfPreviewToken;
    if (state.previewOverlay && state.previewOverlay.blobUrl) URL.revokeObjectURL(state.previewOverlay.blobUrl);
    state.previewOverlay = {
      fileId: f.id, name: f.name, category: categoryFor(f.name),
      loading: true, progress: 0, error: null, blobUrl: null, textContent: null,
      pdfDoc: null, pdfPage: 1, pdfPageCount: 0,
    };
    renderPreviewOverlay();

    window.api.previewFile(f.id).then(async (res) => {
      if (token !== pdfPreviewToken) return; // closed or replaced while this was in flight
      if (!res.ok) {
        state.previewOverlay.loading = false;
        state.previewOverlay.error = res.error || 'Preview failed';
        renderPreviewOverlay();
        return;
      }
      const blob = new Blob([res.bytes], { type: res.mime });
      const cat = state.previewOverlay.category;
      if (cat === 'text' || cat === 'code') {
        state.previewOverlay.textContent = await blob.text();
        state.previewOverlay.loading = false;
        renderPreviewOverlay();
      } else if (cat === 'pdf') {
        try {
          const pdfjsLib = await loadPdfjs();
          const buf = await blob.arrayBuffer();
          if (token !== pdfPreviewToken) return;
          const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
          if (token !== pdfPreviewToken) return;
          state.previewOverlay.pdfDoc = pdfDoc;
          state.previewOverlay.pdfPageCount = pdfDoc.numPages;
          state.previewOverlay.loading = false;
          renderPreviewOverlay();
          await drawPdfPage(token);
        } catch (err) {
          if (token !== pdfPreviewToken) return;
          state.previewOverlay.loading = false;
          state.previewOverlay.error = `Couldn't render PDF: ${err.message}`;
          renderPreviewOverlay();
        }
      } else {
        state.previewOverlay.blobUrl = URL.createObjectURL(blob);
        state.previewOverlay.loading = false;
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
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
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

  function closePreviewOverlay() {
    pdfPreviewToken += 1; // invalidates any in-flight load/render for the closed preview
    if (state.previewOverlay && state.previewOverlay.blobUrl) URL.revokeObjectURL(state.previewOverlay.blobUrl);
    state.previewOverlay = null;
    renderPreviewOverlay();
  }

  function buildPreviewOverlayHtml(p) {
    let body;
    if (p.loading) {
      body = `<div class="preview-status">Loading preview… ${p.progress}%</div>`;
    } else if (p.error) {
      body = `<div class="preview-status error">${esc(p.error)}</div>`;
    } else if (p.category === 'image') {
      body = `<img class="preview-media" src="${p.blobUrl}" alt="${esc(p.name)}">`;
    } else if (p.category === 'video') {
      body = `<video class="preview-media" src="${p.blobUrl}" controls autoplay></video>`;
    } else if (p.category === 'audio') {
      body = `<audio class="preview-audio" src="${p.blobUrl}" controls autoplay></audio>`;
    } else if (p.category === 'text' || p.category === 'code') {
      body = `<pre class="preview-text">${esc(p.textContent || '')}</pre>`;
    } else if (p.category === 'pdf') {
      body = '<div class="preview-pdf-wrap"><canvas id="pdf-canvas"></canvas></div>';
    } else {
      body = '<div class="preview-status">No preview available</div>';
    }
    const pager = (p.category === 'pdf' && !p.loading && !p.error && p.pdfPageCount > 1) ? `
      <div class="preview-pager">
        <div class="icon-btn" id="preview-prev-page" ${p.pdfPage <= 1 ? 'style="opacity:0.4;pointer-events:none"' : ''}>‹ prev</div>
        <span class="preview-page-label">page ${p.pdfPage} / ${p.pdfPageCount}</span>
        <div class="icon-btn" id="preview-next-page" ${p.pdfPage >= p.pdfPageCount ? 'style="opacity:0.4;pointer-events:none"' : ''}>next ›</div>
      </div>` : '';
    return `
      <div class="modal-overlay preview-overlay" id="preview-overlay">
        <div class="preview-box">
          <div class="preview-head">
            <span class="title">${esc(p.name)}</span>
            ${pager}
            <span class="esc" id="preview-close">Esc</span>
          </div>
          <div class="preview-body">${body}</div>
        </div>
      </div>`;
  }

  function renderPreviewOverlay() {
    const p = state.previewOverlay;
    if (!p) { previewRoot.innerHTML = ''; return; }
    previewRoot.innerHTML = buildPreviewOverlayHtml(p);
    const overlay = document.getElementById('preview-overlay');
    overlay.addEventListener('click', (e) => { if (e.target.id === 'preview-overlay') closePreviewOverlay(); });
    document.getElementById('preview-close').addEventListener('click', closePreviewOverlay);
    const prevBtn = document.getElementById('preview-prev-page');
    if (prevBtn) prevBtn.addEventListener('click', () => changePreviewPage(-1));
    const nextBtn = document.getElementById('preview-next-page');
    if (nextBtn) nextBtn.addEventListener('click', () => changePreviewPage(1));
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
        const parent = isRealFolderNav(state.nav) ? state.nav : '';
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

  function promptUpdateAvailable(info) {
    state.updatePrompt = info;
    render();
  }
  function dismissUpdatePrompt() { state.updatePrompt = null; render(); }
  function downloadUpdate() {
    const info = state.updatePrompt;
    state.updatePrompt = null;
    render();
    if (info) window.api.openExternal(info.url);
  }
  async function manualCheckForUpdates() {
    showToast('Checking for updates…');
    const result = await window.api.checkForUpdates();
    if (result.status === 'available') promptUpdateAvailable(result);
    else if (result.status === 'error') showToast('Could not check for updates.');
    else showToast("You're up to date.");
  }
  function toggleDontAskAgain() {
    state.dontAskAgainTrash = !state.dontAskAgainTrash;
    localStorage.setItem('beanydrive_skip_empty_trash', state.dontAskAgainTrash ? '1' : '0');
    render();
  }

  function setTheme(t) { state.theme = t; localStorage.setItem('beanydrive_theme', t); applyThemeVars(); render(); }
  function setAccent(a) { state.accent = a; localStorage.setItem('beanydrive_accent', a); applyThemeVars(); render(); }
  function setDensity(d) { state.density = d; localStorage.setItem('beanydrive_density', d); applyThemeVars(); render(); }

  function stepChunkSize(delta) {
    const current = Number(state.chunkSizeInput) || 0;
    state.chunkSizeInput = Math.max(1, Math.min(100, current + delta));
    render();
  }

  function saveSettingsForm() {
    const token = state.botTokenInput.trim() || undefined;
    const channelId = state.channelIdInput.trim();
    const chunkSizeMb = Number(state.chunkSizeInput) || 10;
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
    // The preview overlay is modal — it owns the keyboard until closed.
    if (state.previewOverlay) {
      if (e.key === 'Escape') { closePreviewOverlay(); return; }
      if (e.key === 'ArrowLeft') { changePreviewPage(-1); return; }
      if (e.key === 'ArrowRight') { changePreviewPage(1); return; }
      return;
    }
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
      case 'p': previewSelected(); return;
      case ' ': e.preventDefault(); toggleStarSelected(); return;
      case 'd': if (state.nav !== 'trash') trashOrRestoreSelected(); return;
      case 'x': if (state.nav === 'trash') trashOrRestoreSelected(); return;
      case ',': toggleSettings(); return;
      case 'Escape':
        if (state.emptyTrashOpen) { cancelEmptyTrash(); return; }
        if (state.promptModal) { closePrompt(); return; }
        if (state.updatePrompt) { dismissUpdatePrompt(); return; }
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
    const tagNavItems = Object.keys(TAGS).map((id) => ({
      id, name: TAGS[id].name, color: TAGS[id].color,
      count: files.filter((f) => !f.trashed && (f.tags || []).includes(id)).length,
    }));

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
    } else if (state.nav.startsWith('tag:')) {
      const tagId = state.nav.slice(4);
      rows = files.filter((f) => !f.trashed && (f.tags || []).includes(tagId)).map((f) => ({ ...f, isFolder: false }));
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
    const breadcrumb = state.nav.startsWith('tag:')
      ? `Tag / ${(TAGS[state.nav.slice(4)] || {}).name || state.nav.slice(4)}`
      : breadcrumbMap[state.nav] || `My Drive / ${state.nav.split('/').join(' / ')}`;
    const selFile = files.find((f) => f.id === state.selectedId && (state.nav === 'trash' ? f.trashed : true));

    return { mainNavDefs, folderNavItems: rootFolders, tagNavItems, rows, breadcrumb, selFile, trashCount };
  }

  function renderRowIcon(r, size) {
    if (r.isFolder) return faIcon(r.fileCount === 0 ? 'folderOpen' : 'folder', size);
    return faIcon(CATEGORY_ICON[categoryFor(r.name)] || 'file', size);
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
      return `<div class="file-grid">${rows.map((r) => {
        const oversized = !r.isFolder && r.chunks && r.chunks.length > 1;
        return `
        <div class="file-card ${r.id === state.selectedId ? 'active' : ''}" data-row="${esc(String(r.id))}">
          <div class="card-icon">${renderRowIcon(r, 34)}${oversized ? '<span class="card-flag" title="split into multiple chunks">!</span>' : ''}</div>
          <span class="card-name">${!r.isFolder && r.starred ? '★ ' : ''}${esc(r.name)}</span>
          ${!r.isFolder && (r.tags || []).length ? `<div class="card-tags">${renderTagChips(r.tags)}</div>` : ''}
        </div>`;
      }).join('')}</div>`;
    }
    return rows.map((r) => {
      const showMeta = !r.isFolder && !state.compact;
      return `
      <div class="file-row ${r.id === state.selectedId ? 'active' : ''}" data-row="${esc(String(r.id))}">
        <div class="file-icon">${renderRowIcon(r, 20)}</div>
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
    if (!selFile) return `<div class="detail-empty"><div class="empty-icon">${faIcon('fileLines', 28)}</div><div>select a file to preview</div></div>`;
    const cat = categoryFor(selFile.name);
    const previewTexts = {
      image: '[ image preview ]', text: '[ text preview ]', pdf: '[ pdf preview ]',
      video: '[ video — no inline playback ]', audio: '[ audio file ]', sheet: '[ spreadsheet — no inline preview ]',
      archive: '[ archive — no preview available ]', word: '[ document — no inline preview ]', ppt: '[ slides — no inline preview ]',
      code: '[ code file ]', other: '[ no preview available ]',
    };
    const parentLabel = selFile.path ? `My Drive / ${selFile.path.split('/').join(' / ')}` : 'My Drive';
    const addable = Object.keys(TAGS).filter((t) => !(selFile.tags || []).includes(t));
    const previewable = PREVIEWABLE.has(cat);
    let previewBody = previewTexts[cat] || previewTexts.other;
    if (cat === 'image' || cat === 'pdf') {
      const t = state.detailThumb;
      if (t && t.fileId === selFile.id && t.blobUrl) previewBody = `<img class="detail-thumb" src="${t.blobUrl}" alt="${esc(selFile.name)}">`;
      else if (t && t.fileId === selFile.id && t.error) previewBody = `<span class="dim-msg">${esc(t.error)}</span>`;
      else previewBody = `<span class="dim-msg">loading…</span>`;
    }
    return `
      <div class="detail-scroll">
        <div class="detail-name">${esc(selFile.name)}</div>
        <div class="detail-meta">
          <div class="detail-meta-row"><span class="k">date</span><span class="v">${esc(fmtDate(selFile.created))}</span></div>
          <div class="detail-meta-row"><span class="k">size</span><span class="v">${esc(fmtSize(selFile.size))}</span></div>
          <div class="detail-meta-row"><span class="k">path</span><span class="v">${esc(parentLabel)}</span></div>
          <div class="detail-meta-row"><span class="k">chunks</span><span class="v">${selFile.chunks ? selFile.chunks.length : 0}</span></div>
        </div>
        <div class="detail-preview ${previewable ? 'clickable' : ''} ${(cat === 'image' || cat === 'pdf') ? 'has-thumb' : ''}" ${previewable ? 'id="detail-preview-trigger" title="Preview (p)"' : ''}>${previewBody}</div>
        <div class="detail-tags">
          ${(selFile.tags || []).map((t) => TAGS[t] ? `
            <span class="tag-chip" style="border-color:${TAGS[t].color};color:${TAGS[t].color}">${esc(TAGS[t].name)}<span class="tag-remove" data-remove-tag="${esc(t)}">×</span></span>` : '').join('')}
          ${addable.map((t) => `<span class="tag-add-chip" data-add-tag="${esc(t)}">+ ${esc(TAGS[t].name)}</span>`).join('')}
          <span class="tag-add-chip tag-new-chip" id="add-new-tag-chip">+ new tag</span>
        </div>
        <div class="detail-actions">
          ${previewable ? '<div class="act-btn primary" id="act-preview">Preview</div>' : ''}
          <div class="act-btn" id="act-download">Download</div>
          <div class="act-btn" id="act-copy-link">Copy Link</div>
          <div class="act-btn" id="act-star">${selFile.starred ? 'Unstar' : 'Star'}</div>
          <div class="act-btn" id="act-trash">${state.nav === 'trash' ? 'Restore' : 'Move to Trash'}</div>
          <div class="act-btn" id="act-rename">Rename</div>
          <div class="act-btn" id="act-upload">Upload</div>
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
          <div class="stepper-row">
            <div class="icon-btn stepper-btn" id="chunk-decrement">−</div>
            <input class="settings-input stepper-input" id="chunk-input" type="number" min="1" max="100" value="${esc(String(state.chunkSizeInput))}">
            <div class="icon-btn stepper-btn" id="chunk-increment">+</div>
          </div>
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

        <div class="settings-label" style="margin-top:8px;">Updates</div>
        <div class="settings-row-inline">
          <div class="test-btn" id="update-check-btn">Check for updates</div>
          <span style="font-size:11px;color:var(--text-dim);">v${esc(state.appVersion || '')}</span>
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

  function buildUpdateModal() {
    if (!state.updatePrompt) return '';
    return `
      <div class="modal-overlay" id="update-overlay">
        <div class="modal-box">
          <div class="modal-title">Update available</div>
          <div class="modal-message">BeanyDrive v${esc(state.updatePrompt.version)} is available. Download it now?</div>
          <div class="modal-actions">
            <div class="act-btn" id="update-cancel">Later</div>
            <div class="act-btn primary" id="update-confirm">Download</div>
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
    ensureDetailThumb(view.selFile);
    const conn = connMeta();
    const listBody = document.getElementById('list-body');
    const prevScroll = listBody ? listBody.scrollTop : 0;

    const totalBytes = state.files.filter((f) => !f.trashed).reduce((a, f) => a + f.size, 0);
    const totalCount = state.files.filter((f) => !f.trashed).length;
    const modeTag = state.nav === 'trash' ? 'TRASH' : (state.searchQuery ? 'SEARCH' : (state.nav.startsWith('tag:') ? 'TAG' : 'DRIVE'));

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
              <span class="nav-icon">${faIcon(f.fileCount === 0 ? 'folderOpen' : 'folder', 12)}</span>
              <span class="nav-label">${esc(f.name)}</span>
              <span class="nav-count">${f.fileCount}</span>
            </div>`).join('')}
          ${view.tagNavItems.length ? `<div class="sidebar-title folders">Tags</div>` : ''}
          ${view.tagNavItems.map((t) => `
            <div class="nav-item sub ${state.nav === `tag:${t.id}` ? 'active' : ''}" data-nav="tag:${esc(t.id)}">
              <span class="nav-arrow">${state.nav === `tag:${t.id}` ? '▶' : ''}</span>
              <span class="nav-icon" style="color:${t.color}">&#9679;</span>
              <span class="nav-label">${esc(t.name)}</span>
              <span class="nav-count">${t.count}</span>
            </div>`).join('')}
          <div class="sidebar-title folders">Trash</div>
          <div class="nav-item ${state.nav === 'trash' ? 'active' : ''}" data-nav="trash">
            <span class="nav-arrow">${state.nav === 'trash' ? '▶' : ''}</span>
            <span class="nav-icon">${faIcon('trashCan', 12)}</span>
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
              <div class="icon-btn" id="new-folder-btn" title="new folder (n)">+ folder</div>
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
              <div class="empty-state">
                <div class="empty-icon">${faIcon(state.searchQuery ? 'file' : 'folderOpen', 32)}</div>
                <div>${state.searchQuery ? `No results for "${esc(state.searchQuery)}"` : 'This folder is empty. Press u or drag files in to upload.'}</div>
              </div>`
              : buildRows(view.rows))}
          </div>
        </div>

        <div class="detail-pane">${buildDetail(view.selFile)}</div>
      </div>

      <div class="statusbar-bottom">
        <span class="mode-tag">${modeTag}</span>
        <div class="hint-row">
          <span class="hint"><span class="hint-key">[j/k]</span> nav</span>
          <span class="hint"><span class="hint-key">[&#9166;]</span> open</span>
          <span class="hint"><span class="hint-key">[u]</span> upload</span>
          <span class="hint"><span class="hint-key">[n]</span> folder</span>
          <span class="hint"><span class="hint-key">[r]</span> rename</span>
          <span class="hint"><span class="hint-key">[p]</span> preview</span>
          <span class="hint"><span class="hint-key">[space]</span> star</span>
          <span class="hint"><span class="hint-key">[${state.nav === 'trash' ? 'x' : 'd'}]</span> ${state.nav === 'trash' ? 'restore' : 'trash'}</span>
          <span class="hint"><span class="hint-key">[,]</span> settings</span>
        </div>
        <span class="spacer"></span>
        <span class="storage-label">${fmtSize(totalBytes)} uploaded across ${totalCount} file(s)${state.connection.chunkLimitMb ? ` · ${state.connection.chunkLimitMb} MB chunks` : ''}</span>
      </div>

      ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ''}
      ${buildSettingsPanel()}
      ${buildEmptyTrashModal(view.trashCount)}
      ${buildPromptModal()}
      ${buildUpdateModal()}
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
    const newFolderBtn = document.getElementById('new-folder-btn');
    if (newFolderBtn) newFolderBtn.addEventListener('click', newFolder);
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
        const dropped = Array.from(e.dataTransfer.files);
        const paths = dropped.map((f) => window.api.pathForFile(f)).filter(Boolean);
        if (paths.length) startUpload(paths);
        else if (dropped.length) showToast('Could not resolve the dropped file(s) on disk');
      });
    }

    // detail pane actions
    const actPreview = document.getElementById('act-preview');
    if (actPreview) actPreview.addEventListener('click', previewSelected);
    const previewTrigger = document.getElementById('detail-preview-trigger');
    if (previewTrigger) previewTrigger.addEventListener('click', previewSelected);
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
    const newTagChip = document.getElementById('add-new-tag-chip');
    if (newTagChip) newTagChip.addEventListener('click', () => {
      const targetFile = view.selFile;
      openPrompt({
        title: 'New tag', value: '', submitLabel: 'Create',
        onSubmit: (val) => {
          const id = createCustomTag(val);
          if (id && targetFile) apiCall(window.api.addTag(targetFile.id, id));
          else render();
        },
      });
    });
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
    const chunkDec = document.getElementById('chunk-decrement');
    if (chunkDec) chunkDec.addEventListener('click', () => stepChunkSize(-1));
    const chunkInc = document.getElementById('chunk-increment');
    if (chunkInc) chunkInc.addEventListener('click', () => stepChunkSize(1));
    const testBtn = document.getElementById('test-connection-btn');
    if (testBtn) testBtn.addEventListener('click', testConnectionAction);
    const saveBtn = document.getElementById('settings-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', saveSettingsForm);
    const updateCheckBtn = document.getElementById('update-check-btn');
    if (updateCheckBtn) updateCheckBtn.addEventListener('click', manualCheckForUpdates);
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

    const updOverlay = document.getElementById('update-overlay');
    if (updOverlay) updOverlay.addEventListener('click', (e) => { if (e.target.id === 'update-overlay') dismissUpdatePrompt(); });
    const updCancel = document.getElementById('update-cancel');
    if (updCancel) updCancel.addEventListener('click', dismissUpdatePrompt);
    const updConfirm = document.getElementById('update-confirm');
    if (updConfirm) updConfirm.addEventListener('click', downloadUpdate);
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
    const picked = Array.from(e.target.files);
    const paths = picked.map((f) => window.api.pathForFile(f)).filter(Boolean);
    if (paths.length) startUpload(paths);
    else if (picked.length) showToast('Could not resolve the selected file(s) on disk');
    e.target.value = '';
  });

  window.api.onUpdateAvailable(promptUpdateAvailable);

  init();
})();
