import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
page.on('console', msg => console.log('Console:', msg.text()));
page.on('pageerror', err => console.log('Page error:', err.message));

await page.goto('http://localhost:5200/', { waitUntil: 'networkidle0' });
await new Promise(resolve => setTimeout(resolve, 1000));

await page.evaluate(async () => {
  const input = document.querySelector('input[type="file"]');
  if (!input) return;
  
  const response = await fetch('/novel.chm');
  const blob = await response.blob();
  const file = new File([blob], 'novel.chm', { type: 'application/x-chm' });
  
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  input.files = dataTransfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
});

await new Promise(resolve => setTimeout(resolve, 5000));

const debug = await page.evaluate(() => {
  if (!window.__chmParser) return { error: 'no parser' };
  const parser = window.__chmParser;
  return {
    allFiles: parser.getAllFiles(),
    firstFew: parser.getAllFiles().slice(0, 10),
    total: parser.getAllFiles().length
  };
});
console.log('CHM Debug:', JSON.stringify(debug, null, 2));

const structure = await page.evaluate(() => {
  return {
    headerText: document.querySelector('.header-title')?.textContent,
    hasSidebar: !!document.querySelector('.sidebar'),
    tocCount: document.querySelectorAll('.toc-item').length,
    tocItems: Array.from(document.querySelectorAll('.toc-item')).map(el => el.textContent?.trim()).slice(0, 5)
  };
});
console.log('Page structure:', structure);

await browser.close();
