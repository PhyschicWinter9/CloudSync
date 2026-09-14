import json
import tempfile
import unittest
from pathlib import Path

from claudesync.discovery import GLOBAL_SCOPE, discover_projects, scan_all


class FakeHomeTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

        self.claude_dir = self.home / ".claude"
        self.claude_dir.mkdir()

        self.project_dir = self.home / "projects" / "demo"
        self.project_dir.mkdir(parents=True)

    def write(self, relpath: str, content: str = "hello") -> Path:
        path = self.home / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path


class TestDiscoverProjects(FakeHomeTestCase):
    def test_no_claude_json_returns_empty(self):
        self.assertEqual(discover_projects(home=self.home), [])

    def test_reads_projects_from_claude_json(self):
        claude_json = self.home / ".claude.json"
        claude_json.write_text(
            json.dumps({"projects": {str(self.project_dir): {}}}), encoding="utf-8"
        )
        result = discover_projects(home=self.home)
        self.assertEqual(result, [self.project_dir])

    def test_ignores_projects_that_no_longer_exist(self):
        claude_json = self.home / ".claude.json"
        missing = self.home / "gone"
        claude_json.write_text(
            json.dumps({"projects": {str(missing): {}}}), encoding="utf-8"
        )
        self.assertEqual(discover_projects(home=self.home), [])

    def test_malformed_json_is_tolerated(self):
        claude_json = self.home / ".claude.json"
        claude_json.write_text("{not json", encoding="utf-8")
        self.assertEqual(discover_projects(home=self.home), [])


class TestScanAll(FakeHomeTestCase):
    def test_discovers_global_memory_and_settings(self):
        self.write(".claude/CLAUDE.md", "# global memory")
        self.write(".claude/settings.json", "{}")

        items = scan_all(home=self.home)
        categories = {(i.category, i.scope) for i in items}

        self.assertIn(("memory", GLOBAL_SCOPE), categories)
        self.assertIn(("settings", GLOBAL_SCOPE), categories)

    def test_discovers_global_skill_directory_as_one_unit(self):
        skill_dir = self.claude_dir / "skills" / "my-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text("skill body", encoding="utf-8")
        (skill_dir / "helper.py").write_text("print(1)", encoding="utf-8")

        items = [i for i in scan_all(home=self.home) if i.category == "skill"]
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0].is_dir)
        self.assertEqual(items[0].source, skill_dir)

    def test_discovers_project_items(self):
        claude_json = self.home / ".claude.json"
        claude_json.write_text(
            json.dumps({"projects": {str(self.project_dir): {}}}), encoding="utf-8"
        )
        (self.project_dir / "CLAUDE.md").write_text("# project memory", encoding="utf-8")
        (self.project_dir / ".mcp.json").write_text("{}", encoding="utf-8")
        agents_dir = self.project_dir / ".claude" / "agents"
        agents_dir.mkdir(parents=True)
        (agents_dir / "reviewer.md").write_text("agent body", encoding="utf-8")

        items = scan_all(home=self.home)
        by_category_scope = {(i.category, i.scope): i for i in items}

        self.assertIn(("memory", str(self.project_dir)), by_category_scope)
        self.assertIn(("mcp", str(self.project_dir)), by_category_scope)
        self.assertIn(("agent", str(self.project_dir)), by_category_scope)

    def test_extra_projects_are_included_without_duplication(self):
        (self.project_dir / "CLAUDE.md").write_text("# project memory", encoding="utf-8")

        items = scan_all(extra_projects=[self.project_dir, self.project_dir], home=self.home)
        memory_items = [i for i in items if i.category == "memory" and i.scope == str(self.project_dir)]
        self.assertEqual(len(memory_items), 1)


if __name__ == "__main__":
    unittest.main()
