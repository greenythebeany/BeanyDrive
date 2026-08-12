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

```sh
cd mobile
npm install
.\build-apk.bat            # debug APK, installable on your own phone
.\build-apk.bat release    # release APK, needs a keystore (see below)
```

That script rebuilds the web assets, runs `cap sync android`, and then Gradle.
The APK lands in:

```
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Copy it to the phone and install it — Android will ask you to allow installs
from whatever app you opened it with, the same way the desktop build trips
SmartScreen.

### Why the script instead of plain `gradlew`

It sets two things for its own process only, both of which this machine needs
(the same workarounds JellyWave's `build-release.bat` uses):

- **`JAVA_HOME=C:\Program Files\Java\jdk-21`** — some Capacitor libraries ship
  Java 21 bytecode, which an older compiler can't produce, and the JDK on PATH
  here is 11.
- **`TEMP=C:\jtmp`** — the default Windows temp path contains a non-ASCII
  character (the accented username), which breaks the JDK's loopback selector
  pipe.

The SDK is at `D:/AndroidSDK`; Capacitor wrote that into
`android/local.properties` itself.

### Release signing

The debug APK is signed with Android's debug key — fine for your own device,
not for distribution. For a release build, mirror the JellyWave setup: put a
keystore and a `keystore.properties` in `mobile/android/keystore/`, and add the
matching `signingConfigs` block to `android/app/build.gradle`. Generating the
keystore is a `keytool` command with passwords you choose, so it's yours to run.

### Other commands

```sh
npm run build   # just the web assets -> mobile/www
npm run sync    # build + copy into the native project
npm run open    # open the project in Android Studio
```

`mobile/www` and `mobile/android` are generated and git-ignored.
