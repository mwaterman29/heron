/**
 * One-shot: turn a heron source image into a clean silhouette PNG.
 *
 * Two source modes:
 *   - alpha mode (default): expects a PNG with transparent background (i.e. user
 *     pre-scissored). Uses the alpha channel as the primary mask, then erodes
 *     a few pixels to remove fringe halo. Best when the source has clean alpha.
 *   - luminance mode: thresholds by perceived brightness. Use for photos against
 *     a flat white/light background.
 *
 * Pipeline (alpha mode):
 *  1. Load image (local file or URL)
 *  2. Place on a 1024x1024 canvas
 *  3. Mask: alpha > threshold → black, else transparent
 *  4. Erode by N pixels (kills halo)
 *  5. Connected-components: keep only the largest blob
 *  6. Crop to bbox, recenter + scale to fill canvas with padding
 *  7. Final smoothing pass
 *
 * Saves intermediate steps to %TEMP%/heron-build/ for inspection.
 *
 * Usage:
 *   npx tsx src/scripts/build-heron-logo.ts [source] [mode] [threshold] [erode]
 *
 *   source:    path to local file OR http(s) URL. Defaults to user's scissored
 *              version at C:\Users\Matt\Downloads\cleaner heron.png.
 *   mode:      "alpha" (default) or "luminance"
 *   threshold: alpha (0-255, default 80) or luminance (0-255, default 220)
 *   erode:     pixels to shrink silhouette by, alpha mode only (default 3)
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import puppeteer from 'puppeteer';

const argSource = process.argv[2] ?? 'C:/Users/Matt/Downloads/cleaner heron.png';
const argMode = (process.argv[3] ?? 'alpha') as 'alpha' | 'luminance';
const argThreshold = Number(process.argv[4] ?? (argMode === 'alpha' ? 80 : 220));
const argErode = Number(process.argv[5] ?? 3);

const OUT_DIR = 'C:/Users/Matt/AppData/Local/Temp/heron-build';
mkdirSync(OUT_DIR, { recursive: true });

// Resolve source to a data URL (local file) or pass through (http URL)
let sourceUrl: string;
if (argSource.startsWith('http')) {
  sourceUrl = argSource;
} else {
  if (!existsSync(argSource)) {
    console.error(`Source file not found: ${argSource}`);
    process.exit(1);
  }
  const buf = readFileSync(argSource);
  const ext = argSource.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
  sourceUrl = `data:image/${ext};base64,${buf.toString('base64')}`;
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-web-security'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log(`[page]`, m.text()));
page.on('pageerror', (e) => console.log('[page error]', e.message));
await page.setViewport({ width: 1100, height: 1100 });

const html = `<!doctype html><html><body style="margin:0;background:#888">
<canvas id="c" width="1024" height="1024"></canvas>
<script>
window.__results = {};

async function loadImage(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  return new Promise((res, rej) => { img.onload = () => res(img); img.onerror = rej; img.src = url; });
}

function snap(name, canvas) {
  window.__results[name] = canvas.toDataURL('image/png');
  console.log('snap ' + name);
}

async function go() {
  const img = await loadImage(${JSON.stringify(sourceUrl)});
  console.log('loaded ' + img.width + 'x' + img.height);

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;

  // STEP 1: place image at full size, fitting to 1024x1024 with breathing room
  const padding = 60;
  const targetSize = W - padding * 2;
  const scale = Math.min(targetSize / img.width, targetSize / img.height);
  const w = img.width * scale, h = img.height * scale;
  const x = (W - w) / 2, y = (H - h) / 2;

  // Fill with WHITE (so unmasked pixels read correctly in luminance mode)
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(img, x, y, w, h);
  snap('01-placed', canvas);

  // STEP 2: initial mask. alpha mode = use input alpha channel directly.
  // We reload the image into a separate canvas to read the source alpha BEFORE
  // the white fill obliterated it.
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = W; srcCanvas.height = H;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  srcCtx.clearRect(0, 0, W, H); // start transparent
  srcCtx.drawImage(img, x, y, w, h);
  const srcImg = srcCtx.getImageData(0, 0, W, H);
  const sp = srcImg.data;

  const mode = ${JSON.stringify(argMode)};
  const threshold = ${argThreshold};
  const data = ctx.createImageData(W, H);
  const px = data.data;

  if (mode === 'alpha') {
    for (let i = 0; i < sp.length; i += 4) {
      if (sp[i + 3] > threshold) {
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255;
      } else {
        px[i + 3] = 0;
      }
    }
  } else {
    for (let i = 0; i < sp.length; i += 4) {
      const lum = 0.299 * sp[i] + 0.587 * sp[i + 1] + 0.114 * sp[i + 2];
      const a = sp[i + 3];
      if (a > 16 && lum < threshold) {
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 255;
      } else {
        px[i + 3] = 0;
      }
    }
  }
  ctx.clearRect(0, 0, W, H);
  ctx.putImageData(data, 0, 0);
  snap('02-masked', canvas);

  // STEP 3: erode by N pixels — shrinks silhouette to drop the imperfect-scissor halo.
  // Cheap erosion via canvas filter: blur N px, then keep only nearly-fully-opaque.
  const erodePx = ${argErode};
  if (erodePx > 0) {
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    offCtx.filter = 'blur(' + erodePx + 'px)';
    offCtx.drawImage(canvas, 0, 0);
    const blurred = offCtx.getImageData(0, 0, W, H);
    const bp = blurred.data;
    // Erosion: ONLY pixels with very high alpha after blur survive (means they
    // were surrounded by other opaque pixels)
    for (let i = 0; i < bp.length; i += 4) {
      if (bp[i + 3] > 240) {
        bp[i] = 0; bp[i + 1] = 0; bp[i + 2] = 0; bp[i + 3] = 255;
      } else {
        bp[i + 3] = 0;
      }
    }
    ctx.clearRect(0, 0, W, H);
    ctx.putImageData(blurred, 0, 0);
    snap('03-eroded', canvas);
  } else {
    snap('03-eroded', canvas);
  }

  // STEP 4: morphological closing — fill any holes inside the silhouette
  const closeOff = document.createElement('canvas');
  closeOff.width = W; closeOff.height = H;
  const closeCtx = closeOff.getContext('2d', { willReadFrequently: true });
  closeCtx.filter = 'blur(2px)';
  closeCtx.drawImage(canvas, 0, 0);
  const closed = closeCtx.getImageData(0, 0, W, H);
  const cp = closed.data;
  for (let i = 0; i < cp.length; i += 4) {
    if (cp[i + 3] > 80) {
      cp[i] = 0; cp[i + 1] = 0; cp[i + 2] = 0; cp[i + 3] = 255;
    } else {
      cp[i + 3] = 0;
    }
  }
  ctx.clearRect(0, 0, W, H);
  ctx.putImageData(closed, 0, 0);
  snap('04-closed', canvas);

  // STEP 5: connected-component cleanup at low res — keep only the largest blob
  console.log('cc: starting');
  const SCALE = 4;
  const sw = W / SCALE, sh = H / SCALE;
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  const sCtx = small.getContext('2d', { willReadFrequently: true });
  sCtx.imageSmoothingEnabled = false;
  sCtx.drawImage(canvas, 0, 0, sw, sh);
  const sImg = sCtx.getImageData(0, 0, sw, sh);
  const sd = sImg.data;
  const labels = new Int32Array(sw * sh);
  const stack = new Int32Array(sw * sh);
  const sizes = [0];
  let nextId = 1;
  const opaque = (idx) => sd[idx * 4 + 3] >= 128;
  for (let y2 = 0; y2 < sh; y2++) {
    for (let x2 = 0; x2 < sw; x2++) {
      const startIdx = y2 * sw + x2;
      if (!opaque(startIdx) || labels[startIdx] !== 0) continue;
      labels[startIdx] = nextId;
      let sp_top = 0;
      stack[sp_top++] = startIdx;
      let count = 1;
      while (sp_top > 0) {
        const idx = stack[--sp_top];
        const py = (idx / sw) | 0, px2 = idx - py * sw;
        if (px2 > 0) {
          const n = idx - 1;
          if (labels[n] === 0 && opaque(n)) { labels[n] = nextId; count++; stack[sp_top++] = n; }
        }
        if (px2 < sw - 1) {
          const n = idx + 1;
          if (labels[n] === 0 && opaque(n)) { labels[n] = nextId; count++; stack[sp_top++] = n; }
        }
        if (py > 0) {
          const n = idx - sw;
          if (labels[n] === 0 && opaque(n)) { labels[n] = nextId; count++; stack[sp_top++] = n; }
        }
        if (py < sh - 1) {
          const n = idx + sw;
          if (labels[n] === 0 && opaque(n)) { labels[n] = nextId; count++; stack[sp_top++] = n; }
        }
      }
      sizes.push(count);
      nextId++;
    }
  }
  let largestId = 0, largestCount = 0;
  for (let id = 1; id < sizes.length; id++) {
    if (sizes[id] > largestCount) { largestCount = sizes[id]; largestId = id; }
  }
  console.log('components: ' + (sizes.length - 1) + ', largest=' + largestCount + 'px');

  const mask = sCtx.createImageData(sw, sh);
  const md = mask.data;
  for (let i = 0, p = 0; i < labels.length; i++, p += 4) {
    md[p + 3] = labels[i] === largestId ? 255 : 0;
  }
  sCtx.clearRect(0, 0, sw, sh);
  sCtx.putImageData(mask, 0, 0);

  const upMaskCanvas = document.createElement('canvas');
  upMaskCanvas.width = W; upMaskCanvas.height = H;
  const umCtx = upMaskCanvas.getContext('2d', { willReadFrequently: true });
  umCtx.imageSmoothingEnabled = false;
  umCtx.drawImage(small, 0, 0, W, H);
  const upMaskData = umCtx.getImageData(0, 0, W, H).data;
  for (let i = 0; i < cp.length; i += 4) {
    if (upMaskData[i + 3] < 64) cp[i + 3] = 0;
  }
  ctx.clearRect(0, 0, W, H);
  ctx.putImageData(closed, 0, 0);
  snap('05-cleaned', canvas);

  // STEP 6: bbox + recenter + scale
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let yy = 0; yy < H; yy++) {
    for (let xx = 0; xx < W; xx++) {
      if (cp[(yy * W + xx) * 4 + 3] === 255) {
        if (xx < minX) minX = xx;
        if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy;
        if (yy > maxY) maxY = yy;
      }
    }
  }
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  console.log('bbox: ' + bw + 'x' + bh);

  const crop = document.createElement('canvas');
  crop.width = bw; crop.height = bh;
  crop.getContext('2d').putImageData(closed, -minX, -minY, minX, minY, bw, bh);

  const pad2 = 80;
  const target = W - pad2 * 2;
  const s2 = Math.min(target / bw, target / bh);
  const newW = bw * s2, newH = bh * s2;
  const newX = (W - newW) / 2, newY = (H - newH) / 2;

  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(crop, newX, newY, newW, newH);
  snap('06-recentered', canvas);

  // STEP 7: final smoothing
  const finalOff = document.createElement('canvas');
  finalOff.width = W; finalOff.height = H;
  const finalCtx = finalOff.getContext('2d', { willReadFrequently: true });
  finalCtx.filter = 'blur(1px)';
  finalCtx.drawImage(canvas, 0, 0);
  const final = finalCtx.getImageData(0, 0, W, H);
  const fp = final.data;
  for (let i = 0; i < fp.length; i += 4) {
    if (fp[i + 3] > 128) {
      fp[i] = 0; fp[i + 1] = 0; fp[i + 2] = 0; fp[i + 3] = 255;
    } else {
      fp[i + 3] = 0;
    }
  }
  ctx.clearRect(0, 0, W, H);
  ctx.putImageData(final, 0, 0);
  snap('07-final', canvas);

  document.title = 'done';
}
go().catch((e) => { console.log('ERR ' + e.message); document.title = 'error: ' + e.message; });
</script>
</body></html>`;

writeFileSync(`${OUT_DIR}/debug.html`, html);
await page.setContent(html);
await page.waitForFunction('document.title === "done" || document.title.startsWith("error")', { timeout: 90000 });
const title = await page.title();
if (title.startsWith('error')) {
  console.error('Page error:', title);
  await browser.close();
  process.exit(1);
}

const results = await page.evaluate(() => (window as unknown as { __results: Record<string, string> }).__results);
for (const [name, dataUrl] of Object.entries(results)) {
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const path = `${OUT_DIR}/${name}.png`;
  writeFileSync(path, Buffer.from(base64, 'base64'));
  console.log(`  ${path}`);
}

await browser.close();
console.log(`\nsource=${argSource}`);
console.log(`mode=${argMode}  threshold=${argThreshold}  erode=${argErode}`);
console.log(`Inspect ${OUT_DIR}/07-final.png`);
