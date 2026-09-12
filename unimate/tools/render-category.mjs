#!/usr/bin/env node
// Render one category of interactive.html's motion lab to a video file — or
// one of the homepage's two thumbnails (--lab, see lib/labs.mjs).
//
//   node unimate/tools/render-category.mjs --category "Unitree G1 Robot"
//   node unimate/tools/render-category.mjs --list
//   node unimate/tools/render-category.mjs --lab homepage-dimo -c microduck --loops 1
//
// The lab is the renderer. This script serves the repo, drives a headless
// Chrome over CDP, and pipes what the page paints into ffmpeg. Nothing about
// the scene is re-implemented here: change how a category looks in
// examples.js / stage-tuning.js, then re-run. The page is reached only through
// the script injected by lib/bootstrap.mjs — the shipped viewer carries no
// capture-only code.
//
// Timing note: the viewer runs motion, auto-orbit and label easing off one
// measured delta, and the virtual clock hands it exactly 1/fps per frame, so
// --fps changes only how finely the same clip is sampled, never its speed.
// Stay at or above 20 fps: viewer.js caps a single frame's delta at 1/20 s (a
// stall guard for hidden tabs), and below that the whole render plays slow.
//
// Needs Chrome and ffmpeg; no npm packages. This file is the sequence and
// nothing else — each step is a module in lib/, mapped in unimate/README.md.

import { rm } from 'node:fs/promises';

import { bootstrapSource, viewerConfigFor } from './lib/bootstrap.mjs';
import { captureFrames } from './lib/capture.mjs';
import { CDP, openPage } from './lib/cdp.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { stageSeconds } from './lib/clip.mjs';
import { LABS } from './lib/labs.mjs';
import { parseArgs, wantsAlpha } from './lib/options.mjs';
import { frameFormat, frameGeometry, openSink } from './lib/output.mjs';
import { serveRepo } from './lib/server.mjs';
import {
  backgroundPainter, beginVirtualClock, clearDefaultBackground, hideChrome,
  openLab, reloadStageOnVirtualClock, resolveStage, stageSlug, useLightTheme, waitForStageLoaded,
} from './lib/stage.mjs';
import { sleep, slugify } from './lib/util.mjs';

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const alpha = wantsAlpha(opts);
  const lab = LABS[opts.lab];

  const { server, origin } = await serveRepo();
  const chrome = await launchChrome(opts);
  const cdp = await CDP.connect(chrome.wsUrl);

  const cleanup = async () => {
    try { cdp.ws.close(); } catch { /* already gone */ }
    chrome.child.kill();
    server.close();
    await rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
  };
  process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)); });

  try {
    const page = await openPage(cdp, opts);
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: bootstrapSource(viewerConfigFor(opts, lab), opts.zoom, lab.configGlobal),
    });
    // CSS transitions run on the real clock, not the virtual one; a page whose
    // cuts are transitions asks for them to be cuts (labs.mjs).
    if (lab.reducedMotion) {
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    }

    // ── Load the lab ─────────────────────────────────────────────────────────
    const slug = opts.category ? slugify(opts.category) : '';
    const stages = await openLab(page, origin, slug, lab);

    if (opts.list) {
      console.log(stages.map((s) => `  ${s.label.padEnd(20)} ${stageSlug(s)}`).join('\n'));
      return;
    }

    const match = resolveStage(stages, opts, slug);
    if (opts.theme === 'light') await useLightTheme(page, lab);

    process.stderr.write(`loading "${match.label}" — rigs, textures, camera fit\n`);
    await waitForStageLoaded(page, lab);

    // ── Backdrop ─────────────────────────────────────────────────────────────
    const applyBackground = backgroundPainter(page, opts, alpha);
    await applyBackground();
    if (alpha) await clearDefaultBackground(page);
    if (!opts.chromeUi) await hideChrome(page, lab);

    // ── How long the video runs ──────────────────────────────────────────────
    const seconds = await stageSeconds(page, origin, opts, lab);

    // Real time: first-frame shader compiles and the camera's damped fit must
    // be spent before the clock freezes.
    await sleep(opts.warmup);

    // ── Capture ──────────────────────────────────────────────────────────────
    const { captured, size } = frameGeometry(opts);
    const format = frameFormat(opts, alpha);
    const sink = await openSink(opts, { slug, size, alpha });
    const total = Math.max(1, Math.round(seconds * opts.fps));

    const resampled = size.width !== captured.width ? ` → ${size.width}x${size.height}` : '';
    process.stderr.write(`capturing ${total} frames at ${opts.fps} fps `
      + `(${captured.width}x${captured.height}${resampled})\n`);

    await beginVirtualClock(page);
    await reloadStageOnVirtualClock(page, match, lab);
    await applyBackground();   // the reload may have repainted it

    await captureFrames(page, sink, { total, fps: opts.fps, format, jpeg: opts.jpeg });
    await sink.finish();
    process.stderr.write(`wrote ${sink.path} — ${(total / opts.fps).toFixed(1)}s of "${match.label}"\n`);
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(`render-category: ${err.stack || err.message}`);
  process.exit(1);
});
