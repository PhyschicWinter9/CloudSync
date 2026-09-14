"""Restore a ClaudeSync backup back onto a machine."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path

from .backup import MANIFEST_NAME


class RestoreError(RuntimeError):
    pass


@dataclass
class RestorePlan:
    original_path: Path
    backup_path: Path
    is_dir: bool
    category: str
    scope: str
    will_overwrite: bool


def load_manifest(source_dir: Path) -> dict:
    manifest_path = Path(source_dir) / MANIFEST_NAME
    if not manifest_path.is_file():
        raise RestoreError(f"No {MANIFEST_NAME} found in {source_dir}")
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def build_plan(source_dir: Path, categories: set[str] | None = None) -> list[RestorePlan]:
    source_dir = Path(source_dir).expanduser().resolve()
    manifest = load_manifest(source_dir)

    plan = []
    for entry in manifest.get("items", []):
        if categories and entry["category"] not in categories:
            continue
        original = Path(entry["original_path"])
        backup_path = source_dir / entry["backup_path"]
        plan.append(
            RestorePlan(
                original_path=original,
                backup_path=backup_path,
                is_dir=entry["is_dir"],
                category=entry["category"],
                scope=entry["scope"],
                will_overwrite=original.exists(),
            )
        )
    return plan


def apply_plan(plan: list[RestorePlan], dry_run: bool = False) -> int:
    restored = 0
    for entry in plan:
        if not entry.backup_path.exists():
            continue
        if dry_run:
            restored += 1
            continue

        entry.original_path.parent.mkdir(parents=True, exist_ok=True)
        if entry.is_dir:
            if entry.original_path.exists():
                shutil.rmtree(entry.original_path)
            shutil.copytree(entry.backup_path, entry.original_path)
        else:
            shutil.copy2(entry.backup_path, entry.original_path)
        restored += 1
    return restored
