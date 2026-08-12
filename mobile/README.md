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

Two measured facts shaped the adapters.

**Discord's CORS policy is asymmetric.** Probed from a browser origin:

| Request | Result |
| --- | --- |
| `GET` | allowed |
| `GET` + `Authorization` | allowed (preflight passes) |
| `POST` / `DELETE` + `Authorization` | blocked |

So reads — metadata, message lookups, CDN chunk downloads — use the WebView's
own `fetch`: real binary, real streaming, nothing on the JS bridge. Only writes
go through CapacitorHttp, where the body must be base64 because the bridge
carries strings. That's why `CapacitorHttp` is **not** enabled in
`capacitor.config.json`: doing so patches `window.fetch` globally and would drag
reads back onto the bridge.

**Files come from the picker as `File` objects, not paths.** `<input type=file>`
in the WebView hands back a `File`, which is a `Blob`, and `Blob.slice()` is
exactly the positional read the chunked upload engine wants. So uploads need no
plugin and no base64 on the read side — `capacitor-files.js` keeps a registry of
picked files and the core's "local path" is a handle into it.

## Status

Working: connect, browse, search/sort, star, tag, rename, trash, restore, empty
trash (with progress), preview (images, PDF, text, Word, PowerPoint), download
via the share sheet, and **upload** — chunked, parallel, with pause, resume,
retry and cancel, the same engine as the desktop.

Uploads write to the app's cache before sharing rather than straight to
Documents: `Directory.Cache` needs no runtime permission under scoped storage,
and the share sheet is how the file reaches Downloads, Drive or anywhere else.

Still missing or weaker than desktop:

- **Folder upload.** Android's picker returns documents, not directory trees.
- **Drag-out**, which has no meaning here.
- **Token storage.** It sits in Preferences (plain SharedPreferences), weaker
  than the desktop's encrypted `safeStorage`. Should move to
  EncryptedSharedPreferences before this is installed anywhere that matters.
- **Background uploads.** Android throttles a backgrounded WebView, so a large
  upload wants a foreground service; without one, leaving the app mid-upload
  pauses it in practice. Resume covers the damage, but it isn't seamless.
- **Auto-update.** APKs are sideloaded, so the in-app check is disabled.

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

`build-apk.bat release` produces a release build — optimised, not debuggable.
**Signing is the separate question.** With no keystore configured it falls back
to Android's debug key, which is fine for your own phone (and lets a release
build install straight over a debug one, since the signature matches) but is
not suitable for distribution or the Play Store. Gradle prints a line saying so
on every such build.

To sign it properly, create a keystore — the passwords are yours to choose, so
run this yourself:

```sh
keytool -genkeypair -v -keystore mobile/android/keystore/beanydrive-release.jks ^
  -alias beanydrive -keyalg RSA -keysize 2048 -validity 10000
```

Then write `mobile/android/keystore/keystore.properties`:

```properties
storeFile=beanydrive-release.jks
storePassword=<the store password you chose>
keyAlias=beanydrive
keyPassword=<the key password you chose>
```

`android/` is git-ignored, so neither file is committed — but keep a backup of
the `.jks` somewhere safe. Lose it and you can never update an app signed with
it; anyone who gets it can sign as you.

### Other commands

```sh
npm run build   # just the web assets -> mobile/www
npm run sync    # build + copy into the native project
npm run open    # open the project in Android Studio
```

`mobile/www` and `mobile/android` are generated and git-ignored.
