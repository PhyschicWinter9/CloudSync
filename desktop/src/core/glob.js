'use strict';

/**
 * Tiny dependency-free glob, supporting just what the scanner needs:
 * literal segments, `*` within a segment, and `**` for "any number of
 * directory levels". No brace expansion, no character classes.
 */

const fs = require('fs');
const path = require('path');

function segmentToRegExp(segment) {
  let pattern = '';
  for (const ch of segment) {
    if (ch === '*') pattern += '.*';
    else if (ch === '?') pattern += '.';
    else pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

function listDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Returns absolute paths under `root` matching the relative glob `pattern`. */
function glob(root, pattern) {
  const segments = pattern.split('/').filter(Boolean);
  const results = [];

  function walk(currentDir, segIndex) {
    if (segIndex >= segments.length) return;
    const segment = segments[segIndex];
    const isLast = segIndex === segments.length - 1;

    if (segment === '**') {
      // Zero levels consumed.
      walk(currentDir, segIndex + 1);
      // One or more levels consumed.
      for (const entry of listDir(currentDir)) {
        if (entry.isDirectory()) {
          walk(path.join(currentDir, entry.name), segIndex);
        }
      }
      return;
    }

    const regex = segmentToRegExp(segment);
    for (const entry of listDir(currentDir)) {
      if (!regex.test(entry.name)) continue;
      const fullPath = path.join(currentDir, entry.name);
      if (isLast) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        walk(fullPath, segIndex + 1);
      }
    }
  }

  walk(root, 0);
  return results.sort();
}

module.exports = { glob };
