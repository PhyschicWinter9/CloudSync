"""Zip up a backup directory for transport anywhere git isn't: a cloud
drive folder (Dropbox/Drive/OneDrive/iCloud), email, or a USB stick.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

from .backup import MANIFEST_NAME


class ExportError(RuntimeError):
    pass


def export_zip(source_dir: Path, out_path: Path, include_git_history: bool = False) -> Path:
    source_dir = Path(source_dir).expanduser().resolve()
    out_path = Path(out_path).expanduser().resolve()

    if not (source_dir / MANIFEST_NAME).is_file():
        raise ExportError(f"No {MANIFEST_NAME} found in {source_dir} — nothing to export.")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(source_dir.rglob("*")):
            if not include_git_history and ".git" in path.relative_to(source_dir).parts:
                continue
            if path.is_file():
                zf.write(path, path.relative_to(source_dir))

    return out_path
