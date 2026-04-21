/**
 * Vectorize the heron silhouette PNG → clean SVG via potrace.
 * Used once to produce app/src-tauri/icons/heron.svg from heron-source.png;
 * keeping the script so the SVG can be regenerated if the source ever changes.
 *
 * Usage: npx tsx src/scripts/vectorize-heron.ts [input.png] [output.svg]
 */
import { writeFileSync } from 'node:fs';
// @ts-expect-error - potrace ships no types
import potrace from 'potrace';

const input = process.argv[2] ?? 'app/src-tauri/icons/heron-source.png';
const output = process.argv[3] ?? 'app/src-tauri/icons/heron.svg';

// Tuning notes:
// - turdSize: minimum area (pixels) of paths to keep. 8 drops noise without
//   losing actual features like toes.
// - alphaMax: corner threshold (0=sharp corners, 1=smooth curves). 1.0 is the
//   default and gives nice flowing curves on the bird's body.
// - optTolerance: curve fit tolerance. Smaller = more accurate but more nodes.
//   0.2 is the default; gives clean output without over-smoothing.
// - threshold: pixel cutoff for "is this opaque" — we already have a binary
//   alpha mask so any value works, but 128 is the natural midpoint.
const opts = {
  turdSize: 8,
  alphaMax: 1.0,
  optTolerance: 0.2,
  threshold: 128,
  optCurve: true,
  color: '#000000',
  background: 'transparent',
};

await new Promise<void>((resolve, reject) => {
  potrace.trace(input, opts, (err: Error | null, svg: string) => {
    if (err) return reject(err);
    writeFileSync(output, svg, 'utf8');
    console.log(`wrote ${output} (${svg.length} bytes)`);
    resolve();
  });
});
