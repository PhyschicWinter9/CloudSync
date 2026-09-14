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
}

function wireRestoreTab() {
  $('restore-choose-source').addEventListener('click', async () => {
    const dir = await claudesync.chooseDirectory();
    if (dir) $('restore-source').value = dir;
  });

  const CATEGORIES = ['memory', 'settings', 'mcp', 'agent', 'command', 'rule', 'plan', 'skill', 'session', 'plugin'];

  $('restore-load').addEventListener('click', () => {
    const box = $('restore-categories');
    box.innerHTML = '';
    for (const category of CATEGORIES) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" value="${category}" checked /> ${category}`;
      box.appendChild(label);
    }
    box.classList.remove('hidden');
    $('restore-preview').disabled = false;
    $('restore-apply').disabled = false;
    $('restore-results').innerHTML = '';
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
