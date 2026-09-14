'use strict';

/**
 * CI-only smoke test: launches the real app (tray + window + IPC handlers)
 * under Xvfb and confirms it boots and exits cleanly on its own, via
 * main.js's `--smoke-test` flag. This catches startup-time breakage (a
 * bad require, a native module mismatch, a crash before any window shows)
 * that the Electron-free unit tests in test/ can't see, without needing a
 * browser-automation dependency just for a boot check.
 */

const path = require('path');
const { spawn } = require('child_process');

const TIMEOUT_MS = 30000;
const electronBinary = require(path.join(__dirname, '..', '..', 'node_modules', 'electron'));
const appDir = path.join(__dirname, '..', '..');

const child = spawn(electronBinary, ['--no-sandbox', appDir, '--smoke-test'], {
  cwd: appDir,
  stdio: 'inherit',
  env: { ...process.env },
});

const timer = setTimeout(() => {
  console.error(`Smoke test timed out after ${TIMEOUT_MS}ms; app never exited on its own.`);
  child.kill('SIGKILL');
  process.exit(1);
}, TIMEOUT_MS);

child.on('exit', (code, signal) => {
  clearTimeout(timer);
  if (signal) {
    console.error(`App exited via signal ${signal}`);
    process.exit(1);
  }
  if (code !== 0) {
    console.error(`App exited with code ${code}`);
    process.exit(code);
  }
  console.log('Smoke test passed: app booted and exited cleanly.');
});

child.on('error', (err) => {
  clearTimeout(timer);
  console.error('Failed to launch Electron:', err);
  process.exit(1);
});
