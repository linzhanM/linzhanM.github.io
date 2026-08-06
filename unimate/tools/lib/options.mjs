// The command line: usage text and the parser, kept together so a new flag is
// one edit in one file.

import { fail } from './util.mjs';

export const USAGE = `
Render one motion-lab category to a video.

  node unimate/tools/render-category.mjs --category <label|slug> [options]

  --category, -c <name>  Category label ("Unitree G1 Robot") or its slug
                         ("unitree-g1-robot"). Required unless --list.
  --list                 Print every category the lab currently shows, and exit.
  --out, -o <file>       Output path. Extension picks the codec: .mp4 (h264),
                         .webm (vp9), .gif, or .png for a numbered sequence in a
                         directory. Default ~/Downloads/lab_renders/<slug>.mp4
  --loops <n>            How many times the category's motion repeats. The clip
                         length is read from the .glb animations themselves —
                         the longest rig in the stage gets this many passes, so
                         every rig gets at least this many. Default 3.
  --seconds, -s <n>      Fixed clip length, overriding --loops.
  --fps <n>              Frames per second, capture and playback. Sampling only:
                         the clip runs at the same speed at any rate. Keep it at
                         20 or above (see the timing note up top). Default 60.
  --width <px>           Output width. Default 2560.
  --height <px>          Output height. Default 1440.
  --scale <n>            Supersampling factor: the lab renders at this multiple
                         of the output size and the frames are filtered back
                         down, which is what keeps skeleton lines and rig edges
                         from crawling. Default 1.5 (2560x1440 off a 4K render).
                         Above 2 buys nothing in the scene — viewer.js caps its
                         own pixel ratio there — only in the DOM chips.
  --no-downsample        Keep the captured pixels: output becomes width x scale
                         by height x scale (--scale 2 --width 1920 gives 4K).
  --zoom <n>             Pull the camera in (>1) or back (<1) against the lab's
                         own framing. A 16:9 frame leaves floor above and below
                         a wide row — either zoom in, or ask for a wider frame
                         (--width 2400 --height 1000). Default 1.
  --theme <dark|light>   Lab palette. Default dark (the lab's own). This is the
                         whole palette — floor, lights, skeleton — not just the
                         backdrop.
  --background <color>   Repaint only what is BEHIND the stage: any CSS colour
                         ("#101014", "white", "rgb(20 22 28)"), or "transparent"
                         for an alpha channel. The floor and lighting stay on
                         the theme, so a light backdrop under --theme dark keeps
                         the dark checker floor — pair it with --theme light if
                         you want the whole page to move.
                         Transparent needs a format that keeps alpha: .mov
                         (ProRes 4444) or a .png sequence.
  --chrome-ui            Keep the lab's chrome (panel, toolbars). Off by default.
  --labels               Show every prompt chip anchored, instead of the lab's
                         one-at-a-time-on-hover behaviour.
  --no-orbit             Hold the opening camera instead of auto-orbiting.
  --jpeg                 Capture JPEG frames instead of PNG. Roughly twice as
                         fast, and the h264 pass re-compresses anyway.
  --crf <n>              Quality for mp4/webm, lower is better. Default 18.
  --warmup <ms>          Real time to let the stage settle before the clock goes
                         virtual — shader compiles, camera fit. Default 1500.
  --headful              Show the browser window (useful when a capture looks
                         wrong and you want to watch it happen).
  --chrome-path <bin>    Chrome executable. Default: $CHROME_PATH, then the
                         usual macOS/Linux locations.
  --keep-frames <dir>    Also write every captured frame to <dir>.
`.trim();

export function parseArgs(argv) {
  const o = {
    category: null, list: false, out: null, seconds: null, loops: 3, fps: 60,
    width: 2560, height: 1440, scale: 1.5, downsample: true, zoom: 1, theme: 'dark',
    background: null, chromeUi: false,
    labels: false, orbit: true, jpeg: false, crf: 18, warmup: 1500,
    headful: false, chromePath: process.env.CHROME_PATH || null, keepFrames: null,
  };
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) fail(`--${name} needs a number, got "${v}"`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case '--category': case '-c': o.category = next(); break;
      case '--list': o.list = true; break;
      case '--out': case '-o': o.out = next(); break;
      case '--seconds': case '-s': o.seconds = num(next(), 'seconds'); break;
      case '--loops': o.loops = num(next(), 'loops'); break;
      case '--fps': o.fps = num(next(), 'fps'); break;
      case '--width': o.width = Math.round(num(next(), 'width')); break;
      case '--height': o.height = Math.round(num(next(), 'height')); break;
      case '--scale': o.scale = num(next(), 'scale'); break;
      case '--no-downsample': o.downsample = false; break;
      case '--zoom': o.zoom = num(next(), 'zoom'); break;
      case '--theme': o.theme = next(); break;
      case '--background': case '--bg': o.background = next(); break;
      case '--chrome-ui': o.chromeUi = true; break;
      case '--labels': o.labels = true; break;
      case '--no-orbit': o.orbit = false; break;
      case '--jpeg': o.jpeg = true; break;
      case '--crf': o.crf = num(next(), 'crf'); break;
      case '--warmup': o.warmup = num(next(), 'warmup'); break;
      case '--headful': o.headful = true; break;
      case '--chrome-path': o.chromePath = next(); break;
      case '--keep-frames': o.keepFrames = next(); break;
      case '--help': case '-h': console.log(USAGE); process.exit(0);
      default:
        if (!a.startsWith('-') && !o.category) { o.category = a; break; }
        fail(`unknown option "${a}"\n\n${USAGE}`);
    }
  }
  if (!o.list && !o.category) fail(`nothing to render — pass --category or --list\n\n${USAGE}`);
  if (o.theme !== 'dark' && o.theme !== 'light') fail('--theme must be dark or light');
  return o;
}

// "transparent" is a value of --background, not a flag, and three separate
// decisions read it (alpha in the encoder, the page's own fills, PNG over
// JPEG), so it is normalized once here.
export const wantsAlpha = (opts) =>
  !!opts.background && opts.background.trim().toLowerCase() === 'transparent';
