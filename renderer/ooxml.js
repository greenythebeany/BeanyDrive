// Word (.docx) and PowerPoint (.pptx) preview.
//
// Both formats are a ZIP of XML parts, and Chromium can already inflate raw
// deflate (DecompressionStream) and parse XML (DOMParser) — so this reads them
// directly instead of vendoring another renderer next to pdf.js.
//
// What you get is a faithful *reading* view, not a pixel-accurate one: Word
// gives you the document's structure and inline images with no page breaks,
// PowerPoint places each shape at its real position on the slide. Fonts,
// themes, effects, animations, SmartArt and charts are not reproduced.
//
// Everything drawn here comes from an untrusted file, so all text goes through
// esc() and every attribute is either a number this file parsed or a blob: URL
// it created. No markup from the document is ever passed through.
(() => {
  const EMU_PER_POINT = 12700;
  const SLIDE_WIDTH_PX = 960; // slides render at this width, then scale to fit

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---- zip ---------------------------------------------------------------

  async function inflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function readZip(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const decoder = new TextDecoder();

    // The end-of-central-directory record is last, but a trailing comment can
    // push it back by up to 64 KB, so scan backwards for its signature.
    let eocd = -1;
    const floor = Math.max(0, buffer.byteLength - 22 - 0xffff);
    for (let i = buffer.byteLength - 22; i >= floor; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('not a valid Office file (no zip directory found)');

    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (ptr + 46 > buffer.byteLength || view.getUint32(ptr, true) !== 0x02014b50) break;
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      entries.set(name, { method, compSize, localOffset });
      ptr += 46 + nameLen + extraLen + commentLen;
    }

    return {
      has: (name) => entries.has(name),
      names: () => [...entries.keys()],
      async read(name) {
        const e = entries.get(name);
        if (!e) return null;
        if (e.compSize === 0xffffffff || e.localOffset === 0xffffffff) {
          throw new Error('zip64 archives are not supported');
        }
        const lo = e.localOffset;
        if (view.getUint32(lo, true) !== 0x04034b50) throw new Error(`corrupt entry: ${name}`);
        // Local header name/extra lengths can differ from the central ones.
        const start = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true);
        const raw = bytes.subarray(start, start + e.compSize);
        if (e.method === 0) return raw.slice();
        if (e.method === 8) return inflateRaw(raw);
        throw new Error(`unsupported zip compression method ${e.method}`);
      },
      async readXml(name) {
        const data = await this.read(name);
        if (!data) return null;
        const doc = new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error(`malformed XML in ${name}`);
        return doc;
      },
    };
  }

  // ---- XML helpers -------------------------------------------------------
  // Matched on localName so a file using different namespace prefixes than the
  // usual w:/a:/p: still reads correctly.

  function kids(el, localName) {
    const out = [];
    for (let c = el && el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === localName) out.push(c);
    }
    return out;
  }
  function kid(el, localName) { return kids(el, localName)[0] || null; }
  function descend(el, ...path) {
    let cur = el;
    for (const step of path) { cur = kid(cur, step); if (!cur) return null; }
    return cur;
  }
  function all(el, localName) {
    return el ? Array.from(el.getElementsByTagNameNS('*', localName)) : [];
  }
  function attr(el, localName) {
    if (!el) return null;
    for (const a of el.attributes) if (a.localName === localName) return a.value;
    return null;
  }
  function num(value, fallback = 0) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  // Colours are the one styling value taken from the document, so it's checked
  // against the exact shape a hex colour has before reaching a style attribute.
  function hexColor(value) {
    return /^[0-9A-Fa-f]{6}$/.test(String(value || '')) ? `#${value}` : null;
  }

  const MIME_BY_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', tiff: 'image/tiff', svg: 'image/svg+xml',
    emf: null, wmf: null, // vector metafiles browsers can't display
  };

  // Relationship id -> target part path, resolved relative to the part's folder.
  async function readRels(zip, partPath) {
    const dir = partPath.slice(0, partPath.lastIndexOf('/'));
    const relsPath = `${dir}/_rels/${partPath.slice(partPath.lastIndexOf('/') + 1)}.rels`;
    const map = new Map();
    let doc = null;
    try { doc = await zip.readXml(relsPath); } catch (e) { return map; }
    if (!doc) return map;
    for (const rel of all(doc.documentElement, 'Relationship')) {
      const id = attr(rel, 'Id');
      const target = attr(rel, 'Target') || '';
      const mode = attr(rel, 'TargetMode');
      if (!id) continue;
      if (mode === 'External') { map.set(id, { external: true, target }); continue; }
      const resolved = target.startsWith('/')
        ? target.slice(1)
        : `${dir}/${target}`.replace(/\/\.\//g, '/').replace(/[^/]+\/\.\.\//g, '');
      map.set(id, { external: false, target: resolved });
    }
    return map;
  }

  // Turns an embedded image part into a blob: URL. Returned urls are handed
  // back to the caller so they can be revoked when the preview closes.
  async function imageUrl(zip, rels, relId, objectUrls) {
    const rel = rels.get(relId);
    if (!rel || rel.external) return null;
    const ext = rel.target.slice(rel.target.lastIndexOf('.') + 1).toLowerCase();
    if (!(ext in MIME_BY_EXT)) return null;
    const mime = MIME_BY_EXT[ext];
    if (!mime) return null;
    let data;
    try { data = await zip.read(rel.target); } catch (e) { return null; }
    if (!data) return null;
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    objectUrls.push(url);
    return url;
  }

  // ---- .docx -------------------------------------------------------------

  function runHtml(run) {
    const props = kid(run, 'rPr');
    const style = [];
    let text = '';

    for (let c = run.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === 't') text += c.textContent;
      else if (c.localName === 'tab') text += '\t';
      else if (c.localName === 'br') text += '\n';
    }
    if (!text) return '';

    let html = esc(text).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;');
    if (props) {
      // In OOXML a toggle element present without w:val="0" means "on".
      const on = (name) => {
        const el = kid(props, name);
        if (!el) return false;
        const v = attr(el, 'val');
        return v !== '0' && v !== 'false' && v !== 'none';
      };
      if (on('b')) html = `<strong>${html}</strong>`;
      if (on('i')) html = `<em>${html}</em>`;
      if (on('u')) html = `<u>${html}</u>`;
      if (on('strike')) html = `<s>${html}</s>`;
      const color = hexColor(attr(kid(props, 'color'), 'val'));
      if (color) style.push(`color:${color}`);
      const halfPoints = num(attr(kid(props, 'sz'), 'val'), 0);
      if (halfPoints > 0) style.push(`font-size:${(halfPoints / 2).toFixed(1)}pt`);
    }
    return style.length ? `<span style="${style.join(';')}">${html}</span>` : html;
  }

  async function paragraphHtml(p, ctx) {
    const props = kid(p, 'pPr');
    const styleName = attr(kid(props, 'pStyle'), 'val') || '';
    const heading = /^Heading(\d)$/i.exec(styleName) || /^Title$/i.test(styleName);
    const align = attr(kid(props, 'jc'), 'val');
    const alignStyle = ['center', 'right', 'both'].includes(align)
      ? ` style="text-align:${align === 'both' ? 'justify' : align}"` : '';

    let inner = '';
    for (let c = p.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === 'r') inner += runHtml(c);
      else if (c.localName === 'hyperlink') {
        // Rendered as emphasised text, not a live link: a preview shouldn't
        // navigate anywhere on a click.
        const linkText = kids(c, 'r').map(runHtml).join('');
        if (linkText) inner += `<span class="ooxml-link">${linkText}</span>`;
      }
    }

    // Inline images sit inside runs, but pull them out separately so an
    // image-only paragraph still renders.
    for (const blip of all(p, 'blip')) {
      const url = await imageUrl(ctx.zip, ctx.rels, attr(blip, 'embed'), ctx.objectUrls);
      if (url) inner += `<img class="ooxml-img" src="${url}" alt="">`;
    }

    if (!inner) return '<p class="ooxml-p ooxml-empty"></p>';
    if (heading) {
      const level = Array.isArray(heading) ? Math.min(6, Math.max(1, Number(heading[1]))) : 1;
      return `<h${level} class="ooxml-h"${alignStyle}>${inner}</h${level}>`;
    }
    const isListItem = !!kid(props, 'numPr');
    return isListItem
      ? `<li class="ooxml-li">${inner}</li>`
      : `<p class="ooxml-p"${alignStyle}>${inner}</p>`;
  }

  async function tableHtml(tbl, ctx) {
    let rows = '';
    for (const tr of kids(tbl, 'tr')) {
      let cells = '';
      for (const tc of kids(tr, 'tc')) {
        let cellInner = '';
        for (const p of kids(tc, 'p')) cellInner += await paragraphHtml(p, ctx);
        cells += `<td class="ooxml-td">${cellInner}</td>`;
      }
      rows += `<tr>${cells}</tr>`;
    }
    return `<table class="ooxml-table">${rows}</table>`;
  }

  async function renderDocx(buffer) {
    const zip = readZip(buffer);
    if (!zip.has('word/document.xml')) {
      throw new Error('no Word document part inside — is this really a .docx?');
    }
    const doc = await zip.readXml('word/document.xml');
    const ctx = { zip, rels: await readRels(zip, 'word/document.xml'), objectUrls: [] };
    const body = kid(doc.documentElement, 'body');
    if (!body) throw new Error('Word document has no body');

    let html = '';
    let openList = false;
    for (let node = body.firstElementChild; node; node = node.nextElementSibling) {
      let piece = '';
      if (node.localName === 'p') piece = await paragraphHtml(node, ctx);
      else if (node.localName === 'tbl') piece = await tableHtml(node, ctx);
      else continue;

      // Consecutive list paragraphs are wrapped in a single <ul>.
      const isItem = piece.startsWith('<li');
      if (isItem && !openList) { html += '<ul class="ooxml-ul">'; openList = true; }
      if (!isItem && openList) { html += '</ul>'; openList = false; }
      html += piece;
    }
    if (openList) html += '</ul>';

    const words = (body.textContent || '').trim().split(/\s+/).filter(Boolean).length;
    return {
      html: `<div class="ooxml-doc">${html}</div>`,
      objectUrls: ctx.objectUrls,
      summary: `${words.toLocaleString()} words`,
    };
  }

  // ---- .pptx -------------------------------------------------------------

  function shapeBox(sp, scale) {
    const xfrm = descend(sp, 'spPr', 'xfrm') || descend(sp, 'grpSpPr', 'xfrm');
    const off = kid(xfrm, 'off');
    const ext = kid(xfrm, 'ext');
    if (!off || !ext) return null;
    return {
      left: num(attr(off, 'x')) * scale,
      top: num(attr(off, 'y')) * scale,
      width: num(attr(ext, 'cx')) * scale,
      height: num(attr(ext, 'cy')) * scale,
    };
  }

  function boxStyle(box) {
    return `left:${box.left.toFixed(1)}px;top:${box.top.toFixed(1)}px;` +
      `width:${box.width.toFixed(1)}px;height:${box.height.toFixed(1)}px`;
  }

  function textBodyHtml(txBody, pxPerPoint) {
    let html = '';
    for (const p of kids(txBody, 'p')) {
      const align = attr(kid(p, 'pPr'), 'algn');
      const alignCss = { ctr: 'center', r: 'right', just: 'justify' }[align] || 'left';
      let line = '';
      for (let c = p.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName === 'br') { line += '<br>'; continue; }
        if (c.localName !== 'r') continue;
        const props = kid(c, 'rPr');
        const text = kid(c, 't');
        if (!text) continue;
        let piece = esc(text.textContent);
        const style = [];
        if (props) {
          if (attr(props, 'b') === '1') piece = `<strong>${piece}</strong>`;
          if (attr(props, 'i') === '1') piece = `<em>${piece}</em>`;
          if (attr(props, 'u') && attr(props, 'u') !== 'none') piece = `<u>${piece}</u>`;
          const sz = num(attr(props, 'sz'), 0); // hundredths of a point
          if (sz > 0) style.push(`font-size:${((sz / 100) * pxPerPoint).toFixed(1)}px`);
          const color = hexColor(attr(kid(descend(props, 'solidFill'), 'srgbClr'), 'val'));
          if (color) style.push(`color:${color}`);
        }
        line += style.length ? `<span style="${style.join(';')}">${piece}</span>` : piece;
      }
      html += `<div class="ooxml-slide-p" style="text-align:${alignCss}">${line || '&nbsp;'}</div>`;
    }
    return html;
  }

  async function slideHtml(zip, slidePath, index, dims) {
    const doc = await zip.readXml(slidePath);
    const rels = await readRels(zip, slidePath);
    const objectUrls = [];
    const tree = descend(doc.documentElement, 'cSld', 'spTree');
    if (!tree) return { html: '', objectUrls };

    let inner = '';
    // Walks groups too, so grouped shapes aren't silently dropped.
    const walk = async (parent) => {
      for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
        if (node.localName === 'grpSp') { await walk(node); continue; }

        if (node.localName === 'pic') {
          const box = shapeBox(node, dims.scale);
          const blip = kid(descend(node, 'blipFill'), 'blip');
          const url = blip ? await imageUrl(zip, rels, attr(blip, 'embed'), objectUrls) : null;
          if (url && box) {
            inner += `<img class="ooxml-slide-img" style="${boxStyle(box)}" src="${url}" alt="">`;
          }
          continue;
        }

        if (node.localName === 'sp') {
          const txBody = kid(node, 'txBody');
          if (!txBody || !(txBody.textContent || '').trim()) continue;
          const box = shapeBox(node, dims.scale);
          const text = textBodyHtml(txBody, dims.pxPerPoint);
          inner += box
            ? `<div class="ooxml-slide-tx" style="${boxStyle(box)}">${text}</div>`
            : `<div class="ooxml-slide-tx ooxml-slide-loose">${text}</div>`;
        }
      }
    };
    await walk(tree);

    return {
      html: `
        <div class="ooxml-slide-wrap">
          <div class="ooxml-slide" style="width:${dims.width}px;height:${dims.height.toFixed(1)}px">${inner}</div>
          <div class="ooxml-slide-no">slide ${index}</div>
        </div>`,
      objectUrls,
    };
  }

  async function renderPptx(buffer) {
    const zip = readZip(buffer);
    const presentation = zip.has('ppt/presentation.xml') ? await zip.readXml('ppt/presentation.xml') : null;
    if (!presentation) throw new Error('no PowerPoint presentation part inside — is this really a .pptx?');

    // Slide order comes from the presentation's relationships; falling back to
    // numeric filename order only if that's missing.
    const rels = await readRels(zip, 'ppt/presentation.xml');
    const ordered = [];
    for (const sldId of all(descend(presentation.documentElement, 'sldIdLst'), 'sldId')) {
      const rel = rels.get(attr(sldId, 'id'));
      if (rel && !rel.external && zip.has(rel.target)) ordered.push(rel.target);
    }
    if (!ordered.length) {
      ordered.push(...zip.names()
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => num(a.match(/(\d+)/)[1]) - num(b.match(/(\d+)/)[1])));
    }
    if (!ordered.length) throw new Error('presentation contains no slides');

    const sldSz = kid(presentation.documentElement, 'sldSz');
    const cx = num(attr(sldSz, 'cx'), 9144000); // default 10in x 7.5in
    const cy = num(attr(sldSz, 'cy'), 6858000);
    const dims = {
      width: SLIDE_WIDTH_PX,
      height: (cy / cx) * SLIDE_WIDTH_PX,
      scale: SLIDE_WIDTH_PX / cx,
      pxPerPoint: SLIDE_WIDTH_PX / (cx / EMU_PER_POINT),
    };

    let html = '';
    const objectUrls = [];
    for (let i = 0; i < ordered.length; i++) {
      const slide = await slideHtml(zip, ordered[i], i + 1, dims);
      html += slide.html;
      objectUrls.push(...slide.objectUrls);
    }
    return {
      html: `<div class="ooxml-slides">${html}</div>`,
      objectUrls,
      summary: `${ordered.length} slide${ordered.length === 1 ? '' : 's'}`,
    };
  }

  // ---- entry point -------------------------------------------------------

  // Only the OOXML formats are readable this way. The pre-2007 binary .doc and
  // .ppt aren't zips at all, and .odt/.odp are a different format entirely —
  // all of them get a straight answer instead of a parse error.
  const UNSUPPORTED = {
    doc: 'Legacy .doc files (Word 97–2003) can\'t be previewed — only .docx.',
    ppt: 'Legacy .ppt files (PowerPoint 97–2003) can\'t be previewed — only .pptx.',
    odt: 'OpenDocument .odt files can\'t be previewed — only .docx.',
    odp: 'OpenDocument .odp files can\'t be previewed — only .pptx.',
    rtf: 'RTF files can\'t be previewed.',
    xls: 'Legacy .xls files can\'t be previewed.',
  };

  async function renderOffice(arrayBuffer, filename) {
    const ext = String(filename || '').slice(String(filename).lastIndexOf('.') + 1).toLowerCase();
    if (UNSUPPORTED[ext]) throw new Error(UNSUPPORTED[ext]);
    if (ext === 'docx' || ext === 'docm') return renderDocx(arrayBuffer);
    if (ext === 'pptx' || ext === 'pptm') return renderPptx(arrayBuffer);
    throw new Error(`No preview for .${ext} files`);
  }

  window.ooxml = { renderOffice };
})();
