import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  { html: 'mockup-baseline.html',  png: 'mockup-baseline.png' },
  { html: 'mockup-option-a.html',  png: 'mockup-option-a.png' },
  { html: 'mockup-option-b.html',  png: 'mockup-option-b.png' },
  { html: 'mockup-option-c.html',  png: 'mockup-option-c.png' },
  { html: 'vibe-prototype.html',   png: 'vibe-prototype.png',  wide: true },
];

const browser = await chromium.launch();

for (const f of files) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: f.wide ? 1200 : 430, height: f.wide ? 900 : 900 });
  const url = 'file:///' + path.join(__dirname, f.html).replace(/\\/g, '/');
  await page.goto(url, { waitUntil: 'networkidle' });
  // Extra wait for Google Fonts + Unsplash image
  await page.waitForTimeout(2500);
  const outPath = path.join(__dirname, f.png);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log('Saved', f.png);
  await page.close();
}

await browser.close();
console.log('All done.');
