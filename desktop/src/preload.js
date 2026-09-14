'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudesync', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  chooseDirectory: () => ipcRenderer.invoke('dialog:chooseDirectory'),
  scan: () => ipcRenderer.invoke('backup:scan'),
  runBackup: () => ipcRenderer.invoke('backup:run'),
  planRestore: (args) => ipcRenderer.invoke('restore:plan', args),
  applyRestore: (args) => ipcRenderer.invoke('restore:apply', args),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', targetPath),
  chooseZipToImport: () => ipcRenderer.invoke('dialog:chooseZipToImport'),
  chooseZipDestination: () => ipcRenderer.invoke('dialog:chooseZipDestination'),
  runImport: (args) => ipcRenderer.invoke('import:run', args),
  runExport: (args) => ipcRenderer.invoke('export:run', args),
  listSessions: (args) => ipcRenderer.invoke('sessions:list', args),
  readSession: (args) => ipcRenderer.invoke('sessions:read', args),
  onBackupStarted: (cb) => ipcRenderer.on('backup-started', (_e, payload) => cb(payload)),
  onBackupFinished: (cb) => ipcRenderer.on('backup-finished', (_e, payload) => cb(payload)),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_e, payload) => cb(payload)),
});
