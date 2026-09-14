'use strict';

/**
 * Copies discovered Claude Code state into a versioned backup directory.
 * The manifest format is identical to the ClaudeSync CLI's (Python), so a
 * backup made by one can be restored by the other.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gitutil = require('./gitutil');
const { GLOBAL_SCOPE, scanAll } = require('./discovery');

const MANIFEST_NAME = 'manifest.json';
const LAST_RUN_NAME = 'last_run.json';
const MANIFEST_VERSION = 1;

const DEFAULT_IGNORE_DIRNAMES = new Set(['node_modules', '__pycache__', '.git', '.venv', '.DS_Store']);

function projectSlug(projectPath) {
  const digest = crypto.createHash('sha1').update(projectPath).digest('hex').slice(0, 10);
  const base = path.basename(projectPath) || 'root';
  return `${base}-${digest}`;
}

function copyItem(source, dest, isDir, ignoreDirnames) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (isDir) {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(source, dest, {
      recursive: true,
      filter: (src) => !ignoreDirnames.has(path.basename(src)),
    });
  } else {
    fs.copyFileSync(source, dest);
  }
}

/**
 * @returns {{ copied: object[], manifestPath: string, committed: boolean, pushed: boolean, summary: () => string }}
 */
function runBackup({
  destDir,
  extraProjects = [],
  home,
  push = false,
  remoteUrl,
  pullFirst = false,
  ignoreDirnames = DEFAULT_IGNORE_DIRNAMES,
  onProgress,
} = {}) {
  const resolvedHome = home || os.homedir();
  const resolvedDest = path.resolve(untildify(destDir));
  fs.mkdirSync(resolvedDest, { recursive: true });

  let pulled = false;
  // Pulling before scanning/copying means, when several machines share one
  // remote, this run starts from the latest shared history instead of
  // diverging from it (which would otherwise turn every push after the
  // first machine into a rejected non-fast-forward push).
  if (pullFirst && gitutil.isRepo(resolvedDest)) {
    if (remoteUrl) gitutil.setRemote(resolvedDest, remoteUrl);
    if (gitutil.remoteUrl(resolvedDest)) {
      gitutil.pull(resolvedDest);
      pulled = true;
    }
  }

  const items = scanAll({ extraProjects, home: resolvedHome });

  const manifestItems = [];
  const projectSlugs = new Map();
  const copied = [];

  items.forEach((item, index) => {
    let backupRel;
    if (item.scope === GLOBAL_SCOPE) {
      const rel = path.relative(resolvedHome, item.source) || path.basename(item.source);
      backupRel = path.join('global', rel);
    } else {
      if (!projectSlugs.has(item.scope)) projectSlugs.set(item.scope, projectSlug(item.scope));
      const slug = projectSlugs.get(item.scope);
      const rel = path.relative(item.scope, item.source) || path.basename(item.source);
      backupRel = path.join('projects', slug, rel);
    }

    const destPath = path.join(resolvedDest, backupRel);
    copyItem(item.source, destPath, item.isDir, ignoreDirnames);

    manifestItems.push({
      category: item.category,
      scope: item.scope,
      original_path: item.source,
      backup_path: backupRel.split(path.sep).join('/'),
      is_dir: item.isDir,
    });
    copied.push(item);

    if (onProgress) onProgress({ index: index + 1, total: items.length, item });
  });

  const manifest = {
    version: MANIFEST_VERSION,
    host: os.hostname(),
    home: resolvedHome,
    projects: Object.fromEntries([...projectSlugs.entries()].map(([p, slug]) => [slug, p])),
    items: manifestItems,
  };
  const manifestPath = path.join(resolvedDest, MANIFEST_NAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  // created_at changes on every run even when nothing else does, so it is
  // kept out of manifest.json (which we want to diff cleanly) and instead
  // written to an untracked file purely for the user's own reference.
  const timestamp = new Date().toISOString();
  const gitignorePath = path.join(resolvedDest, '.gitignore');
  const existingIgnores = fs.existsSync(gitignorePath)
    ? fs.readFileSync(gitignorePath, 'utf8').split('\n')
    : [];
  if (!existingIgnores.includes(LAST_RUN_NAME)) {
    fs.appendFileSync(gitignorePath, `${LAST_RUN_NAME}\n`, 'utf8');
  }
  fs.writeFileSync(
    path.join(resolvedDest, LAST_RUN_NAME),
    JSON.stringify({ created_at: timestamp, host: manifest.host }, null, 2) + '\n',
    'utf8'
  );

  if (!gitutil.isRepo(resolvedDest)) gitutil.init(resolvedDest);
  if (remoteUrl) gitutil.setRemote(resolvedDest, remoteUrl);

  gitutil.addAll(resolvedDest);
  const committed = gitutil.commit(resolvedDest, `ClaudeSync backup ${timestamp}`);

  let pushed = false;
  if (push) {
    const branch = gitutil.currentBranch(resolvedDest);
    gitutil.push(resolvedDest, { branch });
    pushed = true;
  }

  return {
    copied,
    manifestPath,
    pulled,
    committed,
    pushed,
    timestamp,
    summary() {
      const byCategory = {};
      for (const item of copied) byCategory[item.category] = (byCategory[item.category] || 0) + 1;
      return { total: copied.length, byCategory };
    },
  };
}

function untildify(p) {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

module.exports = { runBackup, MANIFEST_NAME, LAST_RUN_NAME, DEFAULT_IGNORE_DIRNAMES };
