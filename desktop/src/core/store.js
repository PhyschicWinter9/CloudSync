'use strict';

/**
 * A tiny JSON-file settings store, so we don't need the electron-store
 * dependency for what is really just a handful of fields.
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  destDir: '',
  remoteUrl: '',
  push: false,
  pullFirst: false,
  intervalHours: 6,
  autoBackupEnabled: false,
  lastRunAt: null,
  lastRunSummary: null,
  lastRunError: null,
};

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  get(key) {
    return this.data[key];
  }

  getAll() {
    return { ...this.data };
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  setAll(partial) {
    this.data = { ...this.data, ...partial };
    this._save();
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
  }
}

module.exports = { Store, DEFAULTS };
