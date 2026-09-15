'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseMessages, listSessions, readSession, exportAllSessions } = require('../src/core/sessions');

function line(obj) {
  return JSON.stringify(obj);
}

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudesync-sessions-'));
}

test('parseMessages extracts plain string content', () => {
  const content = [
    line({ type: 'user', message: { role: 'user', content: 'hello there' }, timestamp: 't1' }),
    line({ type: 'assistant', message: { role: 'assistant', content: 'hi!' }, timestamp: 't2' }),
  ].join('\n');

  const messages = parseMessages(content);
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { role: 'user', text: 'hello there', timestamp: 't1' });
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].text, 'hi!');
});

test('parseMessages extracts block-list content with tool_use and tool_result', () => {
  const content = [
    line({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check that.' },
          { type: 'tool_use', name: 'Bash', input: {} },
        ],
      },
    }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
  ].join('\n');

  const messages = parseMessages(content);
  assert.match(messages[0].text, /Let me check that\./);
  assert.match(messages[0].text, /\[used tool: Bash\]/);
  assert.equal(messages[1].text, '[tool result]');
});

test('parseMessages falls back to top-level type when there is no message role', () => {
  const content = line({ type: 'summary', summary: 'a chat about widgets' });
  const messages = parseMessages(content);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'summary');
});

test('parseMessages skips malformed lines without throwing', () => {
  const content = ['not json at all', line({ type: 'user', message: { role: 'user', content: 'still works' } }), '{broken'].join(
    '\n'
  );
  const messages = parseMessages(content);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'still works');
});

test('parseMessages skips lines with neither a type nor a message', () => {
  const messages = parseMessages(line({ foo: 'bar' }));
  assert.equal(messages.length, 0);
});

test('parseMessages keeps a typed event even with no text', () => {
  const messages = parseMessages(line({ type: 'file-history-snapshot', snapshot: {} }));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'file-history-snapshot');
  assert.equal(messages[0].text, '');
});

test('listSessions finds .jsonl files recursively with metadata', () => {
  const root = makeTmp();
  const projectDir = path.join(root, 'global', '.claude', 'projects', '-home-user-demo');
  fs.mkdirSync(projectDir, { recursive: true });
  const sessionPath = path.join(projectDir, 'abc123.jsonl');
  fs.writeFileSync(
    sessionPath,
    line({ type: 'user', message: { role: 'user', content: 'What does this function do?' } }) + '\n',
    'utf8'
  );

  const infos = listSessions(root);
  assert.equal(infos.length, 1);
  assert.equal(infos[0].path, sessionPath);
  assert.equal(infos[0].projectHint, '-home-user-demo');
  assert.equal(infos[0].messageCount, 1);
  assert.match(infos[0].snippet, /What does this function do\?/);
});

test('listSessions returns an empty array when there are no .jsonl files', () => {
  assert.deepEqual(listSessions(makeTmp()), []);
});

test('listSessions returns an empty array for a missing root', () => {
  assert.deepEqual(listSessions(path.join(makeTmp(), 'nope')), []);
});

test('listSessions sorts newest first', async () => {
  const root = makeTmp();
  const older = path.join(root, 'older.jsonl');
  const newer = path.join(root, 'newer.jsonl');
  fs.writeFileSync(older, line({ type: 'user', message: { role: 'user', content: 'first' } }), 'utf8');
  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(newer, line({ type: 'user', message: { role: 'user', content: 'second' } }), 'utf8');

  const infos = listSessions(root);
  assert.deepEqual(infos.map((i) => i.path), [newer, older]);
});

test('readSession truncates at limit and reports total/truncated', () => {
  const root = makeTmp();
  const sessionPath = path.join(root, 's.jsonl');
  const lines = Array.from({ length: 5 }, (_, i) => line({ type: 'user', message: { role: 'user', content: `msg ${i}` } }));
  fs.writeFileSync(sessionPath, lines.join('\n'), 'utf8');

  const result = readSession(sessionPath, 2);
  assert.equal(result.messages.length, 2);
  assert.equal(result.total, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.messages[0].text, 'msg 0');
});

test('readSession without a limit returns everything', () => {
  const root = makeTmp();
  const sessionPath = path.join(root, 's.jsonl');
  fs.writeFileSync(sessionPath, line({ type: 'user', message: { role: 'user', content: 'only one' } }), 'utf8');

  const result = readSession(sessionPath);
  assert.equal(result.messages.length, 1);
  assert.equal(result.truncated, false);
});

function writeSession(root, relPath, text) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, line({ type: 'user', message: { role: 'user', content: text } }), 'utf8');
  return full;
}

test('exportAllSessions writes one markdown file per session', () => {
  const root = makeTmp();
  writeSession(root, 'projects/-home-user-a/sess1.jsonl', 'first chat');
  writeSession(root, 'projects/-home-user-b/sess2.jsonl', 'second chat');

  const outDir = path.join(root, 'out');
  const written = exportAllSessions(root, outDir, 'md');

  assert.equal(written.length, 2);
  for (const p of written) {
    assert.equal(fs.existsSync(p), true);
    assert.equal(path.extname(p), '.md');
  }
  const contents = written.map((p) => fs.readFileSync(p, 'utf8'));
  assert.ok(contents.some((c) => c.includes('first chat')));
  assert.ok(contents.some((c) => c.includes('second chat')));
  assert.ok(contents.some((c) => c.includes('**User**')));
});

test('exportAllSessions supports txt format', () => {
  const root = makeTmp();
  writeSession(root, 'projects/-home-user-a/sess1.jsonl', 'plain text chat');

  const outDir = path.join(root, 'out');
  const written = exportAllSessions(root, outDir, 'txt');

  assert.equal(written.length, 1);
  assert.equal(path.extname(written[0]), '.txt');
  assert.equal(fs.readFileSync(written[0], 'utf8'), '[user] plain text chat');
});

test('exportAllSessions deduplicates colliding filenames', () => {
  const root = makeTmp();
  writeSession(root, 'projects/proj/sess.jsonl', 'chat A');
  writeSession(root, 'other/proj/sess.jsonl', 'chat A duplicate name');

  const outDir = path.join(root, 'out');
  const written = exportAllSessions(root, outDir, 'md');

  assert.equal(written.length, 2);
  const names = new Set(written.map((p) => path.basename(p)));
  assert.equal(names.size, 2);
});

test('exportAllSessions returns an empty array when there are no sessions', () => {
  const root = makeTmp();
  const written = exportAllSessions(root, path.join(root, 'out'), 'md');
  assert.deepEqual(written, []);
});

test('exportAllSessions rejects an unknown format', () => {
  const root = makeTmp();
  assert.throws(() => exportAllSessions(root, path.join(root, 'out'), 'pdf'));
});
