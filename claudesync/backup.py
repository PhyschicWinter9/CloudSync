"""Copy discovered Claude Code state into a versioned backup directory."""

from __future__ import annotations

import hashlib
import json
import shutil
import socket
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from . import gitutil
from .discovery import GLOBAL_SCOPE, DiscoveredItem, scan_all

MANIFEST_NAME = "manifest.json"
LAST_RUN_NAME = "last_run.json"
MANIFEST_VERSION = 1

# Directory names never worth copying: reinstallable dependency trees and
# VCS metadata that would otherwise bloat every backup.
DEFAULT_IGNORE_DIRNAMES = {"node_modules", "__pycache__", ".git", ".venv", ".DS_Store"}


def _ignore(dirnames_to_skip: set[str]):
    def handler(_dir: str, names: list[str]) -> set[str]:
        return {n for n in names if n in dirnames_to_skip}

    return handler


def _project_slug(project_path: Path) -> str:
    digest = hashlib.sha1(str(project_path).encode("utf-8")).hexdigest()[:10]
    return f"{project_path.name or 'root'}-{digest}"


class BackupResult:
    def __init__(self) -> None:
        self.copied: list[DiscoveredItem] = []
        self.manifest_path: Path | None = None
        self.committed = False
        self.pushed = False

    def summary(self) -> str:
        by_category: dict[str, int] = {}
        for item in self.copied:
            by_category[item.category] = by_category.get(item.category, 0) + 1
        lines = [f"{len(self.copied)} item(s) backed up:"]
        for category, count in sorted(by_category.items()):
            lines.append(f"  {category}: {count}")
        return "\n".join(lines)


def run_backup(
    dest_dir: Path,
    extra_projects: Iterable[Path] = (),
    home: Path | None = None,
    push: bool = False,
    remote_url: str | None = None,
    ignore_dirnames: set[str] | None = None,
) -> BackupResult:
    home = home or Path.home()
    dest_dir = Path(dest_dir).expanduser().resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)
    ignore_dirnames = ignore_dirnames if ignore_dirnames is not None else DEFAULT_IGNORE_DIRNAMES

    items = scan_all(extra_projects=extra_projects, home=home)

    manifest_items = []
    project_slugs: dict[str, str] = {}
    result = BackupResult()

    for item in items:
        if item.scope == GLOBAL_SCOPE:
            try:
                rel = item.source.relative_to(home)
            except ValueError:
                rel = Path(item.source.name)
            backup_rel = Path("global") / rel
        else:
            project_root = Path(item.scope)
            slug = project_slugs.setdefault(item.scope, _project_slug(project_root))
            try:
                rel = item.source.relative_to(project_root)
            except ValueError:
                rel = Path(item.source.name)
            backup_rel = Path("projects") / slug / rel

        dest_path = dest_dir / backup_rel
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        if item.is_dir:
            if dest_path.exists():
                shutil.rmtree(dest_path)
            shutil.copytree(item.source, dest_path, ignore=_ignore(ignore_dirnames))
        else:
            shutil.copy2(item.source, dest_path)

        manifest_items.append(
            {
                "category": item.category,
                "scope": item.scope,
                "original_path": str(item.source),
                "backup_path": str(backup_rel.as_posix()),
                "is_dir": item.is_dir,
            }
        )
        result.copied.append(item)

    manifest = {
        "version": MANIFEST_VERSION,
        "host": socket.gethostname(),
        "home": str(home),
        "projects": {slug: path for path, slug in project_slugs.items()},
        "items": manifest_items,
    }
    manifest_path = dest_dir / MANIFEST_NAME
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    result.manifest_path = manifest_path

    # created_at changes on every run even when nothing else does, so it is
    # kept out of manifest.json (which we want to diff cleanly) and instead
    # written to an untracked file purely for the user's own reference.
    timestamp = datetime.now(timezone.utc).isoformat()
    gitignore_path = dest_dir / ".gitignore"
    existing_ignores = gitignore_path.read_text(encoding="utf-8").splitlines() if gitignore_path.exists() else []
    if LAST_RUN_NAME not in existing_ignores:
        with gitignore_path.open("a", encoding="utf-8") as f:
            f.write(f"{LAST_RUN_NAME}\n")
    (dest_dir / LAST_RUN_NAME).write_text(
        json.dumps({"created_at": timestamp, "host": manifest["host"]}, indent=2) + "\n",
        encoding="utf-8",
    )

    if not gitutil.is_repo(dest_dir):
        gitutil.init(dest_dir)
    if remote_url:
        gitutil.set_remote(dest_dir, remote_url)

    gitutil.add_all(dest_dir)
    result.committed = gitutil.commit(dest_dir, f"ClaudeSync backup {timestamp}")

    if push:
        branch = gitutil.current_branch(dest_dir)
        gitutil.push(dest_dir, branch=branch)
        result.pushed = True

    return result
