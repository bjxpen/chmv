import fs from 'fs';

async function debug() {
  const buf = fs.readFileSync('novel.chm');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  
  const headerSize = view.getUint32(8, true);
  
  // CHM v3 format: section table at headerSize
  // Each section entry is 8 bytes (offset, size) but offset is relative to start of file
  // Actually in CHM v3, sections are stored differently
  
  // Read the raw section table
  console.log('=== Raw Section Table ===');
  for (let i = 0; i < 3; i++) {
    const off = view.getUint32(headerSize + 4 + i * 8, true);
    const sz = view.getUint32(headerSize + 8 + i * 8, true);
    console.log(`Section ${i}: offset=${off}, size=${sz} (${sz.toString(16)})`);
  }
  
  // In CHM v3, the directory and data are interleaved
  // The "offset" field actually points to the location in the data stream
  // Let's look at the actual structure more carefully
  
  // According to CHM spec, after header we have:
  // - 4 bytes: number of directory entries  
  // - Then directory entries follow immediately
  
  console.log('\n=== Trying alternate parsing ===');
  // Skip to where directory entries should start
  // After header (96) + section info (4 + 8*2 = 20) = 116
  let pos = headerSize + 4; // skip numSections
  console.log('Starting at position:', pos);
  
  // Read until we find valid entry types
  while (pos < buf.length - 4) {
    const type = view.getUint32(pos, true);
    if (type === 0x01 || type === 0x00 || type === 0xFFFFFFFF) {
      console.log(`Found entry marker at ${pos}: type=${type.toString(16)}`);
      break;
    }
    pos++;
    if (pos > headerSize + 1000) {
      console.log('No entry found within 1000 bytes, stopping');
      break;
    }
  }
}

debug();
