import fs from 'fs';

async function debug() {
  const buf = fs.readFileSync('novel.chm');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  
  const headerSize = view.getUint32(8, true);
  let pos = headerSize + 4; // skip numSections
  
  console.log('=== Parsing Directory Entries ===');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  
  while (pos < buf.length - 8) {
    const type = dv.getUint32(pos, true);
    
    if (type === 0xFFFFFFFF) {
      console.log('End marker found at', pos);
      break;
    }
    
    if (type === 0x01 || type === 0x00) {
      const len = dv.getUint32(pos + 4, true);
      console.log(`\nEntry at ${pos}: type=${type}, len=${len}`);
      
      if (pos + 8 + len > buf.length) {
        console.log('Would overflow, stopping');
        break;
      }
      
      // Entry structure: 
      // 0-3: unknown (4 bytes)
      // 4-7: unknown (4 bytes) 
      // 8-15: unknown (8 bytes)
      // 16-19: path length (4 bytes)
      // 20+: path (UTF-16LE)
      // then more fields for files
      
      const entryStart = pos + 8;
      const entryData = buf.slice(entryStart, entryStart + len);
      
      if (entryData.length >= 24) {
        const pathLen = dv.getUint32(entryStart + 20, true);
        console.log(`  Path length: ${pathLen}`);
        
        if (pathLen > 0 && entryStart + 24 + pathLen <= buf.length) {
          const pathBytes = buf.slice(entryStart + 24, entryStart + 24 + pathLen);
          const path = new TextDecoder('utf-16le').decode(pathBytes);
          console.log(`  Path: ${path}`);
        }
      }
      
      pos += 8 + len;
      
      if (pos > headerSize + 2000) {
        console.log('\nStopping after 2000 bytes');
        break;
      }
    } else {
      console.log(`Unknown type ${type.toString(16)} at ${pos}, skipping`);
      pos++;
    }
  }
}

debug();
