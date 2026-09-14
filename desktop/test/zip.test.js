'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { zipDirectory, extractZip, buildZip, readZip } = require('../src/core/zip');

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudesync-zip-'));
}

test('buildZip/readZip round-trips file contents exactly', () => {
  const entries = [
    { name: 'manifest.json', data: Buffer.from('{"a":1}') },
    { name: 'global/.claude/CLAUDE.md', data: Buffer.from('# hello\n'.repeat(50)) },
    { name: 'empty.txt', data: Buffer.alloc(0) },
    { name: 'random.bin', data: crypto.randomBytes(2048) },
  ];

  const zipBuf = buildZip(entries);
  const readBack = readZip(zipBuf);

  assert.equal(readBack.length, entries.length);
  const byName = Object.fromEntries(readBack.map((e) => [e.name, e.data]));
  for (const entry of entries) {
    assert.ok(byName[entry.name].equals(entry.data), `mismatch for ${entry.name}`);
  }
});

test('zipDirectory/extractZip round-trips a directory tree', () => {
  const src = makeTmp();
  fs.mkdirSync(path.join(src, 'global', '.claude', 'skills', 'demo'), { recursive: true });
  fs.writeFileSync(path.join(src, 'manifest.json'), '{"items":[]}', 'utf8');
  fs.writeFileSync(path.join(src, 'global', '.claude', 'CLAUDE.md'), 'memory', 'utf8');
  fs.writeFileSync(path.join(src, 'global', '.claude', 'skills', 'demo', 'SKILL.md'), 'skill body', 'utf8');

  const gitDir = path.join(src, '.git');
  fs.mkdirSync(gitDir);
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main', 'utf8');

  const zipPath = path.join(makeTmp(), 'out.zip');
  zipDirectory(src, zipPath, { skipDirnames: new Set(['.git']) });

  const dest = makeTmp();
  extractZip(zipPath, dest);

  assert.equal(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8'), '{"items":[]}');
  assert.equal(fs.readFileSync(path.join(dest, 'global', '.claude', 'CLAUDE.md'), 'utf8'), 'memory');
  assert.equal(
    fs.readFileSync(path.join(dest, 'global', '.claude', 'skills', 'demo', 'SKILL.md'), 'utf8'),
    'skill body'
  );
  assert.equal(fs.existsSync(path.join(dest, '.git')), false);
});
