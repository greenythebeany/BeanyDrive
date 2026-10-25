# Privacy Policy

_Last updated: 2026-10-25_

BeanyDrive is a client app that stores your files in a **Discord channel you own, through a Discord bot you create**. The developer runs no server for BeanyDrive, does not receive analytics or telemetry from your copy of the app, and cannot see your files, your bot token or your channel.

BeanyDrive is a free, open-source (MIT-licensed) personal project maintained by one developer (GitHub: [greenythebeany](https://github.com/greenythebeany)). There is no company behind it. The only contact channel is [GitHub Issues on the BeanyDrive repo](https://github.com/greenythebeany/BeanyDrive/issues); that's also where to report a privacy or licensing concern.

This document is also available inside the app, under **Settings → About → Legal**.

## Where your files go

**Everything you upload is stored on Discord.** Files are split into chunks and posted as attachments in the channel you configured, by the bot you configured. The list of your files, folders, tags and stars (the "index") is a JSON file pinned in that same channel.

- **BeanyDrive does not encrypt your files.** They're stored on Discord's servers as you uploaded them, readable by anyone who can read that channel (members of the server with access to it, other bots in it) and by Discord itself.
- Your use of Discord is governed by [Discord's Terms of Service](https://discord.com/terms) and [Privacy Policy](https://discord.com/privacy). Discord can remove content or accounts under those terms.
- Don't store anything in BeanyDrive that you couldn't accept someone else reading. If you need confidentiality, encrypt files yourself before uploading them.

## Data that stays on your device

**Desktop (Windows, macOS, Linux).** These live in BeanyDrive's app-data folder: `%APPDATA%\BeanyDrive` on Windows, `~/Library/Application Support/BeanyDrive` on macOS, `~/.config/BeanyDrive` on Linux.

- **Your bot token**, in `bot-token.enc`. It's encrypted with your operating system's protection (Electron `safeStorage`: Windows DPAPI, the macOS Keychain, or the Linux Secret Service). If your system offers no such encryption, it's stored as plain text instead.
- **Connection settings** (channel ID, chunk size, parallel uploads), in `drive-config.json`.
- **Resume records** for unfinished uploads, in `uploads-resume.json`. Each holds the local file path, its size and the IDs of the chunks already uploaded. Records nobody resumes within 7 days are deleted, along with their chunks in Discord.
- **Drag-out copies** of files you dragged from BeanyDrive to your desktop, in the `drag-cache` folder. They're capped at 2 GB, and copies older than 7 days are removed.
- **Interface preferences** (style, theme, accent, sort order, view, custom tag names), in the app's local storage.

**Android.**

- **Your bot token and settings** are stored with Android's app preferences. They're not encrypted beyond what Android itself provides, so they're readable by anyone with root access to the phone, or with an unencrypted backup of the app's data.
- **Interface preferences** are stored the same way as on desktop.
- **Downloads** go wherever you choose to save or share them.

**Previews and thumbnails** are held in memory while the app is open and never written to disk.

## Data sent to other services (never to the developer)

- **Discord (discord.com, cdn.discordapp.com):** every drive operation goes here, sent with your bot token. That's uploading, listing, downloading, renaming, trashing and deleting.
- **GitHub (api.github.com, github.com):** a check for a newer BeanyDrive release, a few seconds after the app starts. It sends a generic app identifier, nothing that identifies you. If you choose to update, the new version is downloaded from GitHub's release files. You can turn the automatic check off in **Settings → About**; **Check for updates** still works when you press it.
- **Links you open:** only the ones you click, like the README link in Settings, which open in your browser.

BeanyDrive contains no ads, analytics, crash reporting or trackers. Its fonts and icons ship inside the app, so it doesn't load them from the internet.

## Children's data

BeanyDrive has no sign-up and no accounts of its own, and the developer collects no data, so nothing here depends on a user's age. BeanyDrive isn't directed at children, and it needs a Discord account and bot. Discord's own minimum age applies to that.

## Email

BeanyDrive doesn't send email, run a mailing list or collect email addresses.

## Changes

Changes to this policy are published in the BeanyDrive repository, with the date at the top updated. The repository's history shows every earlier version.

## Related documents

- [Terms of Service](TERMS.md)
- [Data Deletion](DATA_DELETION.md)
- [Third-Party Notices & Licenses](THIRD_PARTY_NOTICES.md)
