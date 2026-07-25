import { extractChm } from '@chm-md/core';
import fs from 'fs';

async function test() {
  try {
    const result = await extractChm('novel.chm');
    console.log('Success!');
    console.log('Files:', Object.keys(result.files).length);
    console.log('First 10 files:', Object.keys(result.files).slice(0, 10));
    
    // Check for TOC
    const tocFile = Object.keys(result.files).find(k => k.endsWith('.hhc'));
    if (tocFile) {
      console.log('\nTOC file found:', tocFile);
      const content = new TextDecoder().decode(result.files[tocFile]);
      console.log('TOC preview:', content.substring(0, 500));
    }
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  }
}

test();
