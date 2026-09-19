// Shared helpers. `fail` is the exit path for a misuse or an unusable
// environment: one line on stderr, prefixed with the running tool's name, no
// stack, exit 1. A thrown error instead reaches the entry point's catch and
// prints its stack — the right shape for a bug.

import { basename } from 'node:path';

const TOOL = basename(process.argv[1] || 'render-category.mjs', '.mjs');

export function fail(message) {
  console.error(`${TOOL}: ${message}`);
  process.exit(1);
}

// Must match stageSlug in viewer.js, so a --category resolves as the page's
// own hash would.
export const slugify = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitUntil(fn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}`);
    await sleep(150);
  }
}
