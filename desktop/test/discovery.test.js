'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { GLOBAL_SCOPE, discoverProjects, scanAll } = require('../src/core/discovery');

function makeFakeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudesync-home-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return home;
}

function write(home, relPath, content = 'hello') {
  const full = path.join(home, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  return full;
}

test('discoverProjects returns empty without a ~/.claude.json', () => {
  const home = makeFakeHome();
  assert.deepEqual(discoverProjects(home), []);
});

test('discoverProjects reads the projects map from ~/.claude.json', () => {
  const home = makeFakeHome();
  const project = path.join(home, 'projects', 'demo');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({ projects: { [project]: {} } }),
    'utf8'
  );
  assert.deepEqual(discoverProjects(home), [project]);
});

test('discoverProjects ignores projects that no longer exist on disk', () => {
  const home = makeFakeHome();
  const missing = path.join(home, 'gone');
  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({ projects: { [missing]: {} } }),
    'utf8'
  );
  assert.deepEqual(discoverProjects(home), []);
});

test('discoverProjects tolerates malformed JSON', () => {
  const home = makeFakeHome();
  fs.writeFileSync(path.join(home, '.claude.json'), '{not json', 'utf8');
  assert.deepEqual(discoverProjects(home), []);
});

test('scanAll discovers global memory and settings', () => {
  const home = makeFakeHome();
  write(home, '.claude/CLAUDE.md', '# global memory');
  write(home, '.claude/settings.json', '{}');

  const items = scanAll({ home });
  const has = (category) => items.some((i) => i.category === category && i.scope === GLOBAL_SCOPE);

  assert.ok(has('memory'));
  assert.ok(has('settings'));
});

test('scanAll treats a skill directory as a single unit', () => {
  const home = makeFakeHome();
  const skillDir = path.join(home, '.claude', 'skills', 'my-skill');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'skill body', 'utf8');
  fs.writeFileSync(path.join(skillDir, 'helper.py'), 'print(1)', 'utf8');

  const items = scanAll({ home }).filter((i) => i.category === 'skill');
  assert.equal(items.length, 1);
  assert.equal(items[0].isDir, true);
  assert.equal(items[0].source, skillDir);
});

test('scanAll discovers project items from ~/.claude.json', () => {
  const home = makeFakeHome();
  const project = path.join(home, 'projects', 'demo');
  fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({ projects: { [project]: {} } }),
    'utf8'
  );
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# project memory', 'utf8');
  fs.writeFileSync(path.join(project, '.mcp.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(project, '.claude', 'agents', 'reviewer.md'), 'agent body', 'utf8');

  const items = scanAll({ home });
  const find = (category) => items.find((i) => i.category === category && i.scope === project);

  assert.ok(find('memory'));
  assert.ok(find('mcp'));
  assert.ok(find('agent'));
});

test('extra projects are included without duplication', () => {
  const home = makeFakeHome();
  const project = path.join(home, 'projects', 'demo');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# project memory', 'utf8');

  const items = scanAll({ home, extraProjects: [project, project] });
  const memoryItems = items.filter((i) => i.category === 'memory' && i.scope === project);
  assert.equal(memoryItems.length, 1);
});
