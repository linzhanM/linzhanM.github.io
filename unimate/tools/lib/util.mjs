// Shared helpers. `fail` is the one exit path for a bad request or an
// unusable environment: a single line on stderr, no stack, exit 1. Anything
// thrown instead reaches the entry point's catch and prints its stack, which
// is the right shape for a bug rather than a misuse.

export function fail(message) {
  console.error(`render-category: ${message}`);
  process.exit(1);
}

// The lab's own slug rule (see interactive.js), so a --category matches the
// hash the page resolves.
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
