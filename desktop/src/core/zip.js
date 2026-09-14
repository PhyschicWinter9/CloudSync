'use strict';

/**
 * Minimal, dependency-free ZIP reader/writer (store + deflate only, no
 * encryption, no zip64, no directory entries) — just enough to export a
 * backup directory as a single portable file and import it back, without
 * pulling in a zip library as a runtime dependency.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const time =
    ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, date: dosDate };
}

/** @param {Array<{name: string, data: Buffer}>} entries relative, forward-slash paths */
function buildZip(entries) {
  const chunks = [];
  const centralRecords = [];
  let offset = 0;
  const { time, date } = dosDateTime(new Date());

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name.split(path.sep).join('/'), 'utf8');
    const crc = crc32(data);
    const compressed = zlib.deflateRawSync(data);
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_FILE_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localOffset = offset;
    chunks.push(localHeader, nameBuf, payload);
    offset += localHeader.length + nameBuf.length + payload.length;

    centralRecords.push({ nameBuf, crc, compressedSize: payload.length, size: data.length, method, time, date, localOffset });
  }

  const centralDirStart = offset;
  for (const rec of centralRecords) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIR_SIGNATURE, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(rec.method, 10);
    central.writeUInt16LE(rec.time, 12);
    central.writeUInt16LE(rec.date, 14);
    central.writeUInt32LE(rec.crc, 16);
    central.writeUInt32LE(rec.compressedSize, 20);
    central.writeUInt32LE(rec.size, 24);
    central.writeUInt16LE(rec.nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, rw-r--r--
    central.writeUInt32LE(rec.localOffset, 42);
    chunks.push(central, rec.nameBuf);
    offset += central.length + rec.nameBuf.length;
  }
  const centralDirSize = offset - centralDirStart;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralRecords.length, 8);
  eocd.writeUInt16LE(centralRecords.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);

  return Buffer.concat(chunks);
}

/** Zips every file under `sourceDir` (relative paths preserved) into `outPath`. */
function zipDirectory(sourceDir, outPath, { skipDirnames = new Set() } = {}) {
  const entries = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skipDirnames.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        entries.push({ name: path.relative(sourceDir, full), data: fs.readFileSync(full) });
      }
    }
  }

  walk(sourceDir);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buildZip(entries));
  return outPath;
}

function findEndOfCentralDirectory(buf) {
  const minLen = 22;
  for (let i = buf.length - minLen; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  throw new Error('Not a valid zip file (end of central directory not found)');
}

/** Reads a zip built by buildZip/zipDirectory. @returns {Array<{name: string, data: Buffer}>} */
function readZip(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  let centralOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = [];
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(centralOffset) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error('Corrupt zip: bad central directory entry');
    }
    const method = buf.readUInt16LE(centralOffset + 10);
    const compressedSize = buf.readUInt32LE(centralOffset + 20);
    const nameLen = buf.readUInt16LE(centralOffset + 28);
    const extraLen = buf.readUInt16LE(centralOffset + 30);
    const commentLen = buf.readUInt16LE(centralOffset + 32);
    const localOffset = buf.readUInt32LE(centralOffset + 42);
    const name = buf.toString('utf8', centralOffset + 46, centralOffset + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed);

    entries.push({ name, data });
    centralOffset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extracts a zip file's contents into `destDir`, creating directories as needed. */
function extractZip(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  const entries = readZip(buf);
  for (const { name, data } of entries) {
    if (name.endsWith('/')) continue;
    const dest = path.join(destDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  return destDir;
}

module.exports = { buildZip, zipDirectory, readZip, extractZip };
