import fs from 'fs';

async function debug() {
  const buf = fs.readFileSync('novel.chm');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  
  // Header
  console.log('=== CHM Header ===');
  const sig = view.getUint32(0, true);
  console.log('Signature:', sig.toString(16), '(expected: 46535449 for ITSF)');
  const version = view.getUint32(4, true);
  console.log('Version:', version);
  const headerSize = view.getUint32(8, true);
  console.log('Header size:', headerSize);
  
  // Section info at offset headerSize (0x60 = 96)
  console.log('\n=== Section Info ===');
  const offset = headerSize;
  console.log('Section offset:', offset);
  
  // Read section entries (each is 8 bytes: offset + size)
  const numSections = view.getUint32(offset, true);
  console.log('Number of sections:', numSections);
  
  // First section (directory table)
  const secOffset = view.getUint32(offset + 4, true);
  const secSize = view.getUint32(offset + 8, true);
  console.log('Section 0 - Offset:', secOffset, 'Size:', secSize);
  
  // Check if compressed (high bit of size)
  const isCompressed = (secSize & 0x80000000) !== 0;
  const actualSize = secSize & 0x7FFFFFFF;
  console.log('Is compressed:', isCompressed, 'Actual size:', actualSize);
  
  // Read raw directory data
  const dirData = buf.slice(secOffset, secOffset + actualSize);
  console.log('\n=== Directory Data ===');
  console.log('First 64 bytes:', new Uint8Array(dirData.slice(0, 64)));
  
  // Parse entries
  console.log('\n=== Entry Parsing ===');
  let pos = 0;
  const dv = new DataView(dirData.buffer, dirData.byteOffset, dirData.byteLength);
  
  while (pos < dirData.length - 8) {
    const type = dv.getUint32(pos, true);
    console.log(`Entry at ${pos}: type=${type.toString(16)}`);
    
    if (type === 0x01 || type === 0x00) {
      const len = dv.getUint32(pos + 4, true);
      console.log(`  Entry length: ${len}`);
      
      if (pos + 8 + len > dirData.length) {
        console.log('  -> Would overflow, stopping');
        break;
      }
      
      const entryData = dirData.slice(pos + 8, pos + 8 + len);
      console.log('  Entry data (first 32 bytes):', new Uint8Array(entryData.slice(0, Math.min(32, entryData.length))));
      
      // Try to parse path
      if (entryData.length >= 28) {
        const pathLen = new DataView(entryData.buffer, entryData.byteOffset, entryData.byteLength).getUint32(24, true);
        console.log(`  Path length: ${pathLen}`);
        if (pathLen > 0 && 28 + pathLen <= entryData.length) {
          const pathBytes = entryData.slice(28, 28 + pathLen);
          const path = new TextDecoder('utf-16le').decode(pathBytes);
          console.log(`  Path: ${path}`);
        }
      }
      
      pos += 8 + len;
    } else if (type === 0xFFFFFFFF) {
      console.log('  -> End marker');
      break;
    } else {
      console.log('  -> Unknown type, stopping');
      break;
    }
  }
}

debug();
