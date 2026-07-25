import fs from 'fs';

async function debug() {
  const buf = fs.readFileSync('novel.chm');
  
  // This looks like a compressed CHM file
  // The section table shows 510 sections which is unusual
  // Let me try using an existing CHM library to parse it
  
  console.log('File size:', buf.length);
  console.log('First 256 bytes hex:');
  for (let i = 0; i < 256; i += 16) {
    const hex = Array.from(buf.slice(i, i + 16)).map(b => b.toString(16).padStart(2,'0')).join(' ');
    const ascii = Array.from(buf.slice(i, i + 16)).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
    console.log(`${i.toString(16).padStart(4)}: ${hex.padEnd(48)} |${ascii}|`);
  }
}

debug();
