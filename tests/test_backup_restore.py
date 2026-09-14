import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from claudesync import restore
from claudesync.backup import run_backup


def _git(args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


class TestBackupRestoreRoundTrip(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

        self.home = self.root / "home"
        self.dest = self.root / "backup"
        self.project = self.home / "work" / "demo"
        self.project.mkdir(parents=True)
        (self.home / ".claude").mkdir(parents=True)

        (self.home / ".claude" / "CLAUDE.md").write_text("global memory", encoding="utf-8")
        (self.home / ".claude.json").write_text(
            json.dumps({"projects": {str(self.project): {}}}), encoding="utf-8"
        )
        (self.project / "CLAUDE.md").write_text("project memory", encoding="utf-8")

        skill_dir = self.home / ".claude" / "skills" / "demo-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("skill content", encoding="utf-8")

    def test_backup_creates_manifest_and_commits(self):
        result = run_backup(self.dest, home=self.home)

        self.assertTrue((self.dest / "manifest.json").is_file())
        self.assertTrue((self.dest / ".git").is_dir())
        self.assertTrue(result.committed)

        manifest = json.loads((self.dest / "manifest.json").read_text(encoding="utf-8"))
        categories = {item["category"] for item in manifest["items"]}
        self.assertIn("memory", categories)
        self.assertIn("skill", categories)

    def test_second_backup_with_no_changes_does_not_commit(self):
        run_backup(self.dest, home=self.home)
        result = run_backup(self.dest, home=self.home)
        self.assertFalse(result.committed)

    def test_restore_writes_files_back(self):
        run_backup(self.dest, home=self.home)

        # Simulate a fresh machine: wipe the "live" copies.
        (self.home / ".claude" / "CLAUDE.md").unlink()
        (self.project / "CLAUDE.md").unlink()

        plan = restore.build_plan(self.dest)
        restored = restore.apply_plan(plan)

        self.assertGreater(restored, 0)
        self.assertEqual(
            (self.home / ".claude" / "CLAUDE.md").read_text(encoding="utf-8"), "global memory"
        )
        self.assertEqual((self.project / "CLAUDE.md").read_text(encoding="utf-8"), "project memory")

    def test_restore_dry_run_changes_nothing(self):
        run_backup(self.dest, home=self.home)
        (self.home / ".claude" / "CLAUDE.md").unlink()

        plan = restore.build_plan(self.dest)
        restore.apply_plan(plan, dry_run=True)

        self.assertFalse((self.home / ".claude" / "CLAUDE.md").exists())

    def test_restore_can_filter_by_category(self):
        run_backup(self.dest, home=self.home)
        plan = restore.build_plan(self.dest, categories={"skill"})
        self.assertTrue(all(p.category == "skill" for p in plan))
        self.assertGreaterEqual(len(plan), 1)


if __name__ == "__main__":
    unittest.main()
