'use strict';

/**
 * Bring a backup made elsewhere onto this machine, ready to restore.
 * A backup someone hands you can arrive three ways, and this module
 * accepts all three: a git remote URL (cloud backup shared via a private
 * repo), a .zip archive (shared via a cloud drive, email, or USB stick),
 * or a plain local directory that already looks like a ClaudeSync backup.
 */

const fs = require('fs');
const path = require('path');

const gitutil = require('./gitutil');
const { extractZip } = require('./zip');
const { MANIFEST_NAME } = require('./backup');

class ImportError extends Error {}

function looksLikeGitUrl(source) {
  if (/^(git@|ssh:\/\/|git:\/\/)/.test(source)) return true;
  if (/^https?:\/\//.test(source) && source.endsWith('.git')) return true;
  return false;
}

function requireManifest(dir) {
  if (!fs.existsSync(path.join(dir, MANIFEST_NAME))) {
    throw new ImportError(`No ${MANIFEST_NAME} found in ${dir} — this doesn't look like a ClaudeSync backup.`);
  }
}

/**
 * A local filesystem path usable with `git clone`/`git pull`: either a
 * working copy (has a .git dir) or a bare repo (its root IS the git dir,
 * e.g. one made with `git init --bare`). Local paths are a legitimate git
 * remote — e.g. a network drive or NAS mount used for cloud-style backup —
 * so these need to be told apart from a plain backup directory.
 */
function looksLikeLocalGitRepo(dir) {
  if (fs.existsSync(path.join(dir, '.git'))) return true;
  return (
    fs.existsSync(path.join(dir, 'HEAD')) &&
    fs.existsSync(path.join(dir, 'objects')) &&
    fs.existsSync(path.join(dir, 'refs'))
  );
}

/** Clones `url` into `dest`, or pulls it if `dest` already holds a clone of it. */
function importGit(url, dest) {
  const resolvedDest = path.resolve(dest);
  if (fs.existsSync(resolvedDest) && gitutil.isRepo(resolvedDest)) {
    gitutil.setRemote(resolvedDest, url);
    gitutil.pull(resolvedDest);
  } else {
    if (fs.existsSync(resolvedDest) && fs.readdirSync(resolvedDest).length > 0) {
      throw new ImportError(`${resolvedDest} already exists and is not empty; choose an empty destination.`);
    }
    gitutil.clone(url, resolvedDest);
  }
  requireManifest(resolvedDest);
  return resolvedDest;
}

/** Extracts a ClaudeSync backup archive into `dest`. */
function importZip(zipPath, dest) {
  const resolvedDest = path.resolve(dest);
  fs.mkdirSync(resolvedDest, { recursive: true });
  extractZip(path.resolve(zipPath), resolvedDest);

  // Tolerate an archive that wraps everything in one top-level folder.
  if (!fs.existsSync(path.join(resolvedDest, MANIFEST_NAME))) {
    const children = fs.readdirSync(resolvedDest);
    if (children.length === 1) {
      const wrapper = path.join(resolvedDest, children[0]);
      if (fs.statSync(wrapper).isDirectory() && fs.existsSync(path.join(wrapper, MANIFEST_NAME))) {
        for (const child of fs.readdirSync(wrapper)) {
          fs.renameSync(path.join(wrapper, child), path.join(resolvedDest, child));
        }
        fs.rmdirSync(wrapper);
      }
    }
  }

  requireManifest(resolvedDest);
  return resolvedDest;
}

/** Validates an existing local directory is a usable backup; used as-is. */
function importDirectory(source) {
  const resolved = path.resolve(source);
  requireManifest(resolved);
  return resolved;
}

/** Dispatches on what `source` looks like: a git URL, a .zip file, or a directory. */
function importSource(source, dest) {
  if (looksLikeGitUrl(source)) return importGit(source, dest);

  const resolvedSource = path.resolve(source);
  if (fs.existsSync(resolvedSource)) {
    const stat = fs.statSync(resolvedSource);
    if (stat.isFile() && resolvedSource.endsWith('.zip')) return importZip(resolvedSource, dest);
    if (stat.isDirectory()) {
      if (fs.existsSync(path.join(resolvedSource, MANIFEST_NAME))) return importDirectory(resolvedSource);
      if (looksLikeLocalGitRepo(resolvedSource)) return importGit(resolvedSource, dest);
      throw new ImportError(
        `${resolvedSource} is a directory but has neither a ${MANIFEST_NAME} nor a .git — ` +
          "it's not a ClaudeSync backup or a git repo."
      );
    }
  }

  throw new ImportError(
    `Don't know how to import ${source}: it's not a git URL, a .zip file, or an existing directory.`
  );
}

module.exports = { ImportError, looksLikeGitUrl, importGit, importZip, importDirectory, importSource };
