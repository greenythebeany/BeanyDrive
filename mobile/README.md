# BeanyDrive for Android (work in progress)

The Android build of BeanyDrive, sharing `core/` with the desktop app. **It is
not finished** — see [Status](#status) before expecting an APK that does
everything the desktop one does.

## How it relates to the desktop app

`renderer/` is shared verbatim — the same `renderer.js`, `style.css` and
`ooxml.js` the Electron app uses. That works because the UI only ever talks to
`window.api`, the surface `preload.js` exposes over IPC. The Android build is a
second implementation of that same contract (`mobile/src/main.js`), backed by
the shared core running inside the WebView instead of a Node process.

```
core/                    protocol, chunking, resume, metadata — no fs, no electron
platform/node-files.js   desktop: real paths, Node fs
platform/capacitor-*.js  android: content URIs, Filesystem/Preferences/native HTTP
mobile/src/main.js       android's main.js + preload.js
```

Three Android constraints shaped the adapters:

- **CORS.** The WebView serves the app from a local scheme, so calls to Discord
  are cross-origin and would be blocked. `capacitor-http.js` routes them through
  native code, where CORS doesn't apply.
- **The bridge is strings.** Request and response bodies cross it as text, so
  binary becomes base64 — a 10 MB chunk is a ~13.3 MB string each way. Fine for
  API calls and metadata, not for chunk uploads.
- **Paths aren't paths.** The system picker returns `content://` URIs. Only the
  adapter interprets them; the core treats a local path as an opaque string.

## Status

Working: connect, load metadata, browse folders, search/sort, star, tag, rename,
trash, restore, empty trash (with progress), preview (images, PDF, text, Word,
PowerPoint), download to Documents + share sheet.

**Not implemented — uploading.** It needs a native Capacitor plugin that POSTs a
byte range of a file as multipart without putting the payload on the JS bridge.
The UI's upload actions currently answer "isn't available on Android yet" rather
than failing silently. Once that plugin exists, the core's pause/resume/retry
logic works unchanged, because it already treats reads and requests as adapters.

Also missing: a real mobile layout (`mobile/src/mobile.css` is a stopgap that
stacks the desktop panes), drag-out (meaningless here), auto-update, and
encrypted token storage — the token currently sits in Preferences, which is
weaker than the desktop's `safeStorage` and should move to
EncryptedSharedPreferences before this is installed anywhere that matters.

## Building

Requires the **Android SDK**, which Android Studio does not install by default —
open Android Studio → SDK Manager and install a platform + build-tools first.

```sh
cd mobile
npm install
npm run build         # bundles core + copies renderer into mobile/www
npx cap add android   # once, scaffolds mobile/android/
npm run sync          # rebuild web assets and copy them into the native project
npm run open          # open in Android Studio to build/run the APK
```

`mobile/www` and `mobile/android` are generated and git-ignored.
