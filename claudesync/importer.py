"""Bring a backup made elsewhere onto this machine, ready to restore.

A "backup" someone hands you can arrive three ways, and this module
accepts all three: a git remote URL (cloud backup shared via a private
repo), a .zip archive (shared via a cloud drive, email, or USB stick), or
a plain local directory that already looks like a ClaudeSync backup.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

from . import gitutil
from .backup import MANIFEST_NAME

_GIT_URL_PREFIXES = ("git@", "ssh://", "git://")
_GIT_URL_SCHEMES = ("http://", "https://")


class ImportError_(RuntimeError):
    pass


def looks_like_git_url(source: str) -> bool:
    if source.startswith(_GIT_URL_PREFIXES):
        return True
    if source.startswith(_GIT_URL_SCHEMES) and source.endswith(".git"):
        return True
    return False


def _require_manifest(directory: Path) -> None:
    if not (directory / MANIFEST_NAME).is_file():
        raise ImportError_(f"No {MANIFEST_NAME} found in {directory} — this doesn't look like a ClaudeSync backup.")


def _looks_like_local_git_repo(path: Path) -> bool:
    """A local filesystem path usable with `git clone`/`git pull`: either a
    working copy (has a .git dir) or a bare repo (its root IS the git dir,
    e.g. one made with `git init --bare`). Local paths are a legitimate git
    remote — e.g. a network drive or NAS mount used for cloud-style backup —
    so these need to be told apart from a plain backup directory.
    """
    if (path / ".git").is_dir():
        return True
    return (path / "HEAD").is_file() and (path / "objects").is_dir() and (path / "refs").is_dir()


def import_git(url: str, dest: Path) -> Path:
    """Clone `url` into `dest`, or pull it if `dest` already holds a clone of it."""
    dest = Path(dest).expanduser().resolve()
    if dest.exists() and gitutil.is_repo(dest):
        gitutil.set_remote(dest, url)
        gitutil.pull(dest)
    else:
        if dest.exists() and any(dest.iterdir()):
            raise ImportError_(f"{dest} already exists and is not empty; choose an empty destination.")
        gitutil.clone(url, dest)
    _require_manifest(dest)
    return dest


def import_zip(zip_path: Path, dest: Path) -> Path:
    """Extract a ClaudeSync backup archive into `dest`."""
    zip_path = Path(zip_path).expanduser().resolve()
    dest = Path(dest).expanduser().resolve()
    dest.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest)

    # Tolerate an archive that wraps everything in one top-level folder
    # (e.g. what a naive "zip this directory" in a GUI file manager makes).
    if not (dest / MANIFEST_NAME).is_file():
        children = list(dest.iterdir())
        if len(children) == 1 and children[0].is_dir() and (children[0] / MANIFEST_NAME).is_file():
            wrapper = children[0]
            for child in wrapper.iterdir():
                child.rename(dest / child.name)
            wrapper.rmdir()

    _require_manifest(dest)
    return dest


def import_directory(source: Path) -> Path:
    """Validate an existing local directory is a usable backup; used as-is."""
    source = Path(source).expanduser().resolve()
    _require_manifest(source)
    return source


def import_source(source: str, dest: Path) -> Path:
    """Dispatch on what `source` looks like: a git URL, a .zip file, or a directory."""
    if looks_like_git_url(source):
        return import_git(source, dest)

    path = Path(source).expanduser()
    if path.is_file() and path.suffix == ".zip":
        return import_zip(path, dest)
    if path.is_dir():
        if (path / MANIFEST_NAME).is_file():
            return import_directory(path)
        if _looks_like_local_git_repo(path):
            return import_git(str(path), dest)
        raise ImportError_(
            f"{path} is a directory but has neither a {MANIFEST_NAME} nor a .git — "
            "it's not a ClaudeSync backup or a git repo."
        )

    raise ImportError_(
        f"Don't know how to import {source!r}: it's not a git URL, a .zip file, or an existing directory."
    )
