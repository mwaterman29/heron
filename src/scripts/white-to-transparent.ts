/**
 * Tiny utility: convert white background pixels in a PNG to transparent.
 * Anything brighter than the threshold becomes transparent; everything else
 * is collapsed to solid black at full opacity.
 *
 * Usage: npx tsx src/scripts/white-to-transparent.ts <input.png> [output.png] [threshold]
 *   threshold defaults to 240 (luminance 0-255). Anything ≥ this → transparent.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';

const input = process.argv[2];
if (!input) {
  console.error('usage: white-to-transparent.ts <input.png> [output.png] [threshold]');
  process.exit(1);
}
const output = process.argv[3] ?? input;
const threshold = Number(process.argv[4] ?? 240);

const buf = readFileSync(input);
const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', (m) => console.log(`[page]`, m.text()));
page.on('pageerror', (e) => console.log('[page error]', e.message));

const html = `<!doctype html><html><body style="margin:0">
<canvas id="c"></canvas>
<script>
async function go() {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = ${JSON.stringify(dataUrl)}; });
  console.log('loaded ' + img.width + 'x' + img.height);

  const canvas = document.getElementById('c');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  let kept = 0, dropped = 0;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (lum >= ${threshold}) {
      px[i + 3] = 0; dropped++;
    } else {
      px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255; kept++;
    }
  }
  ctx.putImageData(data, 0, 0);
  console.log('kept=' + kept + ' dropped=' + dropped);

  window.__result = canvas.toDataURL('image/png');
  document.title = 'done';
}
go().catch((e) => { console.log('ERR ' + e.message); document.title = 'error: ' + e.message; });
</script>
</body></html>`;

await page.setContent(html);
await page.waitForFunction('document.title === "done" || document.title.startsWith("error")', { timeout: 30000 });
const title = await page.title();
if (title.startsWith('error')) {
  console.error('Page error:', title);
  await browser.close();
  process.exit(1);
}

const result = await page.evaluate(() => (window as unknown as { __result: string }).__result);
const base64 = result.replace(/^data:image\/png;base64,/, '');
writeFileSync(output, Buffer.from(base64, 'base64'));
console.log(`wrote ${output}`);

await browser.close();
