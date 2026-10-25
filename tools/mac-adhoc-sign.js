// electron-builder afterPack hook: ad-hoc signs the macOS app bundle.
//
// There's no Apple Developer ID, so package.json sets mac.identity to null and
// electron-builder skips signing. But packing the app (asar, icon, Info.plist)
// invalidates the signature Electron's own binaries shipped with, and Apple
// Silicon refuses to launch code whose signature doesn't match — it reports
// the app as "damaged". An ad-hoc signature ("-") makes the bundle consistent
// again. It is not a Developer ID: Gatekeeper still asks the user to approve
// the app once (see README, "macOS").
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
