import fs from 'fs';

async function debug() {
  const buf = fs.readFileSync('novel.chm');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  
  const headerSize = view.getUint32(8, true);
  console.log('Header size:', headerSize);
  
  // The section table format in CHM v3:
  // - 4 bytes: number of sections
  // - For each section: 8 bytes (offset relative to data start, size)
  // But the "offset" is actually an index into the compressed data stream
  
  const numSections = view.getUint32(headerSize, true);
  console.log('Num sections:', numSections);
  
  // Section 0 is directory table
  // Section 1 is data table
  // The values are: decompressed offset, decompressed size
  
  // In CHM v3 with compression, we need to:
  // 1. Read the raw chunk at the section offset
  // 2. Decompress it with LZX
  
  // For now let's just look at the raw bytes
  console.log('\nRaw bytes at header+4:', Array.from(buf.slice(headerSize + 4, headerSize + 20)).map(b => b.toString(16).padStart(2,'0')).join(' '));
  
  // Let me check if this is actually a simple uncompressed CHM
  // by looking for HTML content directly
  console.log('\nSearching for HTML markers...');
  const searchStr = '<!DOCTYPE';
  const encoder = new TextEncoder();
  const searchBytes = encoder.encode(searchStr);
  
  for (let i = 0; i < buf.length - searchBytes.length; i++) {
    let found = true;
    for (let j = 0; j < searchBytes.length; j++) {
      if (buf[i + j] !== searchBytes[j]) {
        found = false;
        break;
      }
    }
    if (found) {
      console.log(`Found '${searchStr}' at offset ${i}`);
      console.log('Context:', new TextDecoder().decode(buf.slice(i, i + 100)));
      break;
    }
  }
  
  // Also search for .hhc or .hhk
  console.log('\nSearching for .hhc/.hhk references...');
  for (let i = 0; i < buf.length - 4; i++) {
    if (buf[i] === 0x2e && buf[i+1] === 0x68 && buf[i+2] === 0x68 && (buf[i+3] === 0x63 || buf[i+3] === 0x6b)) {
      console.log(`Found at ${i}:`, new TextDecoder().decode(buf.slice(i, i + 20)));
    }
  }
}

debug();
