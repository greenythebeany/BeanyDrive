// Update checks + in-app download/install from GitHub releases (same approach
// as Triptych's and BeanyIK's updaters). Instead of sending the user to the
// release page to run the installer by hand while BeanyDrive is still open,
// the installer is downloaded here, verified against electron-builder's
// latest.yml, started, and BeanyDrive quits so the two never fight.
//
// The portable build can't be installed over, so it downloads the new
// portable exe next to the running one and starts that instead.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'greenythebeany/BeanyDrive';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'BeanyDrive-updater' };

function parseSemver(str) {
  const m = String(str || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

// BEANYDRIVE_PRETEND_VERSION lets you test the updater from a dev build.
const currentVersion = () => process.env.BEANYDRIVE_PRETEND_VERSION || app.getVersion();
// Set by electron-builder's portable launcher.
const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || null;

let lastRelease = null;

// GitHub turns the spaces in "BeanyDrive Setup 2.0.0.exe" into dots.
function pickAsset(assets) {
  // macOS: the .dmg built for this Mac's architecture (BeanyDrive-2.0.1-arm64.dmg).
  if (process.platform === 'darwin') {
    return assets.find((a) => new RegExp(`-${process.arch}\\.dmg$`, 'i').test(a.name)) || null;
  }
  if (process.platform !== 'win32') return null;
  if (portableExe()) return assets.find((a) => /\.exe$/i.test(a.name) && !/setup/i.test(a.name)) || null;
  return assets.find((a) => /setup.*\.exe$/i.test(a.name)) || null;
}

// The releases' versions have lived in the title rather than the tag before,
// so both are tried.
async function checkForUpdates() {
  const res = await fetch(API_URL, { headers: HEADERS });
  if (res.status === 404) return { status: 'up-to-date', current: currentVersion() };
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  const release = await res.json();

  const latest = parseSemver(release.tag_name) || parseSemver(release.name);
  const current = parseSemver(currentVersion());
  if (!latest || !current || !isNewer(latest, current)) return { status: 'up-to-date', current: currentVersion() };

  const assets = release.assets || [];
  const asset = pickAsset(assets);
  const yml = assets.find((a) => a.name === (process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml'));
  lastRelease = { asset, yml, version: latest.join('.') };

  return {
    status: 'available',
    version: latest.join('.'),
    current: currentVersion(),
    url: release.html_url,
    notes: String(release.body || '').slice(0, 6000),
    // Only installs in place when packaged and there's a file to grab;
    // otherwise the UI falls back to the release page link.
    canInstall: app.isPackaged && !!asset,
    portable: !!portableExe(),
    platform: process.platform,
    size: (asset && asset.size) || 0,
  };
}

// sha512 for the file from electron-builder's latest.yml, if the release has
// one attached.
async function expectedSha512(name) {
  if (!lastRelease || !lastRelease.yml) return null;
  try {
    const text = await (await fetch(lastRelease.yml.browser_download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] } })).text();
    // latest.yml names the file with spaces/dashes, the release asset with dots.
    const plain = (s) => s.replace(/[\s.-]+/g, '').toLowerCase();
    const block = text.split(/\n(?=\s*- url:)/).find((b) => plain(b).includes(plain(name)));
    // Only a block that names this exact file counts — the top-level sha512
    // belongs to the installer and would fail a portable download.
    const m = block && /sha512:\s*(\S+)/.exec(block);
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

let downloading = null;

async function downloadUpdate(onProgress) {
  if (!lastRelease || !lastRelease.asset) throw new Error('No installer found for this update');
  if (downloading) return downloading;
  const { asset } = lastRelease;
  downloading = (async () => {
    const dir = portableExe() ? path.dirname(portableExe()) : path.join(app.getPath('temp'), 'BeanyDrive-update');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, portableExe() ? `BeanyDrive ${lastRelease.version}.exe` : asset.name);
    const partial = `${target}.part`;

    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const hash = crypto.createHash('sha512');
    const out = fs.createWriteStream(partial);
    let received = 0;
    let lastSent = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        hash.update(value);
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (now - lastSent > 100) { lastSent = now; if (onProgress) onProgress({ received, total }); }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    } catch (err) {
      out.destroy();
      fs.rmSync(partial, { force: true });
      throw err;
    }
    if (onProgress) onProgress({ received, total });

    if (asset.size && received !== asset.size) {
      fs.rmSync(partial, { force: true });
      throw new Error('Downloaded file is incomplete');
    }
    const sha = await expectedSha512(asset.name);
    if (sha && hash.digest('base64') !== sha) {
      fs.rmSync(partial, { force: true });
      throw new Error('Downloaded file failed the checksum check');
    }
    fs.rmSync(target, { force: true });
    fs.renameSync(partial, target);
    return { file: target, verified: !!sha };
  })();
  try {
    return await downloading;
  } finally {
    downloading = null;
  }
}

// Starts the installer (or the new portable exe) detached, then hands off to
// `shutdown`, which must fully close BeanyDrive so nothing of it is still
// running — or holding files open — when the installer gets going.
//
// On macOS there's no installer to run: the .dmg is opened in Finder, where
// dragging BeanyDrive onto Applications replaces the old copy once this one
// has quit.
function installAndQuit(file, shutdown) {
  if (!file || !fs.existsSync(file)) throw new Error('Update file is missing');
  const child = process.platform === 'darwin'
    ? spawn('open', [file], { detached: true, stdio: 'ignore' })
    : spawn(file, [], { detached: true, stdio: 'ignore', cwd: path.dirname(file) });
  child.unref();
  setTimeout(shutdown, 300);
}

module.exports = { checkForUpdates, downloadUpdate, installAndQuit };
