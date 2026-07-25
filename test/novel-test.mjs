// Book-level test against a real legacy CJK novel CHM (script-driven,
// GBK, no .hhc). Verifies encoding detection, synthetic TOC and
// document.write extraction.
import fs from 'node:fs';
import { ChmFile } from '../src/engine/chm.js';
import { openBook } from '../src/engine/book.js';
import { isDocWriteJs, docWriteToHtml, parsePagesArray, plainTextToHtml } from '../src/engine/noveljs.js';
import { decodeBytes } from '../src/engine/encodings.js';

const chmPath = process.argv[2] || 'novel.chm';
if (!fs.existsSync(chmPath)) {
  console.log(`novel-test: skipped (${chmPath} not found)`);
  process.exit(0);
}

let passed = 0;
const ok = (cond, name) => {
  if (!cond) { console.error(`FAIL: ${name}`); process.exitCode = 1; } else passed++;
};

const fd = fs.openSync(chmPath, 'r');
const reader = {
  size: fs.fstatSync(fd).size,
  read(off, len) {
    const buf = Buffer.alloc(len);
    const n = fs.readSync(fd, buf, 0, len, off);
    return new Uint8Array(buf.buffer, 0, n);
  },
};

const chm = ChmFile.open(reader);
const { book } = openBook(chm, { fileSize: reader.size });

ok(book.encoding === 'gbk', `book: GBK detected (got ${book.encoding})`);
ok(book.title && book.title.includes('梦回天阙'), `book: CJK title decoded (got ${book.title})`);
ok(book.synthetic === true, 'book: synthetic novel nav engaged');
ok(book.tocTree.length > 0, `book: synthetic TOC not empty (${book.tocTree.length} top nodes)`);
ok(book.docPaths.length >= 60, `book: spine covers chapters (${book.docPaths.length})`);
ok(book.docPaths.every((p) => /\/txt\//i.test(p)), 'book: spine contains only chapter files');

/* volume grouping: top-level nodes should include volume folders with children */
const volumes = book.tocTree.filter((n) => n.children.length > 0);
ok(volumes.length >= 5, `book: volumes grouped (${volumes.length})`);
const chapterCount = book.tocTree.reduce(
  (acc, n) => acc + (n.local ? 1 : 0) + n.children.filter((c) => c.local).length, 0);
ok(chapterCount === book.docPaths.length, `book: toc chapters == spine (${chapterCount})`);

/* first chapter must extract readable CJK text */
const first = chm.resolve(book.docPaths[0]);
const rawText = decodeBytes(chm.retrieve(first), 'gbk');
ok(isDocWriteJs(rawText), 'chapter: recognized as document.write script');
const html = docWriteToHtml(rawText);
ok(html.length > 200, `chapter: extracted html (${html.length} chars)`);
ok(!/document\s*\.\s*write/.test(html), 'chapter: no leftover script fragments');
ok(/[\u4e00-\u9fff]/.test(html), 'chapter: contains CJK text');

/* every chapter should extract non-trivially */
let bad = 0;
for (const p of book.docPaths) {
  const e = chm.resolve(p);
  const text = decodeBytes(chm.retrieve(e), 'gbk');
  const out = isDocWriteJs(text) ? docWriteToHtml(text) : plainTextToHtml(text);
  if (out.replace(/<[^>]*>/g, '').trim().length < 50) bad++;
}
ok(bad === 0, `chapter: all ${book.docPaths.length} chapters extract text (${bad} bad)`);

/* pages[] parser unit checks */
const pages = parsePagesArray(`
 pages[0]=['01_1','<font size=2>intro</font>','2','<img src=../txt/1.jpg>'];
 pages[1]=['02_1','【第一集】','10611','第一集'];
 pages[2]=['02_2','第二章 it\\'s','14379'];
`);
ok(pages.length === 3, 'pages: parsed all rows');
ok(pages[0].volume === null, 'pages: <img …> 4th field is not a volume');
ok(pages[1].volume === '第一集', 'pages: volume captured');
ok(pages[2].title.includes("it's"), 'pages: escaped quote handled');

console.log(`novel tests: ${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
