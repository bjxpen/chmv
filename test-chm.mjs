import { CHMParser } from './src/core/chm-parser.js';
import { EncodingEngine } from './src/core/encoding-engine.js';
import fs from 'fs';

async function test() {
  const buf = fs.readFileSync('novel.chm').buffer;
  
  console.log('File size:', buf.byteLength, 'bytes');
  console.log('First bytes:', new Uint8Array(buf, 0, 16));
  
  const parser = new CHMParser();
  try {
    const result = await parser.parse(buf);
    console.log('Parse successful!');
    console.log('Total files:', result.files.size);
    console.log('TOC entry:', result.toc?.path);
    console.log('Index entry:', result.index?.path);
    
    const htmlFiles = parser.getHTMLFiles();
    console.log('HTML files count:', htmlFiles.length);
    if (htmlFiles.length > 0) {
      console.log('First 5 HTML files:');
      htmlFiles.slice(0, 5).forEach((f, i) => console.log(`  ${i+1}. ${f.path}`));
      
      // Try to read first file
      const first = htmlFiles[0];
      const content = await parser.getTextContent(first);
      console.log('First file content preview:', content.substring(0, 200));
    }
  } catch (err) {
    console.error('Parse error:', err.message);
    console.error(err.stack);
  }
}

test();
