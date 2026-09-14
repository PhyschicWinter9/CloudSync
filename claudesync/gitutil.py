"""Small wrapper around the git CLI used to version backups."""

from __future__ import annotations

import subprocess
from pathlib import Path


class GitError(RuntimeError):
    pass


def _run(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
    )


def is_repo(path: Path) -> bool:
    return (path / ".git").is_dir()


def init(path: Path) -> None:
    result = _run(["init"], path)
    if result.returncode != 0:
        raise GitError(result.stderr.strip())


def add_all(path: Path) -> None:
    result = _run(["add", "-A"], path)
    if result.returncode != 0:
        raise GitError(result.stderr.strip())


def has_staged_changes(path: Path) -> bool:
    result = _run(["diff", "--cached", "--quiet"], path)
    # exit code 1 means there ARE staged changes, 0 means none
    return result.returncode == 1


def commit(path: Path, message: str) -> bool:
    """Commit staged changes. Returns False if there was nothing to commit."""
    if not has_staged_changes(path):
        return False
    result = _run(["commit", "-m", message], path)
    if result.returncode != 0:
        raise GitError(result.stderr.strip())
    return True


def set_remote(path: Path, remote_url: str, name: str = "origin") -> None:
    existing = _run(["remote"], path).stdout.split()
    if name in existing:
        _run(["remote", "set-url", name, remote_url], path)
    else:
        _run(["remote", "add", name, remote_url], path)


def push(path: Path, remote: str = "origin", branch: str | None = None) -> None:
    args = ["push", "-u", remote]
    if branch:
        args.append(branch)
    result = _run(args, path)
    if result.returncode != 0:
        raise GitError(result.stderr.strip())


def current_branch(path: Path) -> str:
    result = _run(["rev-parse", "--abbrev-ref", "HEAD"], path)
    branch = result.stdout.strip()
    return branch if branch and branch != "HEAD" else "main"
