import { existsSync } from 'node:fs';

/**
 * Locate an installed Chromium-based browser on the user's system. We use
 * `puppeteer-core` (slim, no bundled Chromium) and pass `executablePath` at
 * launch time. This keeps the MSI install size reasonable — Windows 10+
 * ships Edge by default, and most users also have Chrome, so detection
 * succeeds for ~99% of users without us having to ship a 150 MB Chromium.
 *
 * Override with HERON_BROWSER_PATH if the user has a non-standard install.
 */

export interface BrowserInfo {
  name: string;
  path: string;
}

interface Candidate {
  name: string;
  paths: string[];
}

function expand(envVar: string, suffix: string): string | null {
  const base = process.env[envVar];
  return base ? `${base}${suffix}` : null;
}

function windowsCandidates(): Candidate[] {
  return [
    {
      name: 'Google Chrome',
      paths: [
        expand('PROGRAMFILES', '\\Google\\Chrome\\Application\\chrome.exe'),
        expand('PROGRAMFILES(X86)', '\\Google\\Chrome\\Application\\chrome.exe'),
        expand('LOCALAPPDATA', '\\Google\\Chrome\\Application\\chrome.exe'),
      ].filter((p): p is string => !!p),
    },
    {
      name: 'Microsoft Edge',
      paths: [
        expand('PROGRAMFILES(X86)', '\\Microsoft\\Edge\\Application\\msedge.exe'),
        expand('PROGRAMFILES', '\\Microsoft\\Edge\\Application\\msedge.exe'),
        expand('LOCALAPPDATA', '\\Microsoft\\Edge\\Application\\msedge.exe'),
      ].filter((p): p is string => !!p),
    },
    {
      name: 'Chromium',
      paths: [
        expand('PROGRAMFILES', '\\Chromium\\Application\\chrome.exe'),
        expand('LOCALAPPDATA', '\\Chromium\\Application\\chrome.exe'),
      ].filter((p): p is string => !!p),
    },
  ];
}

function macCandidates(): Candidate[] {
  return [
    {
      name: 'Google Chrome',
      paths: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    },
    {
      name: 'Microsoft Edge',
      paths: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
    },
    {
      name: 'Chromium',
      paths: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
    },
  ];
}

function linuxCandidates(): Candidate[] {
  return [
    {
      name: 'Google Chrome',
      paths: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
    },
    { name: 'Chromium', paths: ['/usr/bin/chromium', '/usr/bin/chromium-browser'] },
    { name: 'Microsoft Edge', paths: ['/usr/bin/microsoft-edge'] },
  ];
}

export function detectBrowser(): BrowserInfo | null {
  const override = process.env.HERON_BROWSER_PATH?.trim();
  if (override) {
    if (existsSync(override)) return { name: 'HERON_BROWSER_PATH', path: override };
    return null;
  }

  const candidates =
    process.platform === 'win32'
      ? windowsCandidates()
      : process.platform === 'darwin'
        ? macCandidates()
        : linuxCandidates();

  for (const { name, paths } of candidates) {
    for (const p of paths) {
      if (existsSync(p)) return { name, path: p };
    }
  }
  return null;
}

export class BrowserNotFoundError extends Error {
  constructor() {
    super(
      'No installed browser found. Heron uses your installed Chrome, Edge, or Chromium ' +
        'to scrape marketplaces. Install one (https://www.google.com/chrome/ is the easiest), ' +
        'then click Run Now again. If you have a browser in a non-standard location, set ' +
        'HERON_BROWSER_PATH in your .env to point at the executable.',
    );
    this.name = 'BrowserNotFoundError';
  }
}
