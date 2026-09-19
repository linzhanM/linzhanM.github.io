// How long the video runs, read out of the rigs themselves.

import { open } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { REPO_ROOT } from './paths.mjs';

// One pass of a rig's motion, straight out of the .glb: each animation
// sampler's input accessor has a `max`, which is its last keyframe time. Only
// the header and the JSON chunk are read, so a 40 MB rig costs a few hundred
// bytes.
export async function glbClipSeconds(file) {
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(20);
    const { bytesRead } = await fh.read(head, 0, 20, 0);
    if (bytesRead < 20 || head.readUInt32LE(0) !== 0x46546c67) return 0;   // 'glTF'
    const chunkLength = head.readUInt32LE(12);
    if (head.readUInt32LE(16) !== 0x4e4f534a) return 0;                    // 'JSON'
    const json = Buffer.alloc(chunkLength);
    await fh.read(json, 0, chunkLength, 20);
    const gltf = JSON.parse(json.toString('utf8'));
    let longest = 0;
    for (const animation of gltf.animations || []) {
      for (const sampler of animation.samplers || []) {
        const input = gltf.accessors?.[sampler.input];
        const end = Array.isArray(input?.max) ? Number(input.max[0]) : 0;
        if (Number.isFinite(end)) longest = Math.max(longest, end);
      }
    }
    return longest;
  } catch {
    return 0;
  } finally {
    await fh.close();
  }
}

// Each rig loops on its own clip, so the video runs the LONGEST one times
// --loops: that rig gets exactly that many passes, shorter ones more, and none
// is cut mid-motion.
export async function stageSeconds(page, origin, opts, lab) {
  if (opts.seconds != null) return opts.seconds;

  // A page that plays a cycle of its own (the DIMO thumbnail) says how long
  // one pass is; --loops counts passes.
  if (lab.seconds) {
    const pass = await page.eval(lab.seconds);
    const seconds = pass * opts.loops;
    process.stderr.write(`one pass ${pass.toFixed(2)}s x ${opts.loops} loops = ${seconds.toFixed(2)}s\n`);
    return seconds;
  }

  const assets = await page.eval('window.__labCapture.assets()');
  const clips = [];
  for (const asset of assets) {
    const file = join(REPO_ROOT, new URL(asset, origin).pathname);
    if (extname(file).toLowerCase() === '.glb') clips.push(await glbClipSeconds(file));
  }
  const longest = Math.max(0, ...clips);
  if (longest <= 0) {
    console.error(`warning: no clip length found in the rigs — falling back to 2s x ${opts.loops} loops`);
    return 2 * opts.loops;
  }
  const seconds = longest * opts.loops;
  process.stderr.write(`${clips.length} rigs, longest clip ${longest.toFixed(2)}s`
    + ` x ${opts.loops} loops = ${seconds.toFixed(2)}s\n`);
  return seconds;
}
