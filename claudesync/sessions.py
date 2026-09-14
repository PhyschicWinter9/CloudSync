"""Read Claude Code chat session transcripts (.jsonl files) so a backup or
an imported one can be previewed and verified before you actually restore
it or start trusting it.

Claude Code's transcript format isn't a documented, stable API, so this
parser is deliberately tolerant: it extracts a role and readable text where
it can recognize the shape, and quietly skips whatever it doesn't
recognize (a malformed line, an unfamiliar block type) rather than
crashing. Worst case you see less detail, not an error.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

SNIPPET_LENGTH = 140


@dataclass
class SessionInfo:
    path: Path
    project_hint: str
    size: int
    mtime: float
    message_count: int
    snippet: str


def _extract_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if not isinstance(block, dict):
                continue
            block_type = block.get("type")
            if block_type == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
            elif block_type == "tool_use":
                parts.append(f"[used tool: {block.get('name', 'tool')}]")
            elif block_type == "tool_result":
                parts.append("[tool result]")
        return "\n".join(p for p in parts if p)
    return ""


def iterate_messages(jsonl_path: Path) -> Iterator[dict]:
    """Yield {"role", "text", "timestamp"} dicts, skipping unreadable lines."""
    try:
        lines = Path(jsonl_path).read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(obj, dict):
            continue

        message = obj.get("message")
        role = None
        text = ""
        if isinstance(message, dict):
            role = message.get("role")
            text = _extract_text(message.get("content"))
        if not role:
            role = obj.get("type")
        if not role and not text:
            continue

        yield {"role": role or "unknown", "text": text.strip(), "timestamp": obj.get("timestamp")}


def _snippet(jsonl_path: Path) -> tuple[str, int]:
    count = 0
    snippet = ""
    for msg in iterate_messages(jsonl_path):
        count += 1
        if not snippet and msg["text"]:
            flat = " ".join(msg["text"].split())
            snippet = flat[:SNIPPET_LENGTH] + ("…" if len(flat) > SNIPPET_LENGTH else "")
    return snippet, count


def list_sessions(root: Path) -> list[SessionInfo]:
    """Find every .jsonl session transcript under `root` (a backup, an
    imported directory, or a live ~/.claude directory), newest first.
    """
    root = Path(root).expanduser()
    if not root.is_dir():
        return []

    infos = []
    for path in sorted(root.rglob("*.jsonl")):
        try:
            stat = path.stat()
        except OSError:
            continue
        snippet, count = _snippet(path)
        infos.append(
            SessionInfo(
                path=path,
                project_hint=path.parent.name,
                size=stat.st_size,
                mtime=stat.st_mtime,
                message_count=count,
                snippet=snippet,
            )
        )
    infos.sort(key=lambda i: i.mtime, reverse=True)
    return infos


def render_text(jsonl_path: Path, limit: int | None = None) -> Iterator[str]:
    """Yield formatted "[role] text" lines for a transcript, for printing."""
    count = 0
    for msg in iterate_messages(jsonl_path):
        line = f"[{msg['role']}] {msg['text']}" if msg["text"] else f"[{msg['role']}]"
        yield line
        count += 1
        if limit and count >= limit:
            yield f"... (truncated at {limit} messages; use --limit to see more)"
            break
