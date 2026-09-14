# ClaudeSync

[![CI](https://github.com/PhyschicWinter9/CloudSync/actions/workflows/ci.yml/badge.svg)](https://github.com/PhyschicWinter9/CloudSync/actions/workflows/ci.yml)

Automatic backup (and restore) for everything Claude Code stores on your
machine — not just `~/.claude/`.

ClaudeSync scans the same sources Claude Code Organizer uses to find items
across every scope: the global config directory plus every project
directory Claude Code has ever been opened in (read straight out of
`~/.claude.json`). It then copies what it finds into a plain directory that
it keeps under git, so every backup is a commit you can diff, roll back, or
push to a private remote.

Two ways to use it, sharing one backup format:

- **CLI** (this directory) — `claudesync scan|backup|restore|schedule`.
- **[Desktop app](desktop/)** — a tray/menu-bar app with a GUI for the same
  operations, plus a built-in scheduler. See `desktop/README.md`.

## What gets backed up

| Category   | Global (`~/.claude/`, `~/.claude.json`)      | Per project                          |
|------------|-----------------------------------------------|---------------------------------------|
| Memory     | `CLAUDE.md`, `CLAUDE.local.md`                | `CLAUDE.md`, `CLAUDE.local.md`        |
| Settings   | `settings.json`, `settings.local.json`        | `.claude/settings.json`, `.claude/settings.local.json` |
| MCP config | `~/.claude.json`, `.claude/mcp.json`          | `.mcp.json`                           |
| Agents     | `agents/**/*.md`                              | `.claude/agents/**/*.md`              |
| Commands   | `commands/**/*.md`                            | `.claude/commands/**/*.md`            |
| Rules      | `rules/**/*.md`                               | `.claude/rules/**/*.md`               |
| Plans      | `plans/**/*.md`                               | `.claude/plans/**/*.md`               |
| Skills     | `skills/*` (each skill's full directory tree) | `.claude/skills/*`                    |
| Sessions   | `projects/` (all `.jsonl` transcripts)        | —                                      |
| Plugins    | `plugins/*` (cached plugin directories)       | —                                      |

Project directories are discovered from the `"projects"` map in
`~/.claude.json` — the same list Claude Code itself tracks, and what Claude
Code Organizer uses — so you don't have to remember or hand-enter every
repo you've opened Claude Code in. Pass `--project /path/to/repo` (repeatable)
to include a directory that isn't in that list yet.

## Install

```
pip install -e .
```

This installs the `claudesync` command. You can also always run it as
`python3 -m claudesync ...` without installing anything.

## Usage

```
# See everything ClaudeSync can find, without copying anything.
claudesync scan

# Copy it all into ~/.claudesync-backup and commit the result.
claudesync backup

# Same, but also push to a private git remote.
claudesync backup --remote git@github.com:you/claude-backup.git --push

# On a new machine: import the backup, then restore.
claudesync import git@github.com:you/claude-backup.git
claudesync restore --dry-run     # see what would change first
claudesync restore --yes         # apply it

# Restore just one category (e.g. only skills).
claudesync restore --category skill --yes

# Run backups automatically every 6 hours (cron on Linux, launchd on macOS).
# Configure the remote once beforehand (see below) so scheduled runs have
# something to push to.
claudesync schedule install --interval 6
```

Every backup writes `manifest.json` at the root of the backup directory,
recording exactly where each item came from so `restore` can put files back
in their original, absolute locations — including files that live inside
whichever project directory they were opened from, on whichever machine
you restore to.

## Verify before you trust it

Before restoring — especially after an `import` from somewhere else —
you can read the actual chat transcripts a backup contains, to confirm
it's the conversation history you expect:

```
claudesync sessions --source ~/.claudesync-backup
# [1] 2026-01-14 10:32  4 message(s)  (-home-user-myproject)
#       Can you fix the login bug?

claudesync preview-session 1 --source ~/.claudesync-backup
# [user] Can you fix the login bug?
# [assistant] Sure, let me look at the auth module.
# ...
```

`preview-session` also accepts a direct path to a `.jsonl` file instead of
an index. This only reads the transcript — nothing is restored until you
run `claudesync restore`.

## Cloud backup

`--remote`/`--push` (above) push your backup to a git remote after every
run — that remote can be a private GitHub/GitLab repo or any other git
host, which is what "cloud backup" means here. If more than one machine
shares the same remote, add `--pull-first` so each backup starts from the
latest shared history instead of risking a rejected push:

```
claudesync backup --remote git@github.com:you/claude-backup.git --push --pull-first
```

## Import and export

Bringing a backup onto a new machine, or sharing one somewhere that isn't
git, works via `import`/`export`. `import` accepts a git URL (including a
local path to a bare repo, e.g. on a NAS mount), a `.zip` file, or an
existing local backup directory — it figures out which:

```
# From a cloud (git) remote.
claudesync import git@github.com:you/claude-backup.git

# From a .zip someone shared via a cloud drive, email, or USB stick.
claudesync import ~/Downloads/claude-backup.zip

claudesync restore --dry-run
```

`export` zips up a backup directory for anywhere git isn't convenient —
drop the file in a Dropbox/Drive/OneDrive/iCloud folder, email it, or copy
it to a USB stick:

```
claudesync export --out ~/Dropbox/claude-backup.zip
```

## Automatic backups

```
claudesync schedule install --dest ~/.claudesync-backup --interval 6 --push
claudesync schedule uninstall
```

This installs a cron entry (Linux) or a launchd agent (macOS) that runs
`claudesync backup` on the interval you choose. Configure the git remote
once with `claudesync backup --remote <url> --push` beforehand so scheduled
runs have something to push to.

## Security note

MCP server configs and settings can contain API keys, tokens, or other
secrets in plaintext. ClaudeSync backs them up faithfully so restores are
exact, which means **your backup destination must be treated as sensitive**:
use a private git repository (or another private storage location), never
a public one.

## Development

No third-party dependencies are required to run or test ClaudeSync.

```
python3 -m unittest discover -s tests -v
```

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every push and pull request:
  the Python CLI's unit tests across Linux/macOS/Windows and two Python
  versions, the desktop app's Node unit tests across the same OS matrix,
  and an Electron boot smoke test (launches the real app under Xvfb and
  confirms it starts without crashing).
- **Release** (`.github/workflows/release.yml`) runs when a tag matching
  `v*.*.*` is pushed: it builds the desktop app installer for macOS,
  Windows, and Linux, builds the Python CLI's sdist/wheel, and attaches
  all of them to a GitHub Release for that tag.

```
git tag v0.1.0
git push origin v0.1.0
```
