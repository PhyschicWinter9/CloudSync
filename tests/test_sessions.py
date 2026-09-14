import json
import tempfile
import unittest
from pathlib import Path

from claudesync import sessions


def _line(obj) -> str:
    return json.dumps(obj)


class TestIterateMessages(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def write_jsonl(self, name: str, lines: list) -> Path:
        path = self.root / name
        path.write_text("\n".join(_line(l) for l in lines) + "\n", encoding="utf-8")
        return path

    def test_extracts_plain_string_content(self):
        path = self.write_jsonl(
            "a.jsonl",
            [
                {"type": "user", "message": {"role": "user", "content": "hello there"}, "timestamp": "t1"},
                {"type": "assistant", "message": {"role": "assistant", "content": "hi!"}, "timestamp": "t2"},
            ],
        )
        messages = list(sessions.iterate_messages(path))
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0], {"role": "user", "text": "hello there", "timestamp": "t1"})
        self.assertEqual(messages[1]["role"], "assistant")
        self.assertEqual(messages[1]["text"], "hi!")

    def test_extracts_block_list_content_with_tool_use_and_result(self):
        path = self.write_jsonl(
            "b.jsonl",
            [
                {
                    "type": "assistant",
                    "message": {
                        "role": "assistant",
                        "content": [
                            {"type": "text", "text": "Let me check that."},
                            {"type": "tool_use", "name": "Bash", "input": {}},
                        ],
                    },
                },
                {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "ok"}]}},
            ],
        )
        messages = list(sessions.iterate_messages(path))
        self.assertIn("Let me check that.", messages[0]["text"])
        self.assertIn("[used tool: Bash]", messages[0]["text"])
        self.assertEqual(messages[1]["text"], "[tool result]")

    def test_falls_back_to_top_level_type_when_no_message_role(self):
        path = self.write_jsonl("c.jsonl", [{"type": "summary", "summary": "a chat about widgets"}])
        messages = list(sessions.iterate_messages(path))
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "summary")

    def test_skips_malformed_lines_without_crashing(self):
        path = self.root / "d.jsonl"
        path.write_text(
            "not json at all\n"
            + _line({"type": "user", "message": {"role": "user", "content": "still works"}})
            + "\n"
            + "{broken\n",
            encoding="utf-8",
        )
        messages = list(sessions.iterate_messages(path))
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["text"], "still works")

    def test_skips_lines_with_neither_a_type_nor_a_message(self):
        path = self.write_jsonl("e.jsonl", [{"foo": "bar"}])
        messages = list(sessions.iterate_messages(path))
        self.assertEqual(len(messages), 0)

    def test_keeps_a_typed_event_even_with_no_text(self):
        path = self.write_jsonl("f.jsonl", [{"type": "file-history-snapshot", "snapshot": {}}])
        messages = list(sessions.iterate_messages(path))
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "file-history-snapshot")
        self.assertEqual(messages[0]["text"], "")


class TestListSessions(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def test_finds_jsonl_files_recursively_with_metadata(self):
        project_dir = self.root / "global" / ".claude" / "projects" / "-home-user-demo"
        project_dir.mkdir(parents=True)
        session_path = project_dir / "abc123.jsonl"
        session_path.write_text(
            _line({"type": "user", "message": {"role": "user", "content": "What does this function do?"}}) + "\n",
            encoding="utf-8",
        )

        infos = sessions.list_sessions(self.root)
        self.assertEqual(len(infos), 1)
        info = infos[0]
        self.assertEqual(info.path, session_path)
        self.assertEqual(info.project_hint, "-home-user-demo")
        self.assertEqual(info.message_count, 1)
        self.assertIn("What does this function do?", info.snippet)

    def test_no_jsonl_files_returns_empty_list(self):
        self.assertEqual(sessions.list_sessions(self.root), [])

    def test_missing_root_returns_empty_list_without_error(self):
        self.assertEqual(sessions.list_sessions(self.root / "does-not-exist"), [])

    def test_sorted_newest_first(self):
        import os
        import time

        project_dir = self.root / "projects"
        project_dir.mkdir()
        older = project_dir / "older.jsonl"
        newer = project_dir / "newer.jsonl"
        older.write_text(_line({"type": "user", "message": {"role": "user", "content": "first"}}), encoding="utf-8")
        time.sleep(0.02)
        newer.write_text(_line({"type": "user", "message": {"role": "user", "content": "second"}}), encoding="utf-8")

        infos = sessions.list_sessions(self.root)
        self.assertEqual([i.path for i in infos], [newer, older])


class TestRenderText(unittest.TestCase):
    def test_truncates_at_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "s.jsonl"
            lines = [_line({"type": "user", "message": {"role": "user", "content": f"msg {i}"}}) for i in range(5)]
            path.write_text("\n".join(lines), encoding="utf-8")

            output = list(sessions.render_text(path, limit=2))
            self.assertEqual(output[0], "[user] msg 0")
            self.assertEqual(output[1], "[user] msg 1")
            self.assertTrue(output[2].startswith("... (truncated"))


if __name__ == "__main__":
    unittest.main()
