const { app } = require('electron');

const REPO = 'greenythebeany/BeanyDrive';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

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

// GitHub releases here aren't tagged with a semver tag (tag_name is just the
// product name) — the version lives in the release title instead, e.g.
// "BeanyDrive v1.0.0 — Discord as your personal cloud drive". Try the tag
// first in case that ever changes, fall back to the title.
async function checkForUpdates() {
  const res = await fetch(API_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BeanyDrive-update-check' },
  });
  if (res.status === 404) return { status: 'up-to-date' };
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
  const release = await res.json();

  const latest = parseSemver(release.tag_name) || parseSemver(release.name);
  const current = parseSemver(app.getVersion());
  if (!latest || !current || !isNewer(latest, current)) return { status: 'up-to-date' };

  return { status: 'available', version: latest.join('.'), url: release.html_url };
}

module.exports = { checkForUpdates };
