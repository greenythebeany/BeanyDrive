// Builds mobile/www from the shared sources.
//
// The desktop app loads renderer/ off disk as plain files with no build step;
// the mobile app can't, because core/ is CommonJS and has to be bundled for the
// WebView. So this copies the renderer verbatim and bundles only the entry that
// sets up window.api, keeping renderer.js byte-identical between platforms.

import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const www = path.join(here, 'www');

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });

// Shared UI, unchanged.
await cp(path.join(repo, 'renderer'), www, { recursive: true });

// The Node/Electron half, replaced by mobile/src/main.js.
await build({
  entryPoints: [path.join(here, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome90'],
  outfile: path.join(www, 'app-core.js'),
  // The Capacitor adapters sit in ../platform next to the Node one, which is
  // outside this package — so Node's own resolution would never find
  // mobile/node_modules from there.
  nodePaths: [path.join(here, 'node_modules')],
  logLevel: 'info',
});

// Android-only styling, layered after the shared stylesheet so it can override.
await cp(path.join(here, 'src', 'mobile.css'), path.join(www, 'mobile.css'));

// window.api has to exist before renderer.js runs, so the bundle goes first.
const indexPath = path.join(www, 'index.html');
let html = await readFile(indexPath, 'utf8');
if (!html.includes('app-core.js')) {
  html = html.replace('<script src="ooxml.js"></script>', '<script src="app-core.js"></script>\n  <script src="ooxml.js"></script>');
}
if (!html.includes('mobile.css')) {
  html = html.replace('<link rel="stylesheet" href="style.css">',
    '<link rel="stylesheet" href="style.css">\n<link rel="stylesheet" href="mobile.css">');
}
// The desktop titlebar is Electron window chrome; there's nothing to minimise
// or close on Android, and the status bar sits where it would be. mobile.css
// carries the !important that actually beats .titlebar's display:flex.
html = html.replace('<div class="titlebar">', '<div class="titlebar" hidden>');
html = html.replace('<meta charset="utf-8">',
  '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">');
await writeFile(indexPath, html);

await writeFile(path.join(www, '.gitignore'), '*\n');
console.log('built mobile/www');
