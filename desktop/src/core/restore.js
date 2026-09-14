'use strict';

const fs = require('fs');
const path = require('path');

const { MANIFEST_NAME } = require('./backup');

class RestoreError extends Error {}

function loadManifest(sourceDir) {
  const manifestPath = path.join(sourceDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) {
    throw new RestoreError(`No ${MANIFEST_NAME} found in ${sourceDir}`);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

/** @returns {Array<{originalPath, backupPath, isDir, category, scope, willOverwrite}>} */
function buildPlan(sourceDir, { categories } = {}) {
  const resolvedSource = path.resolve(sourceDir);
  const manifest = loadManifest(resolvedSource);

  const plan = [];
  for (const entry of manifest.items || []) {
    if (categories && !categories.has(entry.category)) continue;
    const originalPath = entry.original_path;
    const backupPath = path.join(resolvedSource, entry.backup_path);
    plan.push({
      originalPath,
      backupPath,
      isDir: entry.is_dir,
      category: entry.category,
      scope: entry.scope,
      willOverwrite: fs.existsSync(originalPath),
    });
  }
  return plan;
}

function applyPlan(plan, { dryRun = false } = {}) {
  let restored = 0;
  for (const entry of plan) {
    if (!fs.existsSync(entry.backupPath)) continue;
    if (dryRun) {
      restored += 1;
      continue;
    }

    fs.mkdirSync(path.dirname(entry.originalPath), { recursive: true });
    if (entry.isDir) {
      fs.rmSync(entry.originalPath, { recursive: true, force: true });
      fs.cpSync(entry.backupPath, entry.originalPath, { recursive: true });
    } else {
      fs.copyFileSync(entry.backupPath, entry.originalPath);
    }
    restored += 1;
  }
  return restored;
}

module.exports = { RestoreError, loadManifest, buildPlan, applyPlan };
