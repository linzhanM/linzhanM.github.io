// render-lab-video.mjs's own flags: usage text and the splitter together, so a
// new flag is one edit (as options.mjs is for the recorder). splitArgs() pulls
// these out of argv and leaves the rest for the recorder's parseArgs(), so
// every recorder flag keeps working unchanged.

import { fail } from './util.mjs';

export const USAGE = `
Record a motion-lab category with the chips, camera, skeleton and callouts
under direct control. Every render-category.mjs flag still applies.

  node unimate/tools/render-lab-video.mjs --category <label|slug> [options]

Chips and camera
  --prompt-scale <n>     Chip size, 1 = the page's own 10px. Text, padding,
                         radius, leader and pin scale together, and the lab
                         re-solves placement from the resulting box.
  --cam-elev <n>         Camera height / distance. The lab opens at 0.34, the
                         homepage thumbnail at 0.62.
  --orbit-angle <deg>    Opening orbit angle. The lab opens at 5.
  --pad <n>              Camera padding: >1 pulls back, <1 pushes in. Replaces
                         the lab's own padding (a category's entry in
                         cameraPaddingByCategory included), then --zoom divides it.

Orbit
  --orbit-speed <deg/s>  Auto-orbit rate. The lab's own is 8.
  --orbit-symmetric      Sweep symmetrically about --orbit-angle (default 0, the
                         lab's front) instead of starting there: the clip opens
                         half the sweep to one side and ends the same distance
                         on the other.
  --orbit-arc <deg>      Sweep exactly this many degrees over the clip, whatever
                         its length: sets the rate to arc / duration and implies
                         --orbit-symmetric. "--loops 1 --orbit-arc 60" swings
                         from +30 to -30 while the motion plays once.

Skeleton
  --skeleton-width <px>  Draw the skeleton as fat lines this many CSS px wide.
                         The lab's SkeletonHelper is WebGL line segments, always
                         1 device px, which all but vanishes at 4K or scaled
                         down to a video. The page's Skeleton switch still
                         governs both.
  --joint-size <px>      Round dots at every bone end, CSS px across. Default
                         2.2 x the skeleton width; 0 for none.
  --highlight <json>     {match, held, rest}: colour the bones whose name
                         matches /match/i "held" and every other bone "rest"
                         (omit either to keep the lab's own colour). Needs
                         --skeleton-width; the fat lines carry the colours.

Callouts (DOM over the canvas, so they read at any camera distance)
  --ring <json>          {match, color, size}: a ring around every joint whose
                         bone name matches, tracking it each frame.
  --annotate <json>      [{match, text, color, dx, dy, size}, ...]: a ring on
                         the first joint each name matches, a chip offset by
                         (dx, dy) px and a leader between them.

Rows of rigs (the Applications figures: given poses at the flanks, generated
motion between)
  --dim-middle <alpha>   Fade every rig but the leftmost and rightmost to this
                         opacity (meshes only; skeletons stay crisp).
  --only-ends            Hide every rig but the flanks. The camera fit has
                         already happened, so this clip and the full one frame
                         identically and cut together.

Stages, for this render only (the site's files are untouched)
  --stage-opts <json>    Stage options merged over this category's stageTuning
                         entry, e.g. '{"spacing":1.25,"scale":1.1}'.
  --extra-stages <file>  JSON array of catalog entries appended to EXAMPLES.
                         Absolute paths under "files" are copied into a scratch
                         folder inside the served tree for the run.

Shorthand
  --4k                   --width 1920 --height 1080 --scale 2 --no-downsample:
                         laid out at 1920 CSS px, so the chips keep their design
                         size against the frame, rendered at ratio 2 — a real
                         3840x2160, not an upscale.

Run "node unimate/tools/render-category.mjs --help" for every other flag.
`.trim();

export function splitArgs(argv) {
  const mine = {
    promptScale: 1, camElev: null, orbitAngle: null, pad: null,
    speed: null, symmetric: false, arc: null,
    skelWidth: null, jointSize: null, highlight: null,
    ring: null, annotate: null, dimMiddle: null, onlyEnds: false,
    stageOpts: null, extraStages: null,
  };
  const rest = [];
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) fail(`--${name} needs a number, got "${v}"`);
    return n;
  };
  const json = (v, name) => {
    try { return JSON.parse(v); } catch { fail(`--${name} needs JSON, got "${v}"`); }
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case '--prompt-scale': mine.promptScale = num(next(), 'prompt-scale'); break;
      case '--cam-elev': mine.camElev = num(next(), 'cam-elev'); break;
      case '--orbit-angle': mine.orbitAngle = num(next(), 'orbit-angle'); break;
      case '--pad': mine.pad = num(next(), 'pad'); break;
      case '--orbit-speed': mine.speed = num(next(), 'orbit-speed'); break;
      case '--orbit-symmetric': mine.symmetric = true; break;
      case '--orbit-arc': mine.arc = num(next(), 'orbit-arc'); mine.symmetric = true; break;
      case '--skeleton-width': mine.skelWidth = num(next(), 'skeleton-width'); break;
      case '--joint-size': mine.jointSize = num(next(), 'joint-size'); break;
      case '--highlight': mine.highlight = json(next(), 'highlight'); break;
      case '--ring': mine.ring = json(next(), 'ring'); break;
      case '--annotate': mine.annotate = json(next(), 'annotate'); break;
      case '--dim-middle': mine.dimMiddle = num(next(), 'dim-middle'); break;
      case '--only-ends': mine.onlyEnds = true; break;
      case '--stage-opts': mine.stageOpts = json(next(), 'stage-opts'); break;
      case '--extra-stages': mine.extraStages = next(); break;
      case '--4k': rest.push('--width', '1920', '--height', '1080', '--scale', '2', '--no-downsample'); break;
      case '--help': case '-h': console.log(USAGE); process.exit(0);
      default: rest.push(a);
    }
  }
  return { mine, rest };
}
