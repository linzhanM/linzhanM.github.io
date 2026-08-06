// Finding and starting the browser. Everything after the handshake is CDP —
// see cdp.mjs.

import { spawn } from 'node:child_process';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fail } from './util.mjs';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

async function findChrome(explicit) {
  const tried = explicit ? [explicit] : CHROME_CANDIDATES;
  for (const bin of tried) {
    try { await access(bin); return bin; } catch { /* next */ }
  }
  fail(`no Chrome found. Pass --chrome-path, or set $CHROME_PATH.\nLooked in:\n  ${tried.join('\n  ')}`);
}

export async function launchChrome(opts) {
  const bin = await findChrome(opts.chromePath);
  const profile = await mkdtemp(join(tmpdir(), 'unimate-lab-'));
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--no-startup-window',
    '--hide-scrollbars', '--mute-audio',
    '--disable-extensions', '--disable-background-networking',
    '--disable-features=Translate,MediaRouter',
    // WebGL must work even where the GPU process is unavailable (headless, CI,
    // an SSH session): this is the switch that lets ANGLE fall back to software.
    '--enable-unsafe-swiftshader',
    `--window-size=${opts.width},${opts.height}`,
  ];
  if (!opts.headful) args.push('--headless=new');

  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  // Chrome prints its own port when asked for 0. Reading stderr beats polling
  // /json/version, which needs the port we are trying to learn.
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const timer = setTimeout(() => rej(new Error('Chrome did not report a DevTools endpoint in 30s')), 30_000);
    child.stderr.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); res(m[1]); }
    });
    child.once('exit', (code) => { clearTimeout(timer); rej(new Error(`Chrome exited early (${code})`)); });
  });
  return { child, wsUrl, profile };
}
