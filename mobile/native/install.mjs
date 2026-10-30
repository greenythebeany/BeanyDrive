// Adds BeanyDrive's native plugin to the generated Android project.
//
// mobile/android isn't committed (CI runs `cap add android` fresh), so after
// that this copies BeanyNativePlugin.java in, registers it in MainActivity,
// and adds to the manifest what the plugin needs: the share target and the
// permissions for saving files and backing up the camera. Safe to run twice.

import { copyFile, readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..', 'android', 'app', 'src', 'main');
const pkgDir = path.join(app, 'java', 'dev', 'greenybeany', 'beanydrive');

await mkdir(pkgDir, { recursive: true });
await copyFile(path.join(here, 'BeanyNativePlugin.java'), path.join(pkgDir, 'BeanyNativePlugin.java'));

await writeFile(path.join(pkgDir, 'MainActivity.java'), `package dev.greenybeany.beanydrive;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BeanyNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);

const manifestPath = path.join(app, 'AndroidManifest.xml');
let manifest = await readFile(manifestPath, 'utf8');

const PERMISSIONS = `
    <!-- Camera backup reads new photos and videos -->
    <uses-permission android:name="android.permission.READ_MEDIA_IMAGES" />
    <uses-permission android:name="android.permission.READ_MEDIA_VIDEO" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />
    <!-- Saving downloads on Android 9 and older; newer versions need no permission -->
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
`;
if (!manifest.includes('READ_MEDIA_IMAGES')) {
  manifest = manifest.replace('</manifest>', `${PERMISSIONS}</manifest>`);
}

const SHARE_TARGET = `
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="*/*" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.SEND_MULTIPLE" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="*/*" />
            </intent-filter>
`;
if (!manifest.includes('android.intent.action.SEND"')) {
  const launcher = manifest.indexOf('android.intent.category.LAUNCHER');
  const close = manifest.indexOf('</intent-filter>', launcher);
  if (launcher === -1 || close === -1) throw new Error("Couldn't find MainActivity's launcher intent-filter in the manifest");
  const at = close + '</intent-filter>'.length;
  manifest = manifest.slice(0, at) + SHARE_TARGET + manifest.slice(at);
}

await writeFile(manifestPath, manifest);
console.log('installed BeanyNative plugin into mobile/android');
