'use strict';

/**
 * Zip up a backup directory for transport anywhere git isn't: a cloud
 * drive folder (Dropbox/Drive/OneDrive/iCloud), email, or a USB stick.
 */

const fs = require('fs');
const path = require('path');

const { zipDirectory } = require('./zip');
const { MANIFEST_NAME } = require('./backup');

class ExportError extends Error {}

function exportZip(sourceDir, outPath, { includeGitHistory = false } = {}) {
  const resolvedSource = path.resolve(sourceDir);
  const resolvedOut = path.resolve(outPath);

  if (!fs.existsSync(path.join(resolvedSource, MANIFEST_NAME))) {
    throw new ExportError(`No ${MANIFEST_NAME} found in ${resolvedSource} — nothing to export.`);
  }

  zipDirectory(resolvedSource, resolvedOut, {
    skipDirnames: includeGitHistory ? new Set() : new Set(['.git']),
  });
  return resolvedOut;
}

module.exports = { ExportError, exportZip };
