'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runBackup } = require('../src/core/backup');
const restore = require('../src/core/restore');

// `git commit` (inside runBackup) fails with "Author identity unknown" on
// any machine/runner without a global git user.name/user.email already
// configured. Setting these here makes the suite self-contained instead
// of depending on the host's git config; it has no effect on the app
// itself, since real backups still commit under the user's own identity.
process.env.GIT_AUTHOR_NAME ||= 'ClaudeSync Tests';
process.env.GIT_AUTHOR_EMAIL ||= 'claudesync-tests@example.com';
process.env.GIT_COMMITTER_NAME ||= process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL ||= process.env.GIT_AUTHOR_EMAIL;

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesync-desktop-'));
  const home = path.join(root, 'home');
  const dest = path.join(root, 'backup');
  const project = path.join(home, 'work', 'demo');

  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

  fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'global memory', 'utf8');
  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({ projects: { [project]: {} } }),
    'utf8'
  );
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), 'project memory', 'utf8');

  const skillDir = path.join(home, '.claude', 'skills', 'demo-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'skill content', 'utf8');

  return { root, home, dest, project };
}

test('backup creates a manifest and commits', () => {
  const { home, dest } = makeFixture();
  const result = runBackup({ destDir: dest, home });

  assert.ok(fs.existsSync(path.join(dest, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(dest, '.git')));
  assert.equal(result.committed, true);

  const manifest = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'));
  const categories = new Set(manifest.items.map((i) => i.category));
  assert.ok(categories.has('memory'));
  assert.ok(categories.has('skill'));
});

test('a second backup with no changes does not commit again', () => {
  const { home, dest } = makeFixture();
  runBackup({ destDir: dest, home });
  const second = runBackup({ destDir: dest, home });
  assert.equal(second.committed, false);
});

test('restore writes files back to their original locations', () => {
  const { home, dest, project } = makeFixture();
  runBackup({ destDir: dest, home });

  fs.rmSync(path.join(home, '.claude', 'CLAUDE.md'));
  fs.rmSync(path.join(project, 'CLAUDE.md'));

  const plan = restore.buildPlan(dest);
  const restored = restore.applyPlan(plan);

  assert.ok(restored > 0);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), 'global memory');
  assert.equal(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), 'project memory');
});

test('restore dry run changes nothing', () => {
  const { home, dest } = makeFixture();
  runBackup({ destDir: dest, home });
  fs.rmSync(path.join(home, '.claude', 'CLAUDE.md'));

  const plan = restore.buildPlan(dest);
  restore.applyPlan(plan, { dryRun: true });

  assert.equal(fs.existsSync(path.join(home, '.claude', 'CLAUDE.md')), false);
});

test('restore can be filtered by category', () => {
  const { home, dest } = makeFixture();
  runBackup({ destDir: dest, home });

  const plan = restore.buildPlan(dest, { categories: new Set(['skill']) });
  assert.ok(plan.length >= 1);
  assert.ok(plan.every((p) => p.category === 'skill'));
});
