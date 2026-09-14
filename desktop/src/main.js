'use strict';

const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, Notification, nativeImage } = require('electron');

const { Store } = require('./core/store');
const { scanAll } = require('./core/discovery');
const { runBackup } = require('./core/backup');
const restore = require('./core/restore');

const DEFAULT_DEST = path.join(app.getPath('home'), '.claudesync-backup');

let mainWindow = null;
let tray = null;
let store = null;
let scheduleTimer = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function currentDest() {
  return store.get('destDir') || DEFAULT_DEST;
}

function createWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 620,
    minHeight: 480,
    title: 'ClaudeSync',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

function pushToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

async function performScheduledBackup() {
  const destDir = currentDest();
  try {
    const result = runBackup({
      destDir,
      push: !!store.get('push'),
      remoteUrl: store.get('remoteUrl') || undefined,
    });
    const summary = result.summary();
    store.setAll({
      lastRunAt: new Date().toISOString(),
      lastRunSummary: summary,
      lastRunError: null,
    });
    if (result.committed) {
      notify('ClaudeSync backup complete', `${summary.total} item(s) backed up.`);
    }
    pushToRenderer('backup-finished', { ok: true, summary, committed: result.committed });
  } catch (err) {
    store.setAll({ lastRunAt: new Date().toISOString(), lastRunError: String(err.message || err) });
    notify('ClaudeSync backup failed', String(err.message || err));
    pushToRenderer('backup-finished', { ok: false, error: String(err.message || err) });
  }
  updateTrayMenu();
}

function scheduleIntervalMs() {
  const hours = Number(store.get('intervalHours')) || 6;
  return Math.max(1, hours) * 60 * 60 * 1000;
}

function restartScheduler() {
  if (scheduleTimer) clearInterval(scheduleTimer);
  scheduleTimer = null;
  if (store.get('autoBackupEnabled')) {
    scheduleTimer = setInterval(performScheduledBackup, scheduleIntervalMs());
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const lastRunAt = store.get('lastRunAt');
  const lastRunLabel = lastRunAt ? `Last backup: ${new Date(lastRunAt).toLocaleString()}` : 'No backup yet';

  const menu = Menu.buildFromTemplate([
    { label: 'ClaudeSync', enabled: false },
    { label: lastRunLabel, enabled: false },
    { type: 'separator' },
    { label: 'Open ClaudeSync', click: () => createWindow() },
    {
      label: 'Back Up Now',
      click: () => {
        createWindow();
        pushToRenderer('backup-started', {});
        performScheduledBackup();
      },
    },
    { label: 'Open Backup Folder', click: () => shell.openPath(currentDest()) },
    { type: 'separator' },
    {
      label: 'Automatic Backups',
      type: 'checkbox',
      checked: !!store.get('autoBackupEnabled'),
      click: (item) => {
        store.set('autoBackupEnabled', item.checked);
        restartScheduler();
        pushToRenderer('settings-changed', store.getAll());
      },
    },
    { type: 'separator' },
    {
      label: 'Quit ClaudeSync',
      click: () => {
        app.isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(lastRunLabel);
}

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'trayTemplate.png');
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);
  tray.on('click', () => createWindow());
  updateTrayMenu();
}

function registerIpcHandlers() {
  ipcMain.handle('settings:get', () => ({ ...store.getAll(), defaultDest: DEFAULT_DEST }));

  ipcMain.handle('settings:save', (_event, partial) => {
    store.setAll(partial);
    if (partial.autoBackupEnabled !== undefined || partial.intervalHours !== undefined) {
      restartScheduler();
    }
    if (partial.startAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: !!partial.startAtLogin });
    }
    updateTrayMenu();
    return store.getAll();
  });

  ipcMain.handle('dialog:chooseDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: currentDest(),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('backup:scan', () => {
    const items = scanAll({});
    const byCategory = {};
    for (const item of items) byCategory[item.category] = (byCategory[item.category] || 0) + 1;
    return {
      total: items.length,
      byCategory,
      items: items.map((i) => ({ category: i.category, scope: i.scope, source: i.source, isDir: i.isDir })),
    };
  });

  ipcMain.handle('backup:run', async () => {
    const destDir = currentDest();
    try {
      const result = runBackup({
        destDir,
        push: !!store.get('push'),
        remoteUrl: store.get('remoteUrl') || undefined,
      });
      const summary = result.summary();
      store.setAll({ lastRunAt: new Date().toISOString(), lastRunSummary: summary, lastRunError: null });
      updateTrayMenu();
      return { ok: true, summary, committed: result.committed, pushed: result.pushed, destDir };
    } catch (err) {
      store.setAll({ lastRunAt: new Date().toISOString(), lastRunError: String(err.message || err) });
      updateTrayMenu();
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('restore:plan', (_event, { sourceDir, categories }) => {
    const plan = restore.buildPlan(sourceDir || currentDest(), {
      categories: categories && categories.length ? new Set(categories) : undefined,
    });
    return plan;
  });

  ipcMain.handle('restore:apply', (_event, { sourceDir, categories }) => {
    const plan = restore.buildPlan(sourceDir || currentDest(), {
      categories: categories && categories.length ? new Set(categories) : undefined,
    });
    const restored = restore.applyPlan(plan);
    return { restored, total: plan.length };
  });

  ipcMain.handle('shell:openPath', (_event, targetPath) => shell.openPath(targetPath));
}

app.whenReady().then(() => {
  store = new Store(settingsPath());
  registerIpcHandlers();
  createTray();
  createWindow();
  restartScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep running in the tray on every platform; the user quits explicitly.
});

app.on('before-quit', () => {
  app.isQuiting = true;
});
