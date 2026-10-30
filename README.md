<p align="center">
  <img src="thumbnail.png" width="140" alt="BeanyDrive icon">
</p>

<h1 align="center">BeanyDrive</h1>

<p align="center">
  A desktop and Android client that uses a Discord text channel as personal cloud storage — two interface styles, keyboard-driven, built with Electron and Capacitor.
</p>

<p align="center">
  <a href="#showcase">Showcase</a> ·
  <a href="#features">Features</a> ·
  <a href="#getting-started">Installation</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#upload-and-download-speed">Speed</a> ·
  <a href="#notes">Notes</a>
</p>

<p align="center">
  <a href="https://github.com/Greenythebeany/BeanyDrive/releases">
    <img src="download_icon.png" alt="Download BeanyDrive" height="160">
  </a>
</p>

---

BeanyDrive is GreenyBeany's Electron sibling to
[DiscordCloudStorage](https://github.com/Greenythebeany/DiscordCloudStorage) — same
idea (a Discord bot + channel become your storage backend: large files are
split into chunks, uploaded as attachments, and reassembled on download; a
pinned JSON message in the channel is the index, so nothing lives only on
your machine), rebuilt as a proper desktop app.

BeanyDrive talks to Discord purely over REST (no gateway/WebSocket
connection) — every operation it needs (send a message + attachment, list
pins, fetch/delete a message) has a REST endpoint, and REST message fetches
always return full content regardless of the privileged **Message Content
Intent**. So there's one less toggle to flip when creating your bot.

## What's new in 2.1

- **End-to-end encryption** (optional, Settings → Security): file contents
  are encrypted on your device with AES-256-GCM before upload. Only chunks of
  scrambled bytes reach Discord, and the passphrase never leaves your devices.
- **Index backups and Check drive** (Settings → Drive health): earlier copies
  of the file index are kept in the channel and can be restored; Check drive
  finds files with missing chunks and recovers files the index lost, or
  rebuilds a drive whose index is gone.
- **Duplicate detection**: uploading a file that's already in the drive links
  the existing chunks instead of sending it again.
- **Video streaming**: videos play as they download and seek without fetching
  the whole file, on desktop and Android. Videos get thumbnails too.
- **Storage overview**: sizes by type and folder, the largest files, what's in
  Trash, and what encryption and dedup cover. Click *Stored on Discord* in the
  sidebar.
- **Android**: downloads save straight to the phone (photos and videos to the
  gallery, everything else to Download/BeanyDrive), **Share → BeanyDrive**
  from any app, and optional **camera backup** of new photos and videos.
- **Tests**: the drive core has unit tests (`npm test`) against an in-memory
  Discord, run in CI on every pull request.

## What's new in 2.0

- **A complete redesign** with two interface styles to pick from in
  Settings → Appearance: **Studio** (clean panels and pill buttons, in the
  style of BeanyIK) and **Nothing** (monochrome, dot-matrix headings, one red
  accent, in the style of Triptych — the default). Both come in light and
  dark.
- **A new icon**, kept as `icon.svg`; `npx electron tools/export-icons.js`
  regenerates every PNG from it.
- **A real phone layout** on Android: app bar, bottom navigation, a + button,
  action sheets, long-press to select, and the back button walking up folders.
- **Multi-select and bulk actions**, right-click menus, moving files between
  folders, renaming folders, type filters, drive-wide search, Undo after
  trashing.
- **Faster transfers**: three files upload at once, downloads and previews
  fetch six chunks at a time, the client paces itself on Discord's rate-limit
  headers instead of bouncing off 429s, and files that finish together share
  one metadata save.
- **In-app updates**: the new version downloads inside the app, is checked
  against the release's SHA-512, and installs on one click.
- A snappier UI: only the parts of the window that changed are redrawn.

## Showcase

<p align="center">
  <img src="docs/screenshots/drive-dark.png" alt="BeanyDrive in the Studio style, dark theme" width="900">
</p>

<p align="center"><i>
  Studio style: folder tree, tags and type filters on the left, the selected
  file's thumbnail, details and actions on the right.
</i></p>

### Two styles, light and dark

<table>
<tr>
<td width="50%"><img src="docs/screenshots/drive-light.png" alt="Studio, light"></td>
<td width="50%"><img src="docs/screenshots/nothing-dark.png" alt="Nothing, dark"></td>
</tr>
<tr>
<td align="center">Studio · light</td>
<td align="center">Nothing · dark</td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/grid-view.png" alt="Studio grid view"></td>
<td width="50%"><img src="docs/screenshots/nothing-light.png" alt="Nothing, light, grid view"></td>
</tr>
<tr>
<td align="center">Studio · grid</td>
<td align="center">Nothing · light grid</td>
</tr>
</table>

### Select, act, move

<p align="center">
  <img src="docs/screenshots/multi-select.png" alt="Multi-select with the right-click menu open" width="900">
</p>

### Transfers and updates

<table>
<tr>
<td width="50%"><img src="docs/screenshots/transfers.png" alt="Three uploads running at once"></td>
<td width="50%"><img src="docs/screenshots/update.png" alt="In-app update dialog"></td>
</tr>
<tr>
<td align="center">Three files uploading at once</td>
<td align="center">Updates download and install in the app</td>
</tr>
</table>

### Settings

<table>
<tr>
<td width="50%"><img src="docs/screenshots/settings.png" alt="Settings, Studio style"></td>
<td width="50%"><img src="docs/screenshots/settings-nothing.png" alt="Settings, Nothing style"></td>
</tr>
</table>

### Thumbnails as you scroll

<p align="center">
  <img src="docs/screenshots/thumbnails-grid.png" alt="Grid view with image and PDF thumbnails loaded for what's on screen" width="900">
</p>

### Encryption and drive health

<table>
<tr>
<td width="50%"><img src="docs/screenshots/security.png" alt="Security settings, drive unlocked"></td>
<td width="50%"><img src="docs/screenshots/security-setup.png" alt="Turning on encryption"></td>
</tr>
<tr>
<td align="center">Encrypted drive, unlocked on this device</td>
<td align="center">Turning encryption on</td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/drive-health.png" alt="Check drive report and index backups"></td>
<td width="50%"><img src="docs/screenshots/storage.png" alt="Storage overview"></td>
</tr>
<tr>
<td align="center">Check drive and index backups</td>
<td align="center">Storage overview</td>
</tr>
</table>

### In-app preview

Images, PDFs (rendered page by page via pdf.js), video, audio, text/code and
Word/PowerPoint open full-window without a Save As dialog:

<table>
<tr>
<td width="33%"><img src="docs/screenshots/preview-image.png" alt="Image preview"></td>
<td width="33%"><img src="docs/screenshots/preview-pdf.png" alt="PDF preview"></td>
<td width="33%"><img src="docs/screenshots/preview-text.png" alt="Text preview"></td>
</tr>
<tr>
<td align="center">Image</td>
<td align="center">PDF</td>
<td align="center">Text</td>
</tr>
</table>

### On Android

<table>
<tr>
<td width="25%"><img src="docs/screenshots/mobile-studio.png" alt="Android, Studio light"></td>
<td width="25%"><img src="docs/screenshots/mobile-nothing.png" alt="Android, Nothing dark"></td>
<td width="25%"><img src="docs/screenshots/mobile-sheet.png" alt="Android file sheet"></td>
<td width="25%"><img src="docs/screenshots/mobile-select.png" alt="Android multi-select"></td>
</tr>
<tr>
<td align="center">Studio</td>
<td align="center">Nothing</td>
<td align="center">File sheet</td>
<td align="center">Long-press select</td>
</tr>
<tr>
<td width="25%"><img src="docs/screenshots/mobile-camera.png" alt="Android security and camera backup settings"></td>
<td width="25%"><img src="docs/screenshots/mobile-storage.png" alt="Android storage overview"></td>
<td width="25%"><img src="docs/screenshots/mobile-health.png" alt="Android drive health"></td>
<td width="25%"></td>
</tr>
<tr>
<td align="center">Encryption and camera backup</td>
<td align="center">Storage</td>
<td align="center">Drive health</td>
<td></td>
</tr>
</table>

## Features

- **Discord-backed storage** — files are chunked to fit your server's
  upload limit, sent as attachments, and reassembled on download; metadata
  (names, paths, chunk message IDs) lives as a pinned JSON attachment in the
  channel itself
- **Two interface styles** — Studio and Nothing, each in light, dark or
  system theme, with nine accent colours (or the style's own) and
  comfortable/compact density, all applied live
- **Folders** — a folder tree in the sidebar, clickable breadcrumbs, create,
  rename (instant: folders are metadata only) and delete
- **Select many, act once** — Ctrl/Shift-click, Shift+arrows, Ctrl+A or
  long-press on Android; star, download, move or trash the whole selection.
  Bulk actions save the index once, not once per file
- **Move to…** — move files between folders from a folder picker, with a
  shortcut to make a new folder on the way
- **Star, tag, and Trash** — star files, tag them (`design`/`work`/`personal`
  or your own), soft-delete to Trash with **Undo**, restore, or **Empty
  Trash** to permanently remove the chunks from Discord
- **Search, filter, sort** — search covers the whole drive from My Drive
  (and shows where each hit lives); filter by Images, Documents, Video &
  audio, Archives or Code; sort by name, date, size or type, either direction
- **Drag and drop** — drop files anywhere on the window to upload into the
  folder you're in, or use **New → Upload folder** to keep a folder's
  structure; uploads that hit Discord's size limit retry at a smaller chunk
  size
- **Uploads built for big files** — three files at once, each chunked and
  sent in parallel within a shared budget; the transfers card shows combined
  speed and per-file progress, and every upload can be **paused**,
  **resumed**, **retried** after a failure, or canceled. Pausing or failing
  keeps the chunks that already landed, so picking it up again re-sends only
  what's missing
- **Drag out to the desktop** — drag a file from the list straight into
  Explorer or Finder. Files live on Discord, so the first drag fetches a local
  copy and the drag works from then on
- **In-app preview** — images, PDFs, video, audio, text/code, Word and
  PowerPoint (`p`, double-click, or the Preview button). The thumbnail in the
  details panel and the full preview share one download. Video and audio
  stream: playback starts with the first chunk, and seeking fetches only the
  chunks it lands in
- **End-to-end encryption** — optional, per drive. See
  [Encryption](#encryption)
- **Index backups and Check drive** — see [Drive health](#drive-health)
- **Duplicate detection** — every upload is hashed first; content already in
  the drive is linked instead of re-sent, and chunks shared by duplicates are
  only deleted once nothing uses them
- **In-app updates** — a background check on launch; the update downloads
  with progress, is verified against the release's `latest.yml` checksum,
  and installs on **Restart & install**. The portable build downloads the new
  portable `.exe` beside the old one and starts it
- **Keyboard-driven** — see [shortcuts](#keyboard-shortcuts), or press `?`
- Bot token stored encrypted at rest via Electron's `safeStorage` —
  Windows DPAPI, macOS Keychain, or the Linux Secret Service if one's
  running; falls back to plain storage otherwise, same as any other
  Electron app

## Getting started

### 1. Create a Discord bot (one-time, ~5 minutes)

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications),
   **New Application**, name it (e.g. `BeanyDrive`).
2. Open the **Bot** tab → **Reset Token** → copy the token. You'll paste
   this into BeanyDrive's Settings, not a config file.
3. Under **OAuth2 → URL Generator**: scope **bot**, permissions **Send
   Messages**, **Read Message History**, **Manage Messages**, **Attach
   Files**. Open the generated URL and add the bot to your server.
4. In Discord, enable **Settings → Advanced → Developer Mode**, then
   right-click the text channel you want to use as storage and **Copy
   Channel ID**.

### 2. Install & run

**Option A: Download (recommended)** — grab the latest build for your system
from the [Releases page](https://github.com/Greenythebeany/BeanyDrive/releases).
No Node/npm needed. From 2.0 on, later versions update from inside the app.

| System | File |
| ------ | ---- |
| Windows | `BeanyDrive.Setup.<version>.exe` (installer) or `BeanyDrive.<version>.exe` (portable) |
| macOS, Apple Silicon (M1 and later) | `BeanyDrive-<version>-arm64.dmg` |
| macOS, Intel | `BeanyDrive-<version>-x64.dmg` |
| Linux | `BeanyDrive-<version>.AppImage` |
| Android | `BeanyDrive-<version>-android.apk` |

> **Windows will show a blue "Windows protected your PC" SmartScreen
> warning the first time you run it.** That's expected for any small,
> unsigned app — it's not a virus detection. Click **More info**, then
> **Run anyway**.

#### macOS

Open the `.dmg` and drag **BeanyDrive** onto **Applications**. Not sure
which file? Apple menu → **About This Mac**: "Chip: Apple M…" means `arm64`,
"Processor: Intel" means `x64`.

BeanyDrive isn't notarized by Apple (that needs a paid Apple Developer
account), so **the first launch is blocked**: macOS says it "can't be opened"
or "can't verify" the app. Allow it once:

1. Try to open BeanyDrive, and click **Done** (or **OK**) on the warning.
2. Open **System Settings → Privacy & Security**, scroll down to the message
   about BeanyDrive, and click **Open Anyway**. Confirm with your password.

Or, in Terminal:

```sh
xattr -cr /Applications/BeanyDrive.app
```

After that it opens normally, including after in-app updates. On macOS an
update downloads the new `.dmg`, quits BeanyDrive and opens the disk image;
drag BeanyDrive onto Applications again and choose **Replace**.

The window uses macOS's own red/yellow/green buttons, and the usual Mac
shortcuts work: **Cmd+Delete** moves to Trash, **Cmd+,** opens Settings,
**Cmd+F** searches.

**Option B: Run from source**

```sh
npm install
npm start
```

Either way: open **Settings** (the sliders icon in the top bar, or press
`,`), paste the bot token and channel ID, and click **Save & connect**. Use
**Test connection** first if you just want to verify them without saving.

### 3. Build a standalone app (optional)

```sh
npm run dist
```

On Windows this produces an NSIS installer, a portable `.exe` and
`latest.yml` in `dist/`. Attach all three to the GitHub release: the in-app
updater looks for the `Setup` installer (or the portable `.exe`) and checks
it against `latest.yml`. On Linux it produces an `.AppImage`, on a Mac the
two `.dmg` files.

**Releasing.** Build the Windows files locally and create the GitHub
release with them, then push a `release/<version>` branch. CI builds the
rest and attaches it to that release: the Android APK
(`android-release-build.yml`), the Linux AppImage (`linux-release-build.yml`)
and both macOS disk images (`mac-release-build.yml`, on a macOS runner).

### 4. Android

There's an Android build in [`mobile/`](mobile/README.md), sharing `core/`
and the whole renderer with the desktop app — on a phone the renderer draws
its own phone layout instead of the desktop panes:

```sh
cd mobile
npm install
.\build-apk.bat
```

It browses, uploads, previews, streams and downloads. Downloads go straight
to the phone: photos to Pictures/BeanyDrive and videos to Movies/BeanyDrive
(where the gallery shows them), everything else to Download/BeanyDrive.
Other apps can **Share → BeanyDrive** to upload, and **camera backup**
(Settings) uploads new photos and videos from the camera folder while the app
is open. The app checks GitHub for a newer release on launch and offers the
`.apk` from it; Android's own installer does the rest. See
[mobile/README.md](mobile/README.md) for the detail.

`mobile/android` is generated, not committed: CI runs `npx cap add android`
and then `node native/install.mjs`, which adds BeanyDrive's own plugin
(`mobile/native/BeanyNativePlugin.java`) and its manifest entries.

## Keyboard shortcuts

Press `?` in the app for the same list.

| Key                   | Action                                   |
| --------------------- | ---------------------------------------- |
| `↑` `↓` / `j` `k`     | Move focus                               |
| `Shift` + `↑` `↓`     | Extend the selection                     |
| `Ctrl` + click        | Add / remove from the selection          |
| `Shift` + click       | Select a range                           |
| `Ctrl` + `A`          | Select all                               |
| `Enter`               | Open folder / preview file               |
| `Backspace`           | Up one folder                            |
| `/` or `Ctrl` + `F`   | Search                                   |
| `u` / `Shift` + `U`   | Upload files / upload a folder           |
| `n`                   | New folder                               |
| `r` / `F2`            | Rename                                   |
| `p`                   | Preview                                  |
| `m`                   | Move to…                                 |
| `Space`               | Star / unstar                            |
| `Delete` / `d`        | Move to Trash                            |
| `x`                   | Restore (in Trash)                       |
| `i`                   | Show / hide the details panel            |
| `g`                   | Grid / list                              |
| `F5`                  | Refresh from Discord                     |
| `,` (Mac: `Cmd` + `,`) | Settings                                |
| `Cmd` + `Delete`      | Move to Trash (Mac)                      |
| `Esc`                 | Close the top dialog, clear selection or search |
| `←` / `→`             | Previous / next page (PDF preview)       |

## Upload and download speed

A file is uploaded as a series of chunks, each one a separate Discord
message with an attachment. Discord lets a bot create roughly **5 messages
per 5 seconds per channel** — about one chunk per second. That, not the
number of parallel requests, is the ceiling: ~10 MB/s with 10 MB chunks.

What BeanyDrive does about it:

- **Paces itself instead of bouncing.** Every response carries
  `X-RateLimit-Remaining` and `X-RateLimit-Reset-After`; when a bucket is
  spent, requests for it wait exactly that long client-side. Firing into a
  limit and backing off on 429 is slower (the blind retry over-waits) and
  Discord counts repeated 429s against the bot.
- **Keeps the pipe full across files.** Three files upload at once, sharing
  one budget of in-flight chunks (the *Parallel chunk uploads* setting), so
  a small file no longer waits behind a large one and memory stays bounded.
- **Saves the index less often.** Each save is three requests. Files that
  finish together share one save, which matters most for many small files.
- **Downloads in parallel.** Downloads, previews and drag-out copies fetch
  six chunks at once and write them strictly in order.

**Why not split the file to disk first and then upload the parts?** Chunks
are already read straight from the file by offset as each request starts,
which costs milliseconds. Writing the parts out first adds a full extra copy
of the file to disk and waits for it before the first byte goes out —
slower, and it doesn't touch the actual limits (Discord's message rate and
your uplink).

**Why not a fixed one-second delay?** That's the rate limit hard-coded, and
wrong whenever it isn't exactly 5 per 5 s (other bots in the channel, a
different bucket for your server). Reading the headers gets the real number.

### Chunk size — the setting that actually matters

10 MB is Discord's per-attachment limit for a **non-boosted** server. Boost
the server and that limit rises, which moves the ceiling instead of nudging
it:

| Server boost level | Max attachment | Chunks for a 4 GB ISO |
| ------------------ | -------------- | --------------------- |
| None / Level 1     | 10 MB          | ~410                  |
| Level 2            | 50 MB          | ~82                   |
| Level 3            | 100 MB         | ~41                   |

BeanyDrive detects your server's tier on connect and caps the chunk size to
what it allows, so raising it above your server's limit is harmless.

### Parallel chunk uploads (default 4)

How many chunks are in flight at once, across all files. Past 4 the rate
limit usually caps you anyway; set it to **1** on an unstable connection.
Your uplink matters too: ~10 MB/s is about **80 Mbps** upstream, more than
most home connections have.

## Encryption

Settings → Security → **Turn on encryption** asks for a passphrase. From then
on, uploads from that device are encrypted:

- A random 256-bit data key encrypts each chunk with **AES-256-GCM**, bound to
  the file and its position so chunks can't be swapped or reordered.
- The data key is stored in the index only **wrapped** by a key derived from
  your passphrase (PBKDF2-SHA-256, 310,000 rounds). Changing the passphrase
  rewraps that one value; nothing is re-uploaded.
- Each device asks for the passphrase once and keeps the data key in its own
  protected storage (with the bot token). **Lock on this device** forgets it.
- Encrypted chunks carry no file name, in the message or the attachment.
  **The index still lists names, folders and sizes in the clear**, so the
  file list is readable by anyone who can read the channel; the contents
  aren't.
- **A forgotten passphrase can't be recovered.** Encrypted files are lost
  without it.
- Files uploaded before encryption was turned on stay unencrypted.

## Drive health

- **Index backups**: every metadata save replaces the pinned index message.
  At most once every 30 minutes, the outgoing copy is kept (unpinned and
  relabelled) instead of deleted, and the newest 10 are kept. Settings →
  Drive health → *Index backups* lists them, and **Restore** puts one back,
  after backing up the current index first, so a restore can be undone.
- **Check drive** reads every message in the channel (about a second per 100)
  and compares it with the index:
  - **Damaged files**: files that can't be downloaded whole, because part of
    them was deleted from the channel, or because fewer bytes were uploaded
    than the file's size (a photo cut short while it was still saving). They
    can be removed. Uploads now check every read, so this can't happen again.
  - **Not in the index**: complete files in the channel that the index doesn't
    list, after a restore or a lost index. **Recover** adds them to a
    *Recovered* folder. This is also how a drive whose index is gone entirely
    is rebuilt; names come from the chunk messages (an encrypted file's name
    isn't in them, so it's recovered as *Recovered file …*).
  - **Leftover chunks**: pieces of uploads that never finished. They can be
    deleted.

## Legal

BeanyDrive is free, open-source software under the [MIT License](LICENSE).

- [Privacy Policy](docs/legal/PRIVACY.md): BeanyDrive has no server and collects nothing; your files live, unencrypted, in your own Discord channel.
- [Terms of Service](docs/legal/TERMS.md)
- [Data Deletion](docs/legal/DATA_DELETION.md)
- [Third-Party Notices & Licenses](docs/legal/THIRD_PARTY_NOTICES.md)

The same pages are in the app under **Settings → About → Legal**. The app also shows a short privacy notice the first time it starts, and its automatic update check can be turned off there.

## Office preview

`.docx` and `.pptx` are ZIP archives full of XML, and Chromium can already
unzip (`DecompressionStream`) and parse XML (`DOMParser`) — so BeanyDrive reads
them directly in `renderer/ooxml.js` rather than shipping another renderer
alongside pdf.js. Nothing is uploaded anywhere to convert it.

**What you get.** Word documents render as a readable document: headings,
bold/italic/underline/strikethrough, text colour and size, lists, tables, and
inline images. PowerPoint renders each slide at its true aspect ratio with every
text box and picture positioned where the deck puts it, scaled to fit the window.

**What isn't reproduced.** This is a reading view, not a rendering engine:

- **Word**: no page breaks, headers/footers, footnotes, comments, tracked
  changes, columns, or exact fonts and margins. List numbering shows as bullets.
- **PowerPoint**: no slide master/layout backgrounds, themes, tables, charts,
  SmartArt, WordArt effects, transitions, animations, or speaker notes. Text is
  positioned by its shape box, so heavy custom spacing can sit differently.
- **Vector images** (EMF/WMF) inside either format are skipped — browsers can't
  display them.
- Only the modern zipped formats work. Legacy `.doc`/`.ppt` (Word/PowerPoint
  97–2003) and OpenDocument `.odt`/`.odp` are different formats entirely; those
  say so plainly rather than failing with a parse error.

Everything drawn from a document is escaped as text, and the only URLs the
preview emits are `blob:` URLs it created for embedded images — a document can't
inject markup, scripts, or outbound requests into the app.

## Notes

- **Chunk size**: configurable in Settings (default 10 MB), always capped by
  your server's real upload limit. If Discord rejects a chunk as too large
  mid-upload, BeanyDrive halves the chunk size and retries automatically.
- **Pause, resume, retry, cancel**: **Pause** and **failure** keep the chunks
  already uploaded, so resuming or retrying re-sends only what's missing.
  **Cancel** deletes them — including when you dismiss a paused or failed
  row. Installing an update stops running uploads the same way a pause does.
- **Resuming**: the chunks that made it are recorded in `uploads-resume.json`
  beside the config. Re-uploading the same file to the same folder picks up
  from there, whether it stopped from a pause, a crash, or a network drop.
  Editing the file invalidates the record, and records nobody resumes within
  a week are swept on connect, their chunks deleted.
- **Speed and ETA**: measured over a rolling 15-second window of chunk
  completions. Folder uploads show a plain percentage — their progress is
  counted in files, not bytes.
- **Folders**: virtual, same as the original — path prefixes on files plus
  an explicit list for empty folders. That's why renaming or moving is
  instant: only the index changes, no chunk is touched. **Deleting a folder
  is permanent** — it deletes the files inside from Discord and skips Trash,
  and the app asks first.
- **Trash vs. permanent delete**: moving a file to Trash only flips a flag
  in the index; its chunks stay until you **Empty Trash**, which is one
  DELETE per chunk and reports progress in the transfers card.
- **Thumbnails**: images and PDFs up to 25 MB, and videos of any size, get a
  thumbnail in the list, the grid and the details panel, loaded for whatever
  is on screen as you scroll (two at a time; rows scrolled past before their
  turn are skipped). A video's thumbnail streams only the start of the file
  (and the end, if that's where its index is). Each is downscaled and kept on
  your device, so a file is downloaded for its thumbnail once, not every
  launch. Turn background thumbnails off, or clear them, in Settings →
  Appearance.
- **Duplicates**: before uploading, a file is hashed in 8 MB blocks. If the
  drive already holds the same content, the new entry links the existing
  chunks; if it's the same name in the same folder, nothing is added at all.
  Emptying Trash, deleting a file or a folder only deletes chunks no other
  entry still uses.
- **Tests**: `npm test` runs the core's unit tests (`test/`) against an
  in-memory Discord: chunking, resume, the 413 fallback, dedup, encryption,
  range reads, index backups and Check drive.
- **Drag out**: an OS drag has to hand over a file that already exists on
  disk, so dragging a file that isn't cached yet starts the download, and you
  drag again once it's ready. Copies live in `drag-cache` beside the config,
  capped at 2 GB and 7 days.
- **Copy link**: copies the Discord CDN URL of a file's first chunk — a
  partial link for multi-chunk files, and Discord CDN links can expire.
- **Updates**: `update-checker.js` asks the GitHub API for the latest
  release, downloads the matching asset to a temp folder, checks its SHA-512
  against `latest.yml` when the release has one, then starts it and quits.
  Set `BEANYDRIVE_PRETEND_VERSION=1.0.0` to try the flow from a dev build.
- **Token storage**: lives only in the main process — the renderer never
  sees it, only whether one's saved.
- **Fonts and icons**: the Nothing style uses [Doto](https://fonts.google.com/specimen/Doto)
  and [Space Mono](https://fonts.google.com/specimen/Space+Mono), both SIL Open
  Font License, vendored in `renderer/vendor/fonts`. Icons are drawn inline as
  SVG, no font or CDN dependency.
- **Preview limits**: previewing pulls every chunk over the network first,
  held in memory instead of written to disk — so it's capped at 500 MB on
  desktop and 100 MB on Android. PDFs use a vendored
  [pdf.js](https://mozilla.github.io/pdf.js/) build
  ([Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)).
- **Why `app://` instead of loading `index.html` straight off disk**:
  Chromium treats plain `file://` pages as an opaque origin, which silently
  breaks ES module workers — exactly what the PDF preview needs. BeanyDrive
  registers a proper `app://` scheme and serves `renderer/` through it.
