#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Render one category of interactive.html's motion lab to a video file.
//
//   node unimate/tools/render-category.mjs --category "Unitree G1 Robot"
//   node unimate/tools/render-category.mjs --list
//
// The lab is the renderer: this script only serves the repo, drives a real
// Chrome, and pipes what the page paints into ffmpeg. Nothing about the scene
// (framing, lighting, layout, orbit) is re-implemented here — change how a
// category looks by editing examples.js / stage-tuning.js, then re-run this.
//
// Two pieces make the output smooth instead of a jittery screen recording:
//
//   1. The page's clock is VIRTUAL during capture. requestAnimationFrame,
//      performance.now and Date.now are replaced before any page script runs,
//      and each captured frame advances time by exactly 1/fps. Screenshotting
//      is slow (~5-10 fps), but the page believes it ran at a perfect 60 —
//      so the mixers, the orbit and the label easing all land on exact frames.
//   2. WebGL contexts are forced to preserveDrawingBuffer. viewer.js asks for
//      the default (false), which lets the compositor clear the back buffer
//      after it paints; a screenshot taken outside the render tick then comes
//      back with a black canvas.
//
// Both live in the bootstrap injected via Page.addScriptToEvaluateOnNewDocument
// — the page itself is untouched, so nothing here can ship a capture-only hack
// to visitors.
//
// Dependencies: Chrome (found automatically, or --chrome-path / $CHROME_PATH)
// and ffmpeg on PATH. No npm packages — Node 22's global WebSocket speaks CDP
// directly, which is the whole of the driver in lib/cdp.mjs.
//
// Timing note: the viewer runs motion, auto-orbit and label easing off one
// measured delta, and the virtual clock hands it exactly 1/fps every frame, so
// --fps changes only how finely the same clip is sampled — never its speed.
// Stay at or above 20 fps: viewer.js caps a single frame's delta at 1/20 s (a
// stall guard for hidden tabs), and below that the whole render plays slow.
//
// This file is the sequence and nothing else; each step lives in lib/:
//
//   options.mjs    the command line — usage text and the parser
//   server.mjs     the repo served read-only on loopback
//   chrome.mjs     finding and launching the browser
//   cdp.mjs        the DevTools socket, and one attached page
//   bootstrap.mjs  everything injected into the page (virtual clock included)
//   stage.mjs      opening the lab and getting a category on screen
//   clip.mjs       how long the video runs, read out of the .glb rigs
//   output.mjs     frame geometry, the ffmpeg command, the frame sink
//   capture.mjs    the step-screenshot-write loop
//   paths.mjs      repo root, lab URL, default output directory
//   util.mjs       fail / slugify / waitUntil
// ─────────────────────────────────────────────────────────────────────────────

import { rm } from 'node:fs/promises';

import { bootstrapSource, viewerConfigFor } from './lib/bootstrap.mjs';
import { captureFrames } from './lib/capture.mjs';
import { CDP, openPage } from './lib/cdp.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { stageSeconds } from './lib/clip.mjs';
import { parseArgs, wantsAlpha } from './lib/options.mjs';
import { frameFormat, frameGeometry, openSink } from './lib/output.mjs';
import { serveRepo } from './lib/server.mjs';
import {
  backgroundPainter, beginVirtualClock, clearDefaultBackground, hideChrome,
  openLab, reloadStageOnVirtualClock, resolveStage, useLightTheme, waitForStageLoaded,
} from './lib/stage.mjs';
import { sleep, slugify } from './lib/util.mjs';

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const alpha = wantsAlpha(opts);

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
      source: bootstrapSource(viewerConfigFor(opts), opts.zoom),
    });

    // ── Load the lab ─────────────────────────────────────────────────────────
    const slug = opts.category ? slugify(opts.category) : '';
    const stages = await openLab(page, origin, slug);

    if (opts.list) {
      console.log(stages.map((label) => `  ${label.padEnd(20)} ${slugify(label)}`).join('\n'));
      return;
    }

    const match = resolveStage(stages, opts, slug);
    if (opts.theme === 'light') await useLightTheme(page);

    process.stderr.write(`loading "${match}" — rigs, textures, camera fit\n`);
    await waitForStageLoaded(page);

    // ── Backdrop ─────────────────────────────────────────────────────────────
    const applyBackground = backgroundPainter(page, opts, alpha);
    await applyBackground();
    if (alpha) await clearDefaultBackground(page);
    if (!opts.chromeUi) await hideChrome(page);

    // ── How long the video runs ──────────────────────────────────────────────
    const seconds = await stageSeconds(page, origin, opts);

    // Real time, so first-frame shader compiles and the camera's damped fit are
    // spent before the clock freezes.
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
    await reloadStageOnVirtualClock(page, stages.indexOf(match));
    await applyBackground();   // insurance: the reload must not repaint over it

    await captureFrames(page, sink, { total, fps: opts.fps, format, jpeg: opts.jpeg });
    await sink.finish();
    process.stderr.write(`wrote ${sink.path} — ${(total / opts.fps).toFixed(1)}s of "${match}"\n`);
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(`render-category: ${err.stack || err.message}`);
  process.exit(1);
});
