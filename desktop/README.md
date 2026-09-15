# ClaudeSync Desktop

A menu-bar/tray desktop app for ClaudeSync: automatic, no-terminal-required
backup and restore for everything Claude Code stores on your machine.

It reimplements the same scanner, backup, and restore logic as the
[Python CLI](../README.md) natively in Node (see `src/core/`), writing the
exact same `manifest.json` format — so a backup made by the desktop app can
be restored by the CLI and vice versa, and they can safely share one backup
directory.

## What it does

- Lives in the system tray/menu bar with a "Back Up Now" action and a
  live status ("Last backup: ...").
- A window with four tabs:
  - **Dashboard** — last backup time, item counts by category, quick actions.
  - **Backup** — scan this machine and see exactly what was found before
    backing it up; export the backup as a `.zip` for anywhere git isn't.
  - **Restore** — import a backup from a git remote or a `.zip` file, then
    preview (dry run) and restore, optionally filtered to specific categories;
    also lists chat session transcripts found in the backup and renders one as
    a readable chat log, so you can confirm it's the real conversation before
    you rely on it.
  - **Settings** — backup destination, git remote + push (cloud backup) and
    pull-first toggles, automatic backup interval, and "start at login".
- Runs backups automatically on a configurable interval once enabled in
  Settings, and shows a native notification when one completes or fails.
- **Cloud backup**: push to a private git remote after every backup, with
  an optional pull-first so multiple machines sharing one remote don't
  produce a rejected push.
- **Import/export**: bring a backup made elsewhere onto this machine (git
  URL — including a local bare-repo path such as a NAS mount — or a
  `.zip`), or export one to a `.zip` to drop into a cloud drive folder
  (Dropbox/Drive/OneDrive/iCloud), email, or a USB stick. The zip
  reader/writer (`src/core/zip.js`) is dependency-free and produces
  standard zip files (cross-checked against the system `unzip`/`zip`
  tools and Python's `zipfile`).
- **Preview chat sessions**: the Restore tab lists every `.jsonl` chat
  transcript found in the loaded backup (with a timestamp and a snippet of
  the first message) and renders one as a scrollable chat log — read the
  actual conversation before you restore or otherwise rely on it. Claude
  Code's transcript format isn't a documented API, so the parser
  (`src/core/sessions.js`) is intentionally tolerant: it skips lines or
  blocks it doesn't recognize rather than failing.
- **Export all chats**: "Export All Chats…" in the same section writes
  every session found in the loaded backup as one readable Markdown or
  plain-text file per chat, to a folder you choose — for browsing or
  archiving your whole chat history outside ClaudeSync and outside the raw
  `.jsonl` format.

## Develop

```
cd desktop
npm install
npm start
```

## Test

Core scanning/backup/restore logic has no Electron dependency and is
covered by Node's built-in test runner:

```
npm test
```

## Regenerating icons

App and tray icons are generated PNGs (no image-editing dependency):

```
npm run generate-icons
```

## Package for distribution

```
npm run dist
```

Uses `electron-builder` (see the `build` key in `package.json`), building
for whichever OS you run it on:

| OS | Installer | Portable (no install) |
|----|-----------|------------------------|
| Windows | `ClaudeSync-Setup-<version>.exe` (NSIS) | `ClaudeSync-<version>-portable.exe` — a single file, just run it |
| macOS | `ClaudeSync-<version>.dmg` | `ClaudeSync-<version>-mac.zip` — unzip and run the `.app` |
| Linux | — | `ClaudeSync-<version>.AppImage` — already a single portable executable |

All builds are unsigned (no code-signing certificate is configured), so
macOS/Windows will show an "unidentified developer" warning on first launch.
The CI/CD release workflow (`.github/workflows/release.yml`) builds all of
these automatically on a version tag push and attaches them to a GitHub
Release; it runs each OS's build on that OS's own GitHub-hosted runner
(no cross-compilation).

## Security note

Same as the CLI: MCP configs and settings can carry plaintext secrets.
Treat your backup destination (and any git remote you push it to) as
sensitive — private repositories only.
