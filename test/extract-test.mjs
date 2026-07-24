// Node.js test harness: extract every entry of a CHM with the JS engine
// and compare byte-for-byte with CHMLib's extract_chmLib output.
import fs from 'node:fs';
import path from 'node:path';
import { ChmFile } from '../src/engine/chm.js';

const chmPath = process.argv[2];
const refDir = process.argv[3]; // optional: directory produced by extract_chmLib

const fd = fs.openSync(chmPath, 'r');
const size = fs.fstatSync(fd).size;
const reader = {
  size,
  read(off, len) {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, off);
    return new Uint8Array(buf.buffer, 0, n);
  },
};

const chm = ChmFile.open(reader);
console.log(`entries: ${chm.entries.length}, compression: ${chm.compressionEnabled}, windowBits: ${chm.lzxWindowBits}, resetBlkCount: ${chm.resetBlkCount}`);

let files = 0, okCount = 0, failCount = 0, cmpOk = 0, cmpBad = 0, cmpMissing = 0;
for (const e of chm.entries) {
  if (!e.path.startsWith('/') || e.path.endsWith('/') || e.path.startsWith('/#') || e.path.startsWith('/$')) continue;
  files++;
  let data;
  try {
    data = chm.retrieve(e);
    okCount++;
  } catch (err) {
    console.log(`FAIL retrieve ${e.path}: ${err.message}`);
    failCount++;
    continue;
  }
  if (refDir) {
    const refPath = path.join(refDir, e.path);
    if (!fs.existsSync(refPath)) { cmpMissing++; continue; }
    const ref = fs.readFileSync(refPath);
    if (ref.length === data.length && Buffer.compare(ref, Buffer.from(data)) === 0) cmpOk++;
    else { cmpBad++; console.log(`MISMATCH ${e.path} (${ref.length} vs ${data.length})`); }
  }
}
console.log(`files: ${files}, retrieved: ${okCount}, failed: ${failCount}`);
if (refDir) console.log(`compare: ok=${cmpOk} bad=${cmpBad} missing-ref=${cmpMissing}`);
process.exit(failCount || cmpBad ? 1 : 0);
