"""Command-line entrypoint for ClaudeSync."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__, backup, exporter, importer, restore, schedule
from .discovery import scan_all

DEFAULT_BACKUP_DIR = Path.home() / ".claudesync-backup"


def _add_common_project_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--project",
        action="append",
        default=[],
        metavar="PATH",
        help="Extra project directory to scan, in addition to everything "
        "found in ~/.claude.json. May be given multiple times.",
    )


def cmd_scan(args: argparse.Namespace) -> int:
    items = scan_all(extra_projects=[Path(p) for p in args.project])

    if args.json:
        payload = [
            {"category": i.category, "scope": i.scope, "path": str(i.source), "is_dir": i.is_dir}
            for i in items
        ]
        print(json.dumps(payload, indent=2))
        return 0

    by_category: dict[str, int] = {}
    for item in items:
        by_category[item.category] = by_category.get(item.category, 0) + 1
        print(item.label)
    print()
    print(f"Found {len(items)} item(s):")
    for category, count in sorted(by_category.items()):
        print(f"  {category}: {count}")
    return 0


def cmd_backup(args: argparse.Namespace) -> int:
    result = backup.run_backup(
        dest_dir=Path(args.dest),
        extra_projects=[Path(p) for p in args.project],
        push=args.push,
        remote_url=args.remote,
        pull_first=args.pull_first,
    )
    if result.pulled:
        print("Pulled latest changes from remote.")
    print(result.summary())
    print(f"Manifest: {result.manifest_path}")
    if result.committed:
        print("Committed changes to git.")
    else:
        print("No changes since last backup.")
    if args.push:
        print("Pushed to remote." if result.pushed else "Push requested but not performed.")
    return 0


def cmd_import(args: argparse.Namespace) -> int:
    try:
        dest = importer.import_source(args.source, Path(args.dest))
    except importer.ImportError_ as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1

    manifest = restore.load_manifest(dest)
    print(f"Imported backup into {dest}")
    print(f"{len(manifest.get('items', []))} item(s) available to restore.")
    print(f"Next: claudesync restore --source {dest}")
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    try:
        out_path = exporter.export_zip(Path(args.source), Path(args.out), include_git_history=args.include_git_history)
    except exporter.ExportError as exc:
        print(f"Export failed: {exc}", file=sys.stderr)
        return 1

    print(f"Exported backup to {out_path}")
    print("Upload this file to a cloud drive (Dropbox/Drive/OneDrive/iCloud), email it, or copy it to a USB stick.")
    print(f"On another machine: claudesync import {out_path}")
    return 0


def cmd_restore(args: argparse.Namespace) -> int:
    categories = set(args.category) if args.category else None
    plan = restore.build_plan(Path(args.source), categories=categories)

    if not plan:
        print("Nothing to restore (empty or filtered manifest).")
        return 0

    print(f"{len(plan)} item(s) will be restored from {args.source}:")
    for entry in plan:
        marker = "OVERWRITE" if entry.will_overwrite else "new"
        print(f"  [{entry.category}] {entry.original_path} ({marker})")

    if args.dry_run:
        print("\nDry run: nothing was changed.")
        return 0

    if not args.yes:
        answer = input("\nProceed with restore? [y/N] ").strip().lower()
        if answer != "y":
            print("Aborted.")
            return 1

    restored = restore.apply_plan(plan, dry_run=False)
    print(f"Restored {restored} item(s).")
    return 0


def cmd_schedule(args: argparse.Namespace) -> int:
    if args.action == "install":
        message = schedule.install(Path(args.dest), interval_hours=args.interval, push=args.push)
    else:
        message = schedule.uninstall()
    print(message)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="claudesync", description=__doc__)
    parser.add_argument("--version", action="version", version=f"claudesync {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_scan = sub.add_parser("scan", help="List every Claude Code item discovered on this machine")
    _add_common_project_args(p_scan)
    p_scan.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    p_scan.set_defaults(func=cmd_scan)

    p_backup = sub.add_parser("backup", help="Copy discovered items into a versioned backup directory")
    _add_common_project_args(p_backup)
    p_backup.add_argument("--dest", default=str(DEFAULT_BACKUP_DIR), help="Backup directory (default: %(default)s)")
    p_backup.add_argument("--push", action="store_true", help="git push the backup after committing")
    p_backup.add_argument("--remote", default=None, help="Git remote URL to configure as 'origin'")
    p_backup.add_argument(
        "--pull-first",
        action="store_true",
        help="git pull before backing up, so a shared remote's history from other machines isn't diverged from",
    )
    p_backup.set_defaults(func=cmd_backup)

    p_restore = sub.add_parser("restore", help="Restore items from a backup directory")
    p_restore.add_argument("--source", default=str(DEFAULT_BACKUP_DIR), help="Backup directory to restore from")
    p_restore.add_argument(
        "--category",
        action="append",
        default=[],
        help="Restrict restore to one category (memory, settings, mcp, agent, "
        "command, rule, plan, skill, session, plugin). May be repeated.",
    )
    p_restore.add_argument("--dry-run", action="store_true", help="Show what would be restored without changing anything")
    p_restore.add_argument("--yes", action="store_true", help="Skip the confirmation prompt")
    p_restore.set_defaults(func=cmd_restore)

    p_import = sub.add_parser(
        "import",
        help="Import a backup from a git remote URL, a .zip file, or a local directory",
    )
    p_import.add_argument(
        "source", help="A git URL (e.g. git@github.com:you/claude-backup.git), a .zip file, or a directory"
    )
    p_import.add_argument("--dest", default=str(DEFAULT_BACKUP_DIR), help="Where to put it (default: %(default)s)")
    p_import.set_defaults(func=cmd_import)

    p_export = sub.add_parser("export", help="Zip up a backup directory for transport anywhere git isn't")
    p_export.add_argument("--source", default=str(DEFAULT_BACKUP_DIR), help="Backup directory to zip (default: %(default)s)")
    p_export.add_argument("--out", required=True, help="Path to write the .zip file to")
    p_export.add_argument(
        "--include-git-history", action="store_true", help="Include the .git directory (full commit history) in the archive"
    )
    p_export.set_defaults(func=cmd_export)

    p_schedule = sub.add_parser("schedule", help="Install or remove an automatic backup schedule")
    p_schedule.add_argument("action", choices=["install", "uninstall"])
    p_schedule.add_argument("--dest", default=str(DEFAULT_BACKUP_DIR), help="Backup directory (default: %(default)s)")
    p_schedule.add_argument("--interval", type=int, default=6, help="Hours between backups (default: %(default)s)")
    p_schedule.add_argument("--push", action="store_true", default=True, help="git push on each scheduled backup")
    p_schedule.set_defaults(func=cmd_schedule)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
