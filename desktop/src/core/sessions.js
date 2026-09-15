'use strict';

/**
 * Read Claude Code chat session transcripts (.jsonl files) so a backup or
 * an imported one can be previewed and verified before you actually
 * restore it or start trusting it.
 *
 * Claude Code's transcript format isn't a documented, stable API, so this
 * parser is deliberately tolerant: it extracts a role and readable text
 * where it can recognize the shape, and quietly skips whatever it doesn't
 * recognize (a malformed line, an unfamiliar block type) rather than
 * throwing. Worst case you see less detail, not a crash.
 */

const fs = require('fs');
const path = require('path');

const SNIPPET_LENGTH = 140;

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text);
      } else if (block.type === 'tool_use') {
        parts.push(`[used tool: ${block.name || 'tool'}]`);
      } else if (block.type === 'tool_result') {
        parts.push('[tool result]');
      }
    }
    return parts.filter(Boolean).join('\n');
  }
  return '';
}

/** Parses transcript text into {role, text, timestamp} entries, skipping unreadable lines. */
function parseMessages(content) {
  const messages = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;

    let role = null;
    let text = '';
    if (obj.message && typeof obj.message === 'object') {
      role = obj.message.role || null;
      text = extractText(obj.message.content);
    }
    if (!role) role = obj.type || null;
    if (!role && !text) continue;

    messages.push({ role: role || 'unknown', text: text.trim(), timestamp: obj.timestamp ?? null });
  }
  return messages;
}

function walkJsonlFiles(root) {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) results.push(full);
    }
  }
  walk(root);
  return results.sort();
}

function snippetFor(messages) {
  for (const msg of messages) {
    if (msg.text) {
      const flat = msg.text.replace(/\s+/g, ' ').trim();
      return flat.length > SNIPPET_LENGTH ? `${flat.slice(0, SNIPPET_LENGTH)}…` : flat;
    }
  }
  return '';
}

/** Finds every .jsonl session transcript under `root`, newest first. */
function listSessions(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

  const infos = walkJsonlFiles(root).map((filePath) => {
    const stat = fs.statSync(filePath);
    const messages = parseMessages(fs.readFileSync(filePath, 'utf8'));
    return {
      path: filePath,
      projectHint: path.basename(path.dirname(filePath)),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      messageCount: messages.length,
      snippet: snippetFor(messages),
    };
  });

  infos.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return infos;
}

/** Reads a transcript's messages, capped at `limit` (default: all). */
function readSession(filePath, limit) {
  const messages = parseMessages(fs.readFileSync(filePath, 'utf8'));
  if (!limit || messages.length <= limit) {
    return { messages, total: messages.length, truncated: false };
  }
  return { messages: messages.slice(0, limit), total: messages.length, truncated: true };
}

function renderMarkdown(messages, title) {
  const lines = [`# Chat session: ${title}`, ''];
  for (const msg of messages) {
    const role = (msg.role || 'unknown').replace(/_/g, ' ');
    const capitalized = role.charAt(0).toUpperCase() + role.slice(1);
    lines.push(`**${capitalized}**`, '', msg.text || '*(no text)*', '');
  }
  if (messages.length === 0) lines.push('*(no readable messages found in this transcript)*');
  return lines.join('\n');
}

function renderPlainText(messages) {
  if (messages.length === 0) return '(no readable messages found in this transcript)';
  return messages.map((m) => (m.text ? `[${m.role}] ${m.text}` : `[${m.role}]`)).join('\n');
}

function slugify(text) {
  const slug = text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'session';
}

/**
 * Writes every chat session found under `root` as one readable file per
 * session in `outDir` (markdown by default, or plain text), so the whole
 * chat history can be browsed or archived without ClaudeSync or the raw
 * .jsonl format.
 */
function exportAllSessions(root, outDir, format = 'md') {
  if (format !== 'md' && format !== 'txt') {
    throw new Error(`Unknown export format: ${format} (expected 'md' or 'txt')`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const written = [];
  const usedNames = new Set();
  for (const info of listSessions(root)) {
    const date = new Date(info.mtimeMs).toISOString().slice(0, 10);
    const stem = path.basename(info.path, path.extname(info.path));
    const base = slugify(`${date}_${info.projectHint}_${stem}`);

    let name = `${base}.${format}`;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${base}-${suffix}.${format}`;
      suffix += 1;
    }
    usedNames.add(name);

    const messages = parseMessages(fs.readFileSync(info.path, 'utf8'));
    const content = format === 'md' ? renderMarkdown(messages, stem) : renderPlainText(messages);

    const outPath = path.join(outDir, name);
    fs.writeFileSync(outPath, content, 'utf8');
    written.push(outPath);
  }

  return written;
}

module.exports = { parseMessages, listSessions, readSession, exportAllSessions };
