'use strict';

/* global claudesync */

const state = {
  settings: null,
  lastScan: null,
  lastRestorePlan: null,
};

function $(id) {
  return document.getElementById(id);
}

function setStatus(kind, text) {
  const dot = $('status-dot');
  dot.className = `status-dot ${kind}`;
  $('status-text').textContent = text;
}

function switchTab(tabName) {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab').forEach((section) => {
    section.classList.toggle('active', section.id === `tab-${tabName}`);
  });
}

function formatDate(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleString();
}

function renderCategoryGrid(container, byCategory) {
  container.innerHTML = '';
  const entries = Object.entries(byCategory || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) {
    container.innerHTML = '<p class="summary">No data yet — run a scan or a backup.</p>';
    return;
  }
  for (const [category, count] of entries) {
    const chip = document.createElement('div');
    chip.className = 'category-chip';
    chip.innerHTML = `<span>${category}</span><span class="count">${count}</span>`;
    container.appendChild(chip);
  }
}

function renderItemList(container, items, pathKey) {
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="item-row"><span class="item-path">Nothing here yet.</span></div>';
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `<span class="item-tag">${item.category}</span><span class="item-path">${item[pathKey]}</span>`;
    container.appendChild(row);
  }
}

async function refreshDashboard() {
  const settings = state.settings;
  $('last-run-value').textContent = formatDate(settings.lastRunAt);
  $('last-total-value').textContent = settings.lastRunSummary ? settings.lastRunSummary.total : '—';
  $('auto-status-value').textContent = settings.autoBackupEnabled
    ? `On, every ${settings.intervalHours}h`
    : 'Off';

  const errBanner = $('last-run-error');
  if (settings.lastRunError) {
    errBanner.textContent = `Last backup failed: ${settings.lastRunError}`;
    errBanner.classList.remove('hidden');
  } else {
    errBanner.classList.add('hidden');
  }

  renderCategoryGrid($('category-breakdown'), settings.lastRunSummary && settings.lastRunSummary.byCategory);
}

function populateSettingsForm() {
  const s = state.settings;
  $('settings-dest').value = s.destDir || s.defaultDest || '';
  $('settings-remote').value = s.remoteUrl || '';
  $('settings-push').checked = !!s.push;
  $('settings-pull-first').checked = !!s.pullFirst;
  $('settings-auto').checked = !!s.autoBackupEnabled;
  $('settings-interval').value = s.intervalHours || 6;
  $('settings-login').checked = !!s.startAtLogin;
}

async function loadSettings() {
  state.settings = await claudesync.getSettings();
  populateSettingsForm();
  await refreshDashboard();
  if (!$('restore-source').value) {
    $('restore-source').value = state.settings.destDir || state.settings.defaultDest || '';
  }
}

function wireNav() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function wireDashboard() {
  $('dashboard-backup-now').addEventListener('click', runBackupFlow);
  $('dashboard-open-folder').addEventListener('click', () => {
    claudesync.openPath(state.settings.destDir || state.settings.defaultDest);
  });
}

async function runBackupFlow() {
  setStatus('busy', 'Backing up…');
  const result = await claudesync.runBackup();
  if (result.ok) {
    setStatus('ok', result.committed ? 'Backup complete' : 'No changes');
  } else {
    setStatus('error', 'Backup failed');
  }
  await loadSettings();
  return result;
}

function wireBackupTab() {
  $('scan-btn').addEventListener('click', async () => {
    setStatus('busy', 'Scanning…');
    const result = await claudesync.scan();
    state.lastScan = result;
    $('scan-summary').textContent = `${result.total} item(s) found.`;
    $('scan-summary').classList.remove('hidden');
    renderItemList($('scan-list'), result.items, 'source');
    setStatus('ok', 'Scan complete');
  });

  $('backup-btn').addEventListener('click', runBackupFlow);

  $('export-btn').addEventListener('click', async () => {
    const outPath = await claudesync.chooseZipDestination();
    if (!outPath) return;
    setStatus('busy', 'Exporting…');
    const result = await claudesync.runExport({ sourceDir: state.settings.destDir || state.settings.defaultDest, outPath });
    const box = $('export-result');
    box.classList.remove('hidden');
    if (result.ok) {
      box.textContent = `Exported to ${result.outPath}`;
      setStatus('ok', 'Export complete');
    } else {
      box.textContent = `Export failed: ${result.error}`;
      setStatus('error', 'Export failed');
    }
  });
}

const RESTORE_CATEGORIES = ['memory', 'settings', 'mcp', 'agent', 'command', 'rule', 'plan', 'skill', 'session', 'plugin'];

function populateRestoreCategoryChecklist() {
  const box = $('restore-categories');
  box.innerHTML = '';
  for (const category of RESTORE_CATEGORIES) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${category}" checked /> ${category}`;
    box.appendChild(label);
  }
  box.classList.remove('hidden');
  $('restore-preview').disabled = false;
  $('restore-apply').disabled = false;
  $('restore-results').innerHTML = '';
}

function wireRestoreTab() {
  $('restore-choose-source').addEventListener('click', async () => {
    const dir = await claudesync.chooseDirectory();
    if (dir) $('restore-source').value = dir;
  });

  $('restore-load').addEventListener('click', populateRestoreCategoryChecklist);

  $('import-git-btn').addEventListener('click', async () => {
    const url = $('import-git-url').value.trim();
    if (!url) return;
    setStatus('busy', 'Cloning / pulling…');
    const result = await claudesync.runImport({ source: url, dest: $('restore-source').value || undefined });
    const box = $('import-result');
    box.classList.remove('hidden');
    if (result.ok) {
      box.textContent = `Imported ${result.itemCount} item(s) into ${result.dest}`;
      $('restore-source').value = result.dest;
      populateRestoreCategoryChecklist();
      setStatus('ok', 'Import complete');
    } else {
      box.textContent = `Import failed: ${result.error}`;
      setStatus('error', 'Import failed');
    }
  });

  $('import-zip-btn').addEventListener('click', async () => {
    const zipPath = await claudesync.chooseZipToImport();
    if (!zipPath) return;
    const dir = await claudesync.chooseDirectory();
    if (!dir) return;
    setStatus('busy', 'Importing…');
    const result = await claudesync.runImport({ source: zipPath, dest: dir });
    const box = $('import-result');
    box.classList.remove('hidden');
    if (result.ok) {
      box.textContent = `Imported ${result.itemCount} item(s) into ${result.dest}`;
      $('restore-source').value = result.dest;
      populateRestoreCategoryChecklist();
      setStatus('ok', 'Import complete');
    } else {
      box.textContent = `Import failed: ${result.error}`;
      setStatus('error', 'Import failed');
    }
  });

  function selectedCategories() {
    return Array.from(document.querySelectorAll('#restore-categories input:checked')).map((el) => el.value);
  }

  $('restore-preview').addEventListener('click', async () => {
    setStatus('busy', 'Loading restore plan…');
    const plan = await claudesync.planRestore({
      sourceDir: $('restore-source').value,
      categories: selectedCategories(),
    });
    state.lastRestorePlan = plan;
    renderItemList(
      $('restore-results'),
      plan.map((p) => ({
        category: p.category,
        originalPath: `${p.originalPath} ${p.willOverwrite ? '(will overwrite)' : '(new)'}`,
      })),
      'originalPath'
    );
    setStatus('ok', `${plan.length} item(s) would be restored`);
  });

  $('restore-apply').addEventListener('click', async () => {
    setStatus('busy', 'Restoring…');
    const result = await claudesync.applyRestore({
      sourceDir: $('restore-source').value,
      categories: selectedCategories(),
    });
    setStatus('ok', `Restored ${result.restored} item(s)`);
  });

  wireSessionPreview();
}

function formatSessionDate(mtimeMs) {
  return new Date(mtimeMs).toLocaleString();
}

function bubbleRoleClass(role) {
  if (role === 'user') return 'role-user';
  if (role === 'assistant') return 'role-assistant';
  return 'role-other';
}

function renderSessionMessages(container, messages) {
  container.innerHTML = '';
  if (messages.length === 0) {
    container.innerHTML = '<p class="summary">No readable messages found in this transcript.</p>';
    return;
  }
  for (const msg of messages) {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${bubbleRoleClass(msg.role)}`;
    const roleLabel = document.createElement('span');
    roleLabel.className = 'role-label';
    roleLabel.textContent = msg.role;
    bubble.appendChild(roleLabel);
    bubble.appendChild(document.createTextNode(msg.text || '(no text)'));
    container.appendChild(bubble);
  }
}

function wireSessionPreview() {
  let currentSessions = [];

  $('sessions-list-btn').addEventListener('click', async () => {
    setStatus('busy', 'Listing chat sessions…');
    const result = await claudesync.listSessions({ sourceDir: $('restore-source').value });
    const box = $('sessions-list');
    box.classList.remove('hidden');

    if (!result.ok) {
      box.innerHTML = `<div class="item-row"><span class="item-path">Failed to list sessions: ${result.error}</span></div>`;
      setStatus('error', 'Failed to list sessions');
      return;
    }

    currentSessions = result.sessions;
    box.innerHTML = '';
    if (currentSessions.length === 0) {
      box.innerHTML = '<div class="item-row"><span class="item-path">No chat session transcripts found here.</span></div>';
    } else {
      currentSessions.forEach((session, index) => {
        const row = document.createElement('div');
        row.className = 'item-row session-row';
        row.dataset.index = String(index);
        row.innerHTML = `
          <span class="item-tag">${session.messageCount} msg</span>
          <div class="session-meta">
            <span>${formatSessionDate(session.mtimeMs)} — ${session.projectHint}</span>
            <span class="session-snippet">${session.snippet || '(no preview available)'}</span>
          </div>
        `;
        box.appendChild(row);
      });
    }
    setStatus('ok', `${currentSessions.length} session(s) found`);
  });

  $('sessions-list').addEventListener('click', async (event) => {
    const row = event.target.closest('.session-row');
    if (!row) return;
    const session = currentSessions[Number(row.dataset.index)];
    if (!session) return;

    setStatus('busy', 'Loading transcript…');
    const result = await claudesync.readSession({ path: session.path, limit: 300 });
    if (!result.ok) {
      setStatus('error', 'Failed to load transcript');
      return;
    }

    $('session-viewer-title').textContent = session.path;
    renderSessionMessages($('session-viewer-messages'), result.messages);
    const truncatedBox = $('session-viewer-truncated');
    if (result.truncated) {
      truncatedBox.textContent = `Showing the first ${result.messages.length} of ${result.total} messages.`;
      truncatedBox.classList.remove('hidden');
    } else {
      truncatedBox.classList.add('hidden');
    }

    $('sessions-list').classList.add('hidden');
    $('session-viewer').classList.remove('hidden');
    setStatus('ok', 'Transcript loaded');
  });

  $('session-viewer-back').addEventListener('click', () => {
    $('session-viewer').classList.add('hidden');
    $('sessions-list').classList.remove('hidden');
  });

  $('export-sessions-btn').addEventListener('click', async () => {
    const outDir = await claudesync.chooseDirectory();
    if (!outDir) return;

    setStatus('busy', 'Exporting all chats…');
    const format = $('export-sessions-format').value;
    const result = await claudesync.exportAllSessions({
      sourceDir: $('restore-source').value,
      outDir,
      format,
    });

    const box = $('export-sessions-result');
    box.classList.remove('hidden');
    if (result.ok) {
      box.textContent = `Exported ${result.count} chat(s) to ${result.outDir}`;
      setStatus('ok', 'Export complete');
    } else {
      box.textContent = `Export failed: ${result.error}`;
      setStatus('error', 'Export failed');
    }
  });
}

function wireSettingsTab() {
  $('settings-choose-dest').addEventListener('click', async () => {
    const dir = await claudesync.chooseDirectory();
    if (dir) $('settings-dest').value = dir;
  });

  $('settings-save').addEventListener('click', async () => {
    const partial = {
      destDir: $('settings-dest').value.trim(),
      remoteUrl: $('settings-remote').value.trim(),
      push: $('settings-push').checked,
      pullFirst: $('settings-pull-first').checked,
      autoBackupEnabled: $('settings-auto').checked,
      intervalHours: Number($('settings-interval').value) || 6,
      startAtLogin: $('settings-login').checked,
    };
    state.settings = await claudesync.saveSettings(partial);
    setStatus('ok', 'Settings saved');
    await refreshDashboard();
  });
}

function wireIpcEvents() {
  claudesync.onBackupStarted(() => setStatus('busy', 'Backing up…'));
  claudesync.onBackupFinished(async (payload) => {
    setStatus(payload.ok ? 'ok' : 'error', payload.ok ? 'Backup complete' : 'Backup failed');
    await loadSettings();
  });
  claudesync.onSettingsChanged(async () => {
    await loadSettings();
  });
}

async function init() {
  wireNav();
  wireDashboard();
  wireBackupTab();
  wireRestoreTab();
  wireSettingsTab();
  wireIpcEvents();
  await loadSettings();
  setStatus('ok', 'Ready');
}

document.addEventListener('DOMContentLoaded', init);
