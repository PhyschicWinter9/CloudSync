"""Scanner that discovers everything Claude Code stores on a machine.

Two scopes are scanned:

* **global** -- ``~/.claude/`` (or ``$CLAUDE_CONFIG_DIR``) plus the
  top-level ``~/.claude.json`` config file.
* **project** -- every directory Claude Code has ever been opened in.
  That list comes straight from ``~/.claude.json``'s ``"projects"`` map,
  which is the same source Claude Code Organizer uses, so results line up
  with what that tool shows.

Each discovered item is a :class:`DiscoveredItem`: either a single file
(memory, settings, an individual agent/command/rule/plan) or a whole
directory that should be copied as a unit (a skill, the plugin cache, the
session transcript store).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator

GLOBAL_SCOPE = "global"


def claude_home(home: Path | None = None) -> Path:
    """Return Claude Code's global config directory.

    Honors ``$CLAUDE_CONFIG_DIR`` when set, otherwise ``<home>/.claude``.
    """
    override = os.environ.get("CLAUDE_CONFIG_DIR")
    if override:
        return Path(override).expanduser()
    return (home or Path.home()) / ".claude"


def claude_json_path(home: Path | None = None) -> Path:
    return (home or Path.home()) / ".claude.json"


@dataclass(frozen=True)
class DiscoveredItem:
    category: str  # memory | settings | mcp | agent | command | rule | plan | skill | session | plugin
    scope: str  # GLOBAL_SCOPE, or the absolute path of a project
    source: Path  # absolute path on disk (file or directory)
    is_dir: bool

    @property
    def label(self) -> str:
        return f"[{self.category}] {self.scope} -> {self.source}"


# (category, relative glob, is_dir_unit)
# is_dir_unit=True means the whole matched directory is copied as one item
# instead of being expanded file-by-file.
_GLOBAL_SPECS: tuple[tuple[str, str, bool], ...] = (
    ("memory", "CLAUDE.md", False),
    ("memory", "CLAUDE.local.md", False),
    ("settings", "settings.json", False),
    ("settings", "settings.local.json", False),
    ("mcp", "mcp.json", False),
    ("agent", "agents/**/*.md", False),
    ("command", "commands/**/*.md", False),
    ("rule", "rules/**/*.md", False),
    ("plan", "plans/**/*.md", False),
    ("skill", "skills/*", True),
    ("plugin", "plugins/*", True),
    ("session", "projects", True),
)

_PROJECT_SPECS: tuple[tuple[str, str, bool], ...] = (
    ("memory", "CLAUDE.md", False),
    ("memory", "CLAUDE.local.md", False),
    ("mcp", ".mcp.json", False),
    ("settings", ".claude/settings.json", False),
    ("settings", ".claude/settings.local.json", False),
    ("agent", ".claude/agents/**/*.md", False),
    ("command", ".claude/commands/**/*.md", False),
    ("rule", ".claude/rules/**/*.md", False),
    ("plan", ".claude/plans/**/*.md", False),
    ("skill", ".claude/skills/*", True),
)


def _expand(root: Path, category: str, pattern: str, is_dir_unit: bool) -> Iterator[Path]:
    if "*" not in pattern:
        candidate = root / pattern
        if candidate.exists():
            yield candidate
        return

    for match in sorted(root.glob(pattern)):
        if is_dir_unit and not match.is_dir():
            continue
        if not is_dir_unit and not match.is_file():
            continue
        yield match


def discover_projects(home: Path | None = None) -> list[Path]:
    """Return every project directory recorded in ``~/.claude.json``.

    Missing or unparsable config yields an empty list rather than raising,
    since a fresh machine may not have one yet.
    """
    path = claude_json_path(home)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    projects = data.get("projects")
    if not isinstance(projects, dict):
        return []

    result = []
    for raw_path in projects:
        candidate = Path(raw_path).expanduser()
        if candidate.is_dir():
            result.append(candidate)
    return result


def scan_global(home: Path | None = None) -> Iterator[DiscoveredItem]:
    home = home or Path.home()
    root = claude_home(home)

    claude_json = claude_json_path(home)
    if claude_json.is_file():
        yield DiscoveredItem("mcp", GLOBAL_SCOPE, claude_json, False)

    if not root.is_dir():
        return

    for category, pattern, is_dir_unit in _GLOBAL_SPECS:
        for match in _expand(root, category, pattern, is_dir_unit):
            yield DiscoveredItem(category, GLOBAL_SCOPE, match, match.is_dir())


def scan_project(project_path: Path) -> Iterator[DiscoveredItem]:
    project_path = Path(project_path)
    if not project_path.is_dir():
        return

    for category, pattern, is_dir_unit in _PROJECT_SPECS:
        for match in _expand(project_path, category, pattern, is_dir_unit):
            yield DiscoveredItem(category, str(project_path), match, match.is_dir())


def scan_all(
    extra_projects: Iterable[Path] = (),
    home: Path | None = None,
) -> list[DiscoveredItem]:
    """Scan the global scope plus every known (and extra) project."""
    items: list[DiscoveredItem] = list(scan_global(home))

    seen_projects: set[Path] = set()
    for project in list(discover_projects(home)) + list(extra_projects):
        project_path = Path(project).expanduser()
        # Resolve only to dedupe (so a symlinked or short-path alias of a
        # project already seen isn't scanned twice); keep the unresolved
        # path as the item's scope so it matches what's actually recorded
        # in ~/.claude.json instead of an OS-normalized alias of it.
        resolved = project_path.resolve()
        if resolved in seen_projects:
            continue
        seen_projects.add(resolved)
        items.extend(scan_project(project_path))

    return items
