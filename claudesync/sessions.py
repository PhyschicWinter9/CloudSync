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
import re
from dataclasses import dataclass
from datetime import datetime
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


def render_markdown(jsonl_path: Path, title: str) -> str:
    """Render a whole transcript as a readable Markdown document."""
    lines = [f"# Chat session: {title}", ""]
    any_messages = False
    for msg in iterate_messages(jsonl_path):
        any_messages = True
        role = (msg["role"] or "unknown").replace("_", " ").capitalize()
        lines.append(f"**{role}**")
        lines.append("")
        lines.append(msg["text"] if msg["text"] else "*(no text)*")
        lines.append("")
    if not any_messages:
        lines.append("*(no readable messages found in this transcript)*")
    return "\n".join(lines)


_SLUG_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _slugify(text: str) -> str:
    slug = _SLUG_RE.sub("-", text).strip("-")
    return slug or "session"


def export_all_sessions(root: Path, out_dir: Path, fmt: str = "md") -> list[Path]:
    """Write every chat session found under `root` as one readable file per
    session in `out_dir` (markdown by default, or plain text), so the whole
    chat history can be browsed or archived without ClaudeSync or the raw
    .jsonl format.
    """
    if fmt not in ("md", "txt"):
        raise ValueError(f"Unknown export format: {fmt!r} (expected 'md' or 'txt')")

    out_dir = Path(out_dir).expanduser()
    out_dir.mkdir(parents=True, exist_ok=True)

    written: list[Path] = []
    used_names: set[str] = set()
    for info in list_sessions(root):
        date = datetime.fromtimestamp(info.mtime).strftime("%Y-%m-%d")
        base = _slugify(f"{date}_{info.project_hint}_{info.path.stem}")
        name = f"{base}.{fmt}"
        suffix = 2
        while name in used_names:
            name = f"{base}-{suffix}.{fmt}"
            suffix += 1
        used_names.add(name)

        if fmt == "md":
            content = render_markdown(info.path, title=info.path.stem)
        else:
            content = "\n".join(render_text(info.path)) or "(no readable messages found in this transcript)"

        out_path = out_dir / name
        out_path.write_text(content, encoding="utf-8")
        written.append(out_path)

    return written
