# Data Deletion

_Last updated: 2026-10-30_

The developer holds no data about you, so there's nothing to request from them. Everything BeanyDrive stores is either in your Discord channel or on your own device, and you can delete all of it yourself.

## Files in Discord

- **Single files:** move them to Trash, then use **Empty Trash**. That deletes their chunks from the channel. Moving to Trash alone only hides them; the chunks stay until you empty it.
- **A folder and everything in it:** right-click it → **Delete folder…**. This deletes the files from Discord immediately, without going through Trash.
- **Everything at once:** delete the Discord channel itself. That removes every chunk and the pinned index.
- **Unfinished uploads:** cancelling an upload, or dismissing a paused or failed one, deletes the chunks it already sent. Uploads abandoned for more than 7 days are cleaned up automatically the next time the app connects.

## The bot token

To make a token useless everywhere it's stored, reset it in the [Discord Developer Portal](https://discord.com/developers/applications): your application → **Bot** → **Reset Token**. To remove the bot completely, delete the application there, or kick the bot from your server.

## Data on your device

- **Windows:** uninstall BeanyDrive (Settings → Apps), then delete `%APPDATA%\BeanyDrive`.
- **macOS:** move BeanyDrive from Applications to the Trash, then delete `~/Library/Application Support/BeanyDrive`.
- **Linux:** delete the AppImage and `~/.config/BeanyDrive`.
- **Android:** Settings → Apps → BeanyDrive → **Storage → Clear storage**, or uninstall the app.

The app-data folder holds the encrypted bot token, connection settings, resume records, the drag-out cache and the thumbnail cache, all described in the [Privacy Policy](PRIVACY.md). To remove only the thumbnails, use **Settings → Appearance → Clear thumbnail cache**.
