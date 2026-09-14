import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from claudesync import exporter, importer
from claudesync.backup import run_backup


def _git(args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


class ImportExportTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

        self.home = self.root / "home"
        self.home.mkdir()
        (self.home / ".claude").mkdir()
        (self.home / ".claude" / "CLAUDE.md").write_text("global memory", encoding="utf-8")

        self.backup_dir = self.root / "backup"
        run_backup(self.backup_dir, home=self.home)


class TestExportZip(ImportExportTestCase):
    def test_export_produces_a_zip_with_the_manifest(self):
        out = exporter.export_zip(self.backup_dir, self.root / "out.zip")
        self.assertTrue(out.is_file())

        import zipfile

        with zipfile.ZipFile(out) as zf:
            names = zf.namelist()
        self.assertIn("manifest.json", names)
        self.assertTrue(any(n.endswith("CLAUDE.md") for n in names))
        self.assertFalse(any(".git/" in n for n in names))

    def test_export_can_include_git_history(self):
        out = exporter.export_zip(self.backup_dir, self.root / "out-with-git.zip", include_git_history=True)

        import zipfile

        with zipfile.ZipFile(out) as zf:
            names = zf.namelist()
        self.assertTrue(any(".git/" in n for n in names))

    def test_export_without_manifest_fails(self):
        empty = self.root / "empty"
        empty.mkdir()
        with self.assertRaises(exporter.ExportError):
            exporter.export_zip(empty, self.root / "nope.zip")


class TestImportZip(ImportExportTestCase):
    def test_round_trip_zip_import(self):
        zip_path = exporter.export_zip(self.backup_dir, self.root / "out.zip")

        dest = self.root / "imported"
        result_dir = importer.import_zip(zip_path, dest)

        self.assertEqual(result_dir, dest.resolve())
        manifest = json.loads((dest / "manifest.json").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(manifest["items"]), 1)
        self.assertTrue((dest / "global" / ".claude" / "CLAUDE.md").is_file())

    def test_import_dispatches_by_extension(self):
        zip_path = exporter.export_zip(self.backup_dir, self.root / "out.zip")
        dest = self.root / "imported2"
        result_dir = importer.import_source(str(zip_path), dest)
        self.assertTrue((result_dir / "manifest.json").is_file())

    def test_import_zip_unwraps_a_single_top_level_folder(self):
        import zipfile

        wrapped_zip = self.root / "wrapped.zip"
        with zipfile.ZipFile(wrapped_zip, "w") as zf:
            zf.write(self.backup_dir / "manifest.json", "my-backup/manifest.json")
            zf.write(
                self.backup_dir / "global" / ".claude" / "CLAUDE.md",
                "my-backup/global/.claude/CLAUDE.md",
            )

        dest = self.root / "imported-wrapped"
        result_dir = importer.import_zip(wrapped_zip, dest)
        self.assertTrue((result_dir / "manifest.json").is_file())


class TestImportDirectory(ImportExportTestCase):
    def test_import_directory_validates_and_returns_it(self):
        result_dir = importer.import_directory(self.backup_dir)
        self.assertEqual(result_dir, self.backup_dir.resolve())

    def test_import_directory_without_manifest_fails(self):
        empty = self.root / "empty"
        empty.mkdir()
        with self.assertRaises(importer.ImportError_):
            importer.import_directory(empty)


class TestImportGit(ImportExportTestCase):
    def test_clone_then_pull(self):
        bare = self.root / "remote.git"
        _git(["init", "--bare", str(bare)], self.root)
        _git(["remote", "add", "origin", str(bare)], self.backup_dir)
        _git(["push", "-u", "origin", "HEAD"], self.backup_dir)

        clone_dest = self.root / "clone"
        result_dir = importer.import_git(str(bare), clone_dest)
        self.assertTrue((result_dir / "manifest.json").is_file())

        # A second machine pushes a change...
        (self.home / ".claude" / "CLAUDE.md").write_text("updated memory", encoding="utf-8")
        run_backup(self.backup_dir, home=self.home, push=True)

        # ...and importing again into the same clone should pull it.
        result_dir_2 = importer.import_git(str(bare), clone_dest)
        self.assertEqual(result_dir_2, clone_dest.resolve())
        content = (clone_dest / "global" / ".claude" / "CLAUDE.md").read_text(encoding="utf-8")
        self.assertEqual(content, "updated memory")

    def test_import_source_dispatches_a_local_bare_repo_path(self):
        # A bare repo path (e.g. a NAS mount used as a "cloud" remote) has
        # no manifest.json of its own but should still be treated as a git
        # source rather than rejected as "not a backup directory".
        bare = self.root / "remote.git"
        _git(["init", "--bare", str(bare)], self.root)
        _git(["remote", "add", "origin", str(bare)], self.backup_dir)
        _git(["push", "-u", "origin", "HEAD"], self.backup_dir)

        dest = self.root / "imported-from-bare-path"
        result_dir = importer.import_source(str(bare), dest)
        self.assertTrue((result_dir / "manifest.json").is_file())

    def test_looks_like_git_url(self):
        self.assertTrue(importer.looks_like_git_url("git@github.com:x/y.git"))
        self.assertTrue(importer.looks_like_git_url("https://github.com/x/y.git"))
        self.assertFalse(importer.looks_like_git_url("/some/local/path"))
        self.assertFalse(importer.looks_like_git_url("backup.zip"))


class TestPullFirst(ImportExportTestCase):
    def test_backup_with_pull_first_stays_a_fast_forward(self):
        bare = self.root / "remote.git"
        _git(["init", "--bare", str(bare)], self.root)

        machine_a = self.root / "machine-a"
        run_backup(machine_a, home=self.home, remote_url=str(bare), push=True)

        # Machine B clones the shared remote and adds its own project.
        machine_b = self.root / "machine-b"
        importer.import_git(str(bare), machine_b)
        home_b = self.root / "home-b"
        (home_b / ".claude").mkdir(parents=True)
        (home_b / ".claude" / "CLAUDE.md").write_text("machine b memory", encoding="utf-8")
        result_b = run_backup(machine_b, home=home_b, remote_url=str(bare), push=True, pull_first=True)
        self.assertTrue(result_b.pushed)

        # Machine A backs up again without first pulling B's push: with
        # pull_first this still succeeds instead of being rejected as a
        # non-fast-forward push.
        (self.home / ".claude" / "CLAUDE.md").write_text("machine a memory v2", encoding="utf-8")
        result_a = run_backup(machine_a, home=self.home, remote_url=str(bare), push=True, pull_first=True)
        self.assertTrue(result_a.pulled)
        self.assertTrue(result_a.pushed)


if __name__ == "__main__":
    unittest.main()
