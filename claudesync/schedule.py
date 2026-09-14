"""Install/remove a recurring backup job (cron on Linux, launchd on macOS)."""

from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path

CRON_MARKER = "# claudesync-auto-backup"
LAUNCHD_LABEL = "com.claudesync.autobackup"


def _launchd_plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LAUNCHD_LABEL}.plist"


def _command(dest: Path, extra_args: str) -> str:
    python = sys.executable
    args = f"{python} -m claudesync backup --dest {dest}"
    if extra_args:
        args += f" {extra_args}"
    return args


def install(dest: Path, interval_hours: int = 6, push: bool = True) -> str:
    extra = "--push" if push else ""
    cmd = _command(dest, extra)

    if platform.system() == "Darwin":
        return _install_launchd(cmd, interval_hours)
    return _install_cron(cmd, interval_hours)


def uninstall() -> str:
    if platform.system() == "Darwin":
        return _uninstall_launchd()
    return _uninstall_cron()


def _install_cron(cmd: str, interval_hours: int) -> str:
    existing = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    lines = [] if existing.returncode != 0 else existing.stdout.splitlines()
    lines = [line for line in lines if CRON_MARKER not in line]
    lines.append(f"0 */{interval_hours} * * * {cmd} {CRON_MARKER}")

    proc = subprocess.run(["crontab", "-"], input="\n".join(lines) + "\n", text=True)
    if proc.returncode != 0:
        raise RuntimeError("Failed to install crontab entry")
    return f"Installed cron job running every {interval_hours}h: {cmd}"


def _uninstall_cron() -> str:
    existing = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    if existing.returncode != 0:
        return "No crontab to modify"
    lines = [line for line in existing.stdout.splitlines() if CRON_MARKER not in line]
    subprocess.run(["crontab", "-"], input="\n".join(lines) + "\n", text=True)
    return "Removed claudesync cron job (if any)"


def _install_launchd(cmd: str, interval_hours: int) -> str:
    plist_path = _launchd_plist_path()
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    program_args = cmd.split()
    args_xml = "\n".join(f"        <string>{arg}</string>" for arg in program_args)
    plist = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>{LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
{args_xml}
    </array>
    <key>StartInterval</key>
    <integer>{interval_hours * 3600}</integer>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
"""
    plist_path.write_text(plist, encoding="utf-8")
    subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True)
    subprocess.run(["launchctl", "load", str(plist_path)], capture_output=True)
    return f"Installed launchd job at {plist_path}, running every {interval_hours}h"


def _uninstall_launchd() -> str:
    plist_path = _launchd_plist_path()
    subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True)
    if plist_path.exists():
        plist_path.unlink()
    return "Removed claudesync launchd job (if any)"
