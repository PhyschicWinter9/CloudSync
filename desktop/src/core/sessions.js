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

module.exports = { parseMessages, listSessions, readSession };
