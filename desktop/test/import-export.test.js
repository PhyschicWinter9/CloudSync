'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { runBackup } = require('../src/core/backup');
const importer = require('../src/core/importer');
const exporter = require('../src/core/exporter');
const { readZip } = require('../src/core/zip');

// See backup-restore.test.js: makes `git commit` work without relying on
// the host already having a global git identity configured.
process.env.GIT_AUTHOR_NAME ||= 'ClaudeSync Tests';
process.env.GIT_AUTHOR_EMAIL ||= 'claudesync-tests@example.com';
process.env.GIT_COMMITTER_NAME ||= process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL ||= process.env.GIT_AUTHOR_EMAIL;

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesync-importexport-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'global memory', 'utf8');

  const backupDir = path.join(root, 'backup');
  runBackup({ destDir: backupDir, home });

  return { root, home, backupDir };
}

test('exportZip produces a zip containing the manifest', () => {
  const { backupDir, root } = makeFixture();
  const outPath = exporter.exportZip(backupDir, path.join(root, 'out.zip'));
  const entries = readZip(fs.readFileSync(outPath));
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('manifest.json'));
  assert.ok(names.some((n) => n.endsWith('CLAUDE.md')));
  assert.ok(!names.some((n) => n.includes('.git/')));
});

test('exportZip can include git history', () => {
  const { backupDir, root } = makeFixture();
  const outPath = exporter.exportZip(backupDir, path.join(root, 'out-git.zip'), { includeGitHistory: true });
  const entries = readZip(fs.readFileSync(outPath));
  assert.ok(entries.some((e) => e.name.includes('.git/')));
});

test('exportZip without a manifest fails', () => {
  const { root } = makeFixture();
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  assert.throws(() => exporter.exportZip(empty, path.join(root, 'nope.zip')), exporter.ExportError);
});

test('round-trip zip import restores the manifest and files', () => {
  const { backupDir, root } = makeFixture();
  const zipPath = exporter.exportZip(backupDir, path.join(root, 'out.zip'));

  const dest = path.join(root, 'imported');
  const resultDir = importer.importZip(zipPath, dest);

  assert.equal(resultDir, dest);
  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  assert.ok(manifest.items.length >= 1);
  assert.ok(fs.existsSync(path.join(dest, 'global', '.claude', 'CLAUDE.md')));
});

test('importSource dispatches a .zip path to importZip', () => {
  const { backupDir, root } = makeFixture();
  const zipPath = exporter.exportZip(backupDir, path.join(root, 'out.zip'));
  const dest = path.join(root, 'imported2');
  const resultDir = importer.importSource(zipPath, dest);
  assert.ok(fs.existsSync(path.join(resultDir, 'manifest.json')));
});

test('importZip unwraps a single top-level folder', () => {
  const { backupDir, root } = makeFixture();
  const { buildZip } = require('../src/core/zip');
  const wrapped = buildZip([
    { name: 'my-backup/manifest.json', data: fs.readFileSync(path.join(backupDir, 'manifest.json')) },
    {
      name: 'my-backup/global/.claude/CLAUDE.md',
      data: fs.readFileSync(path.join(backupDir, 'global', '.claude', 'CLAUDE.md')),
    },
  ]);
  const wrappedPath = path.join(root, 'wrapped.zip');
  fs.writeFileSync(wrappedPath, wrapped);

  const dest = path.join(root, 'imported-wrapped');
  const resultDir = importer.importZip(wrappedPath, dest);
  assert.ok(fs.existsSync(path.join(resultDir, 'manifest.json')));
});

test('importDirectory validates and returns the directory', () => {
  const { backupDir } = makeFixture();
  const resultDir = importer.importDirectory(backupDir);
  assert.equal(resultDir, path.resolve(backupDir));
});

test('importDirectory without a manifest fails', () => {
  const { root } = makeFixture();
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  assert.throws(() => importer.importDirectory(empty), importer.ImportError);
});

test('importSource dispatches a local bare repo path (not a manifest dir)', () => {
  const { backupDir, root } = makeFixture();
  const bare = path.join(root, 'remote.git');
  git(['init', '--bare', bare], root);
  git(['remote', 'add', 'origin', bare], backupDir);
  git(['push', '-u', 'origin', 'HEAD'], backupDir);

  const dest = path.join(root, 'imported-from-bare-path');
  const resultDir = importer.importSource(bare, dest);
  assert.ok(fs.existsSync(path.join(resultDir, 'manifest.json')));
});

test('looksLikeGitUrl recognizes common git URL shapes', () => {
  assert.equal(importer.looksLikeGitUrl('git@github.com:x/y.git'), true);
  assert.equal(importer.looksLikeGitUrl('https://github.com/x/y.git'), true);
  assert.equal(importer.looksLikeGitUrl('/some/local/path'), false);
  assert.equal(importer.looksLikeGitUrl('backup.zip'), false);
});

test('importGit clones then pulls on a second import', () => {
  const { backupDir, root, home } = makeFixture();
  const bare = path.join(root, 'remote.git');
  git(['init', '--bare', bare], root);
  git(['remote', 'add', 'origin', bare], backupDir);
  git(['push', '-u', 'origin', 'HEAD'], backupDir);

  const cloneDest = path.join(root, 'clone');
  const resultDir = importer.importGit(bare, cloneDest);
  assert.ok(fs.existsSync(path.join(resultDir, 'manifest.json')));

  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'updated memory', 'utf8');
  runBackup({ destDir: backupDir, home, push: true });

  const resultDir2 = importer.importGit(bare, cloneDest);
  assert.equal(resultDir2, path.resolve(cloneDest));
  const content = fs.readFileSync(path.join(cloneDest, 'global', '.claude', 'CLAUDE.md'), 'utf8');
  assert.equal(content, 'updated memory');
});

test('backup with pullFirst stays a fast-forward across two machines', () => {
  const { root, home } = makeFixture();
  const bare = path.join(root, 'remote2.git');
  git(['init', '--bare', bare], root);

  const machineA = path.join(root, 'machine-a');
  runBackup({ destDir: machineA, home, remoteUrl: bare, push: true });

  const machineB = path.join(root, 'machine-b');
  importer.importGit(bare, machineB);
  const homeB = path.join(root, 'home-b');
  fs.mkdirSync(path.join(homeB, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(homeB, '.claude', 'CLAUDE.md'), 'machine b memory', 'utf8');
  const resultB = runBackup({ destDir: machineB, home: homeB, remoteUrl: bare, push: true, pullFirst: true });
  assert.equal(resultB.pushed, true);

  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'machine a memory v2', 'utf8');
  const resultA = runBackup({ destDir: machineA, home, remoteUrl: bare, push: true, pullFirst: true });
  assert.equal(resultA.pulled, true);
  assert.equal(resultA.pushed, true);
});
