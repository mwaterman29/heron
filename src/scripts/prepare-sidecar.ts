/**
 * Prepares the bundled sidecar runtime that Tauri ships in the MSI.
 *
 * Output layout (under app/src-tauri/sidecar-runtime/):
 *   node.exe              — portable Node.js runtime
 *   dist/                 — compiled JS (the sidecar entry is dist/index.js)
 *   node_modules/         — production-only deps (no dev deps)
 *   package.json          — minimal manifest so node module resolution works
 *
 * Tauri's `bundle.resources` glob pulls all of these into the MSI; the
 * dev-sidecar Rust shim launches `node.exe dist/index.js` from this dir at
 * runtime.
 *
 * Usage:
 *   npm run prepare-sidecar
 *
 * Idempotent — re-running rebuilds dist + node_modules. node.exe is only
 * downloaded if missing (it's ~30 MB and rarely changes).
 */

import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const SIDECAR_DIR = resolve(PROJECT_ROOT, 'app', 'src-tauri', 'sidecar-runtime');

// Pinned Node version. Update by bumping NODE_VERSION + the SHA256 once
// verified. Windows portable builds let us drop a single .exe in the bundle
// without an installer.
const NODE_VERSION = '22.21.1';
const NODE_DOWNLOAD_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;

async function main() {
  console.log(`Preparing sidecar runtime in ${SIDECAR_DIR}\n`);

  // Reset the bundle dir except for node.exe (cached across runs).
  const cachedNodeExe = resolve(SIDECAR_DIR, 'node.exe');
  const nodeExeBackup = existsSync(cachedNodeExe)
    ? readFileSync(cachedNodeExe)
    : null;

  if (existsSync(SIDECAR_DIR)) {
    rmSync(SIDECAR_DIR, { recursive: true, force: true });
  }
  mkdirSync(SIDECAR_DIR, { recursive: true });

  // Step 1: compile TypeScript
  console.log('[1/4] Compiling TypeScript → dist/');
  execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  cpSync(resolve(PROJECT_ROOT, 'dist'), resolve(SIDECAR_DIR, 'dist'), {
    recursive: true,
  });

  // Step 2: write a minimal package.json for the bundle (just the runtime
  // deps, so npm resolves them under sidecar-runtime/node_modules/).
  console.log('\n[2/4] Writing minimal package.json for sidecar bundle');
  const pkgPath = resolve(PROJECT_ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const slimPkg = {
    name: 'heron-sidecar-runtime',
    private: true,
    type: 'module',
    dependencies: pkg.dependencies,
  };
  writeFileSync(
    resolve(SIDECAR_DIR, 'package.json'),
    JSON.stringify(slimPkg, null, 2) + '\n',
  );

  // Step 3: install production-only deps into the bundle dir
  console.log('\n[3/4] Installing production deps (this can take a couple minutes)');
  execSync('npm install --omit=dev --no-package-lock --no-audit --no-fund', {
    cwd: SIDECAR_DIR,
    stdio: 'inherit',
  });

  // Step 4: ensure node.exe is in place
  console.log('\n[4/4] Ensuring node.exe is present');
  if (nodeExeBackup) {
    writeFileSync(cachedNodeExe, nodeExeBackup);
    console.log(`Restored cached node.exe (${nodeExeBackup.length.toLocaleString()} bytes)`);
  } else {
    await downloadNode(cachedNodeExe);
  }

  console.log(`\nDone. Bundle ready at ${SIDECAR_DIR}`);
}

async function downloadNode(targetPath: string) {
  const tmpZip = resolve(SIDECAR_DIR, 'node-portable.zip');
  console.log(`Downloading Node ${NODE_VERSION} from ${NODE_DOWNLOAD_URL}`);

  const res = await fetch(NODE_DOWNLOAD_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download Node: HTTP ${res.status}`);
  }
  await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(tmpZip));

  // Use PowerShell to extract since unzip isn't available by default on Windows.
  console.log('Extracting node.exe from archive');
  const extractDir = resolve(SIDECAR_DIR, 'node-extract');
  mkdirSync(extractDir, { recursive: true });
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Force '${tmpZip}' '${extractDir}'"`,
    { stdio: 'inherit' },
  );

  // The zip contains node-v<version>-win-x64/node.exe. Find and move it.
  const innerDir = resolve(extractDir, `node-v${NODE_VERSION}-win-x64`);
  const innerNodeExe = resolve(innerDir, 'node.exe');
  if (!existsSync(innerNodeExe)) {
    throw new Error(`node.exe not found at expected path: ${innerNodeExe}`);
  }
  cpSync(innerNodeExe, targetPath);
  rmSync(extractDir, { recursive: true, force: true });
  rmSync(tmpZip, { force: true });
  console.log(`node.exe placed at ${targetPath}`);
}

main().catch((err) => {
  console.error('prepare-sidecar failed:', err);
  process.exit(1);
});
