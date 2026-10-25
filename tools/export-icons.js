// Renders icon.svg into every PNG the builds use. Run from the repo root:
//   npx electron tools/export-icons.js
//
// Chromium does the rasterising (an SVG drawn onto a canvas), so the output
// matches what the app shows and needs no image library.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'icon.svg'), 'utf8');

// mode 'rounded': the icon as drawn, transparent outside the rounded square.
// mode 'inset':   the same, shrunk to `scale` with transparent margin around it.
// mode 'bleed':   a full black square with the artwork scaled into the middle —
//                 Android launchers apply their own mask, and the splash
//                 screen is a plain black field.
const OUTPUTS = [
  { file: 'icon.png', size: 1024, mode: 'rounded' },
  { file: 'thumbnail.png', size: 512, mode: 'rounded' },
  { file: 'renderer/logo.png', size: 128, mode: 'rounded' },
  // macOS icons sit inside Apple's grid: the shape is ~80% of the canvas with
  // transparent margin, or it looks oversized next to every other Dock icon.
  { file: 'build/icon-mac.png', size: 1024, mode: 'inset', scale: 0.805 },
  { file: 'mobile/assets/icon.png', size: 1024, mode: 'bleed', scale: 0.86 },
  { file: 'mobile/assets/splash.png', size: 2732, mode: 'bleed', scale: 0.26 },
];

function renderer(svgText, size, mode, scale) {
  return `(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svgText).toString('base64'))};
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = ${size};
    const g = c.getContext('2d');
    if (${JSON.stringify(mode)} === 'bleed') {
      g.fillStyle = '#000';
      g.fillRect(0, 0, ${size}, ${size});
      const s = ${size} * ${scale || 1};
      g.drawImage(img, (${size} - s) / 2, (${size} - s) / 2, s, s);
    } else if (${JSON.stringify(mode)} === 'inset') {
      const s = ${size} * ${scale || 1};
      g.drawImage(img, (${size} - s) / 2, (${size} - s) / 2, s, s);
    } else {
      g.drawImage(img, 0, 0, ${size}, ${size});
    }
    return c.toDataURL('image/png').split(',')[1];
  })()`;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  for (const o of OUTPUTS) {
    // The splash uses the artwork without its own black square around it.
    const source = o.file.endsWith('splash.png') ? svg.replace(/<rect width="1932"[^>]*\/>/, '') : svg;
    const b64 = await win.webContents.executeJavaScript(renderer(source, o.size, o.mode, o.scale));
    fs.mkdirSync(path.dirname(path.join(root, o.file)), { recursive: true });
    fs.writeFileSync(path.join(root, o.file), Buffer.from(b64, 'base64'));
    console.log(`${o.file} ${o.size}x${o.size}`);
  }
  app.quit();
});
