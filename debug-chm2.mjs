import fs from 'fs';

async function debug() {
  const buf = fs.readFileSync('novel.chm');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  
  const headerSize = view.getUint32(8, true);
  console.log('Header size:', headerSize);
  
  // CHM format has section table right after header
  // Section table: 4 bytes (num sections) + N * 8 bytes (offset, size for each section)
  const numSections = view.getUint32(headerSize, true);
  console.log('Number of sections:', numSections);
  
  // Section 0: Directory Table
  const dirSecOffset = view.getUint32(headerSize + 4, true);
  const dirSecSize = view.getUint32(headerSize + 8, true);
  console.log('\n=== Section 0 (Directory) ===');
  console.log('Offset:', dirSecOffset, 'Size:', dirSecSize);
  
  // Section 1: Data Section  
  const dataSecOffset = view.getUint32(headerSize + 12, true);
  const dataSecSize = view.getUint32(headerSize + 16, true);
  console.log('\n=== Section 1 (Data) ===');
  console.log('Offset:', dataSecOffset, 'Size:', dataSecSize);
  
  // The directory section contains compressed chunks
  // First 4 bytes of section data = chunk info size
  const chunkInfoOffset = dirSecOffset;
  const chunkSizeVal = view.getUint32(chunkInfoOffset, true);
  console.log('\n=== Chunk Info ===');
  console.log('Raw chunk size value:', chunkSizeVal.toString(16));
  
  // In CHM v3, the directory is always compressed with LZX
  // The first 4 bytes after section offset is the compressed size
  const compressedSize = chunkSizeVal & 0xFFFF;
  const uncompressedSize = (chunkSizeVal >> 16) & 0xFFFF;
  console.log('Compressed size:', compressedSize);
  console.log('Uncompressed size (hint):', uncompressedSize);
  
  // Actual compressed data starts at chunkInfoOffset + 4
  const compressedData = buf.slice(chunkInfoOffset + 4, chunkInfoOffset + 4 + compressedSize);
  console.log('Compressed data length:', compressedData.length);
  console.log('First 16 bytes of compressed:', Array.from(compressedData.slice(0, 16)).map(b => b.toString(16).padStart(2,'0')).join(' '));
}

debug();
