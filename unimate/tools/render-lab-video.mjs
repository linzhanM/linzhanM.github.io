#!/usr/bin/env node
// Record a motion-lab category as the page shows it — chrome hidden, skeleton
// on, prompts pinned, camera orbiting — with the chips, camera, skeleton and
// callouts under direct control.
//
//   node unimate/tools/render-lab-video.mjs --category Welcome --4k --prompt-scale 1.4 --seconds 8
//   node unimate/tools/render-lab-video.mjs --list
//
// The page is the renderer, as in render-category.mjs: this is that recorder's
// sequence, run with the same lib/ modules, plus what the recorder leaves to
// the page. Every recorder flag still applies; this tool's own are in
// lib/lab-video-options.mjs (`--help`). It reaches the page three ways, none
// of which touches the shipped viewer:
//
//   · config overrides folded into the lab's config global as it lands
//     (bootstrap.mjs) — camera elevation, opening angle, padding;
//   · page-side overlays injected after the bootstrap (lib/overlays.mjs) — fat
//     skeleton, joint rings, callouts, dimmed or hidden middle rigs, chip size;
//   · served modules rewritten as Chrome fetches them (lib/patches.mjs) — the
//     auto-orbit rate, and extra catalog stages for one run.
//
// Run-time framing edits (lib/framing.mjs) are written into the config once
// the stage is on screen; the reload on the virtual clock frames on them.
//
// Needs Chrome and ffmpeg; no npm packages. This file is the sequence and
// nothing else — each step is a module in lib/, mapped in unimate/README.md.

import { rm } from 'node:fs/promises';

import { bootstrapSource, viewerConfigFor } from './lib/bootstrap.mjs';
import { captureFrames } from './lib/capture.mjs';
import { CDP, openPage } from './lib/cdp.mjs';
import { launchChrome } from './lib/chrome.mjs';
import { stageSeconds } from './lib/clip.mjs';
import { applyPadding, applyStageOpts, centreSweep, setOrbitRate } from './lib/framing.mjs';
import { splitArgs } from './lib/lab-video-options.mjs';
import { LABS } from './lib/labs.mjs';
import { parseArgs, wantsAlpha } from './lib/options.mjs';
import { frameFormat, frameGeometry, openSink } from './lib/output.mjs';
import { overlaysFor } from './lib/overlays.mjs';
import { installPatches } from './lib/patches.mjs';
import { serveRepo } from './lib/server.mjs';
import {
  backgroundPainter, beginVirtualClock, clearDefaultBackground, hideChrome,
  openLab, reloadStageOnVirtualClock, resolveStage, stageSlug, useLightTheme, waitForStageLoaded,
} from './lib/stage.mjs';
import { sleep, slugify } from './lib/util.mjs';

async function main() {
  const { mine, rest } = splitArgs(process.argv.slice(2));
  const opts = parseArgs(rest);
  const alpha = wantsAlpha(opts);
  const lab = LABS[opts.lab];

  const { server, origin } = await serveRepo();
  const chrome = await launchChrome(opts);
  const cdp = await CDP.connect(chrome.wsUrl);

  let removePatches = async () => {};
  const cleanup = async () => {
    await removePatches();
    try { cdp.ws.close(); } catch { /* already gone */ }
    chrome.child.kill();
    server.close();
    await rm(chrome.profile, { recursive: true, force: true }).catch(() => {});
  };
  process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)); });

  try {
    const page = await openPage(cdp, opts);
    removePatches = await installPatches(cdp, page, mine);

    // ── Into the page, before any of its scripts ─────────────────────────────
    const config = { ...viewerConfigFor(opts, lab) };
    if (mine.camElev !== null) config.cameraElevation = mine.camElev;
    if (mine.orbitAngle !== null) config.initialOrbitAngle = mine.orbitAngle;
    if (mine.pad !== null) { config.cameraPadding = mine.pad; config.mobileCameraPadding = mine.pad; }
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: bootstrapSource(config, opts.zoom, lab.configGlobal),
    });
    for (const source of overlaysFor(mine)) {
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source });
    }
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

    // ── Framing for this run (read again at the reload below) ────────────────
    const speed = await setOrbitRate(page, mine, seconds);
    if (mine.stageOpts) await applyStageOpts(page, lab, match.label, mine.stageOpts);
    if (opts.zoom !== 1 || mine.pad !== null) await applyPadding(page, lab, match.label, opts, mine);
    if (mine.symmetric && opts.orbit) await centreSweep(page, lab, mine, speed, seconds);

    // Real time: first-frame shader compiles and the camera's damped fit must
    // be spent before the clock freezes.
    await sleep(opts.warmup);

    // ── Capture ──────────────────────────────────────────────────────────────
    const { captured, size } = frameGeometry(opts);
    const format = frameFormat(opts, alpha);
    const sink = await openSink(opts, { slug, size, alpha });
    const total = Math.max(1, Math.round(seconds * opts.fps));

    const resampled = size.width !== captured.width ? ` → ${size.width}x${size.height}` : '';
    process.stderr.write(`capturing ${total} frames at ${opts.fps} fps (${captured.width}x${captured.height}${resampled})`
      + `  chips x${mine.promptScale}`
      + (mine.skelWidth ? `  skeleton ${mine.skelWidth}px` : '')
      + (mine.camElev !== null ? `  elev ${mine.camElev}` : '')
      + (mine.orbitAngle !== null ? `  orbit ${mine.orbitAngle}°` : '')
      + (mine.pad !== null ? `  pad ${mine.pad}` : '') + '\n');

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
  console.error(`render-lab-video: ${err.stack || err.message}`);
  process.exit(1);
});
