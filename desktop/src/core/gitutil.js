'use strict';

const { spawnSync } = require('child_process');

class GitError extends Error {}

function run(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function isRepo(dir) {
  const fs = require('fs');
  const path = require('path');
  try {
    return fs.statSync(path.join(dir, '.git')).isDirectory();
  } catch {
    return false;
  }
}

function init(dir) {
  const result = run(['init'], dir);
  if (result.status !== 0) throw new GitError(result.stderr.trim());
}

function addAll(dir) {
  const result = run(['add', '-A'], dir);
  if (result.status !== 0) throw new GitError(result.stderr.trim());
}

function hasStagedChanges(dir) {
  const result = run(['diff', '--cached', '--quiet'], dir);
  return result.status === 1;
}

/** Commits staged changes. Returns false if there was nothing to commit. */
function commit(dir, message) {
  if (!hasStagedChanges(dir)) return false;
  const result = run(['commit', '-m', message], dir);
  if (result.status !== 0) throw new GitError(result.stderr.trim());
  return true;
}

function setRemote(dir, remoteUrl, name = 'origin') {
  const existing = run(['remote'], dir).stdout.split(/\s+/).filter(Boolean);
  if (existing.includes(name)) {
    run(['remote', 'set-url', name, remoteUrl], dir);
  } else {
    run(['remote', 'add', name, remoteUrl], dir);
  }
}

function push(dir, { remote = 'origin', branch } = {}) {
  const args = ['push', '-u', remote];
  if (branch) args.push(branch);
  const result = run(args, dir);
  if (result.status !== 0) throw new GitError(result.stderr.trim());
}

function currentBranch(dir) {
  const result = run(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
  const branch = result.stdout.trim();
  return branch && branch !== 'HEAD' ? branch : 'main';
}

module.exports = {
  GitError,
  isRepo,
  init,
  addAll,
  hasStagedChanges,
  commit,
  setRemote,
  push,
  currentBranch,
};
