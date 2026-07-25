// Unit tests for hhc.js, paths.js, encodings.js (Node).
import { makeAsserter } from './helpers.mjs';
import { parseSitemap, flattenIndex, decodeEntities } from '../src/engine/hhc.js';
import { normalizePath, fragmentOf, isHtmlPath, isExternalHref, mimeFor } from '../src/engine/paths.js';
import { effectiveEncoding, canonicalCharset, looksLikeValidUtf8 } from '../src/engine/encodings.js';

const { ok, done } = makeAsserter('unit tests');

/* ---------------- hhc ---------------- */
const hhc = `
<HTML><BODY>
<OBJECT type="text/site properties"><param name="Window Styles" value="0x800025"></OBJECT>
<UL>
 <LI><OBJECT type="text/sitemap">
   <param name="Name" value="第一卷 风起">
   <param name="Local" value="html/vol1.htm">
 </OBJECT>
 <UL>
  <LI><OBJECT type="text/sitemap">
    <param name="Name" value="第一章 &amp; 序">
    <param name="Local" value="html\\ch001.htm">
  </OBJECT>
  <LI><OBJECT type="text/sitemap">
    <param name="Name" value="第二章">
    <param name="Local" value="html/ch002.htm#top">
  </OBJECT>
 </UL>
 <LI><OBJECT type="text/sitemap"><param name="Name" value="No target folder"></OBJECT>
 <UL>
   <LI><OBJECT type="text/sitemap"><param name="Name" value="Nested"><param name="Local" value="deep/x.html"></OBJECT>
 </UL>
</UL>
</BODY></HTML>`;

const tree = parseSitemap(hhc);
ok(tree.children.length === 2, 'hhc: two top-level nodes');
ok(tree.children[0].name === '第一卷 风起', 'hhc: CJK name');
ok(tree.children[0].children.length === 2, 'hhc: nested children under first node');
ok(tree.children[0].children[0].name === '第一章 & 序', 'hhc: entity decoding');
ok(tree.children[0].children[0].local === 'html\\ch001.htm', 'hhc: raw local kept');
ok(tree.children[1].children[0].name === 'Nested', 'hhc: folder without local still nests');

/* unclosed li, uppercase, single quotes */
const sloppy = `<ul><li><object type='text/sitemap'><PARAM NAME=Name VALUE=Alpha><PARAM NAME=Local VALUE=a.htm></object>
<LI><OBJECT type="text/sitemap"><param name="Name" value="Beta"><param name="Local" value="b.htm"></OBJECT></UL>`;
const t2 = parseSitemap(sloppy);
ok(t2.children.length === 2 && t2.children[1].name === 'Beta', 'hhc: sloppy markup');

/* hhk flatten */
const hhk = `<UL>
<LI><OBJECT type="text/sitemap"><param name="Name" value="zeta"><param name="Local" value="z.htm"></OBJECT>
<LI><OBJECT type="text/sitemap"><param name="Name" value="alpha"><param name="Local" value="a1.htm"><param name="Local" value="a2.htm"></OBJECT>
</UL>`;
const idx = flattenIndex(parseSitemap(hhk));
ok(idx.length === 2 && idx[0].name === 'alpha', 'hhk: sorted');
ok(idx[0].targets.length === 2, 'hhk: multiple locals');

/* ---------------- paths ---------------- */
ok(normalizePath('/html/a.htm', 'b.htm') === '/html/b.htm', 'path: sibling');
ok(normalizePath('/html/a.htm', '../img/x.png') === '/img/x.png', 'path: parent');
ok(normalizePath('/a.htm', '/abs/b.htm') === '/abs/b.htm', 'path: absolute');
ok(normalizePath('/a.htm', 'dir\\win.htm') === '/dir/win.htm', 'path: backslashes');
ok(normalizePath('/a.htm', 'x.htm#frag') === '/x.htm', 'path: strips fragment');
ok(normalizePath('/a.htm', 'x.htm?q=1') === '/x.htm', 'path: strips query');
ok(normalizePath('/a.htm', 'ms-its:book.chm::/inner.htm') === '/inner.htm', 'path: ms-its');
ok(normalizePath('/a.htm', 'mk:@MSITStore:C:\\docs\\book.chm::/inner.htm') === '/inner.htm', 'path: mk:@MSITStore');
ok(normalizePath('/d/a.htm', '%E7%AC%AC%E4%B8%80%E7%AB%A0.htm') === '/d/第一章.htm', 'path: percent decoding');
ok(fragmentOf('a.htm#x') === 'x' && fragmentOf('a.htm') === '', 'path: fragmentOf');
ok(isHtmlPath('/x/y.HTML') && !isHtmlPath('/x/y.css'), 'path: isHtmlPath');
ok(isExternalHref('https://x.com') && !isExternalHref('ch1.htm'), 'path: isExternalHref');
ok(mimeFor('/a/b.PNG') === 'image/png' && mimeFor('/x.css') === 'text/css', 'path: mime');

/* ---------------- encodings ---------------- */
ok(canonicalCharset('GB2312') === 'gbk', 'enc: alias gb2312');
ok(canonicalCharset('Shift-JIS') === 'shift_jis', 'enc: alias sjis');
const gbkBytes = new Uint8Array([0xC4, 0xE3, 0xBA, 0xC3]); // "你好" in GBK
ok(looksLikeValidUtf8(gbkBytes) === false, 'enc: gbk bytes are not utf8');
ok(effectiveEncoding(gbkBytes, null, 'gbk') === 'gbk', 'enc: falls back to book default');
ok(effectiveEncoding(gbkBytes, 'big5', 'gbk') === 'big5', 'enc: override wins');
const utf8Bytes = new TextEncoder().encode('你好世界');
ok(effectiveEncoding(utf8Bytes, null, 'gbk') === 'utf-8', 'enc: valid utf8 detected');
const metaBytes = new TextEncoder().encode('<html><head><meta http-equiv="Content-Type" content="text/html; charset=gb2312"></head>');
ok(effectiveEncoding(metaBytes, null, 'utf-8') === 'gbk', 'enc: meta charset wins');
ok(decodeEntities('&#x4F60;&#22909;&amp;') === '你好&', 'entities: numeric + named');

/* ---------------- fallback TOC ---------------- */
const { fallbackTocFromPaths } = await import('../src/engine/book.js');
const flat = fallbackTocFromPaths(['/a.htm', '/b.htm']);
ok(flat.length === 2 && flat[0].local === '/a.htm', 'fallback: single dir stays flat');
const grouped = fallbackTocFromPaths(['/v1/c1.htm', '/v1/c2.htm', '/v2/c1.htm']);
ok(grouped.length === 2 && grouped[0].name === 'v1' && grouped[0].children.length === 2,
  'fallback: groups by directory');
ok(grouped[1].children[0].local === '/v2/c1.htm', 'fallback: children navigable');

done();
