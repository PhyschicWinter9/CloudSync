'use strict';

/**
 * Discovers everything Claude Code stores on this machine: the global
 * ~/.claude directory plus every project directory Claude Code has ever
 * been opened in (read from ~/.claude.json's "projects" map — the same
 * source Claude Code Organizer uses, and the same source the ClaudeSync
 * CLI uses, so results and backups line up between the two).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { glob } = require('./glob');

const GLOBAL_SCOPE = 'global';

function claudeHome(home) {
  if (process.env.CLAUDE_CONFIG_DIR) {
    return untildify(process.env.CLAUDE_CONFIG_DIR);
  }
  return path.join(home || os.homedir(), '.claude');
}

function untildify(p) {
  if (p.startsWith('~')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function claudeJsonPath(home) {
  return path.join(home || os.homedir(), '.claude.json');
}

// [category, relative glob pattern, isDirUnit]
const GLOBAL_SPECS = [
  ['memory', 'CLAUDE.md', false],
  ['memory', 'CLAUDE.local.md', false],
  ['settings', 'settings.json', false],
  ['settings', 'settings.local.json', false],
  ['mcp', 'mcp.json', false],
  ['agent', 'agents/**/*.md', false],
  ['command', 'commands/**/*.md', false],
  ['rule', 'rules/**/*.md', false],
  ['plan', 'plans/**/*.md', false],
  ['skill', 'skills/*', true],
  ['plugin', 'plugins/*', true],
  ['session', 'projects', true],
];

const PROJECT_SPECS = [
  ['memory', 'CLAUDE.md', false],
  ['memory', 'CLAUDE.local.md', false],
  ['mcp', '.mcp.json', false],
  ['settings', '.claude/settings.json', false],
  ['settings', '.claude/settings.local.json', false],
  ['agent', '.claude/agents/**/*.md', false],
  ['command', '.claude/commands/**/*.md', false],
  ['rule', '.claude/rules/**/*.md', false],
  ['plan', '.claude/plans/**/*.md', false],
  ['skill', '.claude/skills/*', true],
];

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function expand(root, pattern, isDirUnit) {
  if (!pattern.includes('*')) {
    const candidate = path.join(root, pattern);
    return (isDirUnit ? isDir(candidate) : isFile(candidate)) ? [candidate] : [];
  }

  return glob(root, pattern).filter((match) => (isDirUnit ? isDir(match) : isFile(match)));
}

/** Every project directory recorded in ~/.claude.json, filtered to ones that still exist. */
function discoverProjects(home) {
  const jsonPath = claudeJsonPath(home);
  if (!isFile(jsonPath)) return [];

  let data;
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return [];
  }

  const projects = data && typeof data.projects === 'object' ? data.projects : null;
  if (!projects) return [];

  return Object.keys(projects)
    .map((p) => untildify(p))
    .filter((p) => isDir(p));
}

function scanGlobal(home) {
  const items = [];
  const resolvedHome = home || os.homedir();

  const jsonPath = claudeJsonPath(resolvedHome);
  if (isFile(jsonPath)) {
    items.push({ category: 'mcp', scope: GLOBAL_SCOPE, source: jsonPath, isDir: false });
  }

  const root = claudeHome(resolvedHome);
  if (!isDir(root)) return items;

  for (const [category, pattern, isDirUnit] of GLOBAL_SPECS) {
    for (const match of expand(root, pattern, isDirUnit)) {
      items.push({ category, scope: GLOBAL_SCOPE, source: match, isDir: isDirUnit });
    }
  }

  return items;
}

function scanProject(projectPath) {
  const items = [];
  if (!isDir(projectPath)) return items;

  for (const [category, pattern, isDirUnit] of PROJECT_SPECS) {
    for (const match of expand(projectPath, pattern, isDirUnit)) {
      items.push({ category, scope: projectPath, source: match, isDir: isDirUnit });
    }
  }

  return items;
}

function scanAll({ extraProjects = [], home } = {}) {
  const resolvedHome = home || os.homedir();
  const items = scanGlobal(resolvedHome);

  const seen = new Set();
  const allProjects = [...discoverProjects(resolvedHome), ...extraProjects.map(untildify)];
  for (const project of allProjects) {
    const resolved = path.resolve(project);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    items.push(...scanProject(resolved));
  }

  return items;
}

module.exports = {
  GLOBAL_SCOPE,
  claudeHome,
  claudeJsonPath,
  discoverProjects,
  scanGlobal,
  scanProject,
  scanAll,
};
