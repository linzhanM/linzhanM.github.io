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
// directly, which is the whole of the driver below.
//
// Timing note: the viewer runs motion, auto-orbit and label easing off one
// measured delta, and the virtual clock hands it exactly 1/fps every frame, so
// --fps changes only how finely the same clip is sampled — never its speed.
// Stay at or above 20 fps: viewer.js caps a single frame's delta at 1/20 s (a
// stall guard for hidden tabs), and below that the whole render plays slow.
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TOOLS_DIR, '..', '..');   // unimate/tools -> repo root
const LAB_PATH = '/unimate/interactive.html';
// Renders land outside the repo on purpose: every file under assets/** is
// referenced by a page, so a stray clip in there reads as a mistake.
const DEFAULT_OUT_DIR = join(homedir(), 'Downloads', 'lab_renders');

// ── Options ──────────────────────────────────────────────────────────────────

const USAGE = `
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
  --chrome-ui            Keep the lab's chrome (panel, toolbars). Off by default,
                         which also re-centres the stage the panel shifts aside.
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

function parseArgs(argv) {
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

function fail(message) {
  console.error(`render-category: ${message}`);
  process.exit(1);
}

const slugify = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ── Static server ────────────────────────────────────────────────────────────
// The lab is ES modules fetching .glb over HTTP, so file:// is not an option.
// Serves the repo root read-only on the loopback interface.

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.fbx': 'application/octet-stream',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
};

async function serveRepo() {
  const server = createServer(async (req, res) => {
    // Strip the ?v= cache-buster and the hash before touching the disk.
    const url = new URL(req.url, 'http://127.0.0.1');
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel.endsWith('/')) rel += 'index.html';
    const file = join(REPO_ROOT, rel);
    if (!file.startsWith(REPO_ROOT)) { res.writeHead(403).end(); return; }
    try {
      const info = await stat(file);
      if (info.isDirectory()) { res.writeHead(403).end(); return; }
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'content-length': info.size,
        'cache-control': 'no-store',
      });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// ── Chrome + CDP ─────────────────────────────────────────────────────────────

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

async function launchChrome(opts) {
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

// Minimal CDP client. One socket, id-matched replies, flat sessions.
class CDP {
  static async connect(url) {
    const ws = new WebSocket(url);
    await once(ws, 'open');
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(`${msg.error.message} (${p.method})`)) : p.resolve(msg.result);
      } else {
        for (const fn of this.listeners.get(msg.method) || []) fn(msg.params, msg.sessionId);
      }
    });
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('DevTools socket closed'));
      this.pending.clear();
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
    });
  }
}

// ── The page-side bootstrap ──────────────────────────────────────────────────
// Runs before any of the lab's own scripts, in every document.

function bootstrapSource(config, zoom) {
  return `(() => {
  const CONFIG = ${JSON.stringify(config)};
  const ZOOM = ${zoom};

  // Keep the WebGL back buffer readable after the compositor paints, or a
  // screenshot taken between render ticks returns a black canvas.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (typeof type === 'string' && type.indexOf('webgl') === 0) {
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    }
    return getContext.call(this, type, attrs);
  };

  // interactive.js assigns the whole config object, so the overrides are folded
  // in as it lands rather than written before or after it.
  let cfg;
  Object.defineProperty(window, 'UNIMATE_VIEWER_CONFIG', {
    configurable: true,
    get: () => cfg,
    set: (value) => {
      cfg = Object.assign(value || {}, CONFIG);
      // Zoom divides the GLOBAL padding and leaves the per-category multipliers
      // alone, so every stage keeps the relative framing the lab gave it.
      if (ZOOM !== 1) {
        cfg.cameraPadding = (cfg.cameraPadding || 1) / ZOOM;
        cfg.mobileCameraPadding = (cfg.mobileCameraPadding || 1) / ZOOM;
      }
    },
  });

  // Reaching the live scene. three dispatches every Scene and WebGLRenderer it
  // constructs to window.__THREE_DEVTOOLS__ when that object exists, and
  // defining it here — before any module loads — is the only way in: the viewer
  // exports nothing, and WebGLRenderer.render is an OWN property of each
  // instance, so patching the prototype from outside silently does nothing.
  const scenes = [];
  const renderers = [];
  const devtools = new EventTarget();
  devtools.addEventListener('observe', (event) => {
    const target = event.detail;
    if (!target) return;
    if (target.isScene) scenes.push(target);
    else if (target.isWebGLRenderer) renderers.push(target);
  });
  window.__THREE_DEVTOOLS__ = devtools;

  // Which rigs this stage pulled. The catalog is not exported to the page, so
  // the fetches are the reliable list — and the driver reads the clip lengths
  // off those files to decide how long the video runs.
  const assets = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\\.(glb|gltf|fbx)(\\?|$)/i.test(url) && assets.indexOf(url) < 0) assets.push(url);
    return realFetch(input, init);
  };

  // Virtual clock. Passthrough until begin(): the stage loads, compiles and
  // frames itself in real time, and only the capture runs on stepped time.
  const realRAF = window.requestAnimationFrame.bind(window);
  const realCAF = window.cancelAnimationFrame.bind(window);
  const realPerfNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const epoch = realDateNow() - realPerfNow();
  let virtual = null;
  let nextId = 1 << 24;          // far from any id the real rAF hands out
  let queue = new Map();

  window.requestAnimationFrame = (cb) => {
    if (virtual === null) return realRAF(cb);
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => { if (!queue.delete(id)) realCAF(id); };
  performance.now = () => (virtual === null ? realPerfNow() : virtual);
  Date.now = () => (virtual === null ? realDateNow() : Math.round(epoch + virtual));

  window.__labCapture = {
    assets: () => assets.slice(),
    // Repaint what is behind the stage; null clears to transparent instead. The
    // Color constructor is borrowed off the background already there, since the
    // module itself is out of reach from here. Returns the number of scenes
    // repainted, or -1 if the way in stopped working — never silence.
    setBackground(css) {
      if (!scenes.length) return 0;
      for (const scene of scenes) {
        if (css === null) { scene.background = null; continue; }
        const Color = scene.background && scene.background.isColor ? scene.background.constructor : null;
        if (!Color) return -1;
        scene.background = new Color(css);
      }
      if (css === null) for (const renderer of renderers) renderer.setClearAlpha(0);
      return scenes.length;
    },
    // Start from the real clock's current value so the first delta is ~0 rather
    // than a jump the mixers would swallow as one huge step.
    begin() { if (virtual === null) virtual = realPerfNow(); },
    // Callbacks waiting on the virtual clock. Zero right after begin() only
    // means the loop's real rAF has not come back around yet — the driver waits
    // on this before stepping, or the first frames step an empty queue.
    pending() { return queue.size; },
    // Advance one frame and run everything waiting on it. The return value is
    // how many callbacks re-registered: 0 means the render loop stopped.
    step(ms) {
      virtual += ms;
      const due = queue;
      queue = new Map();
      for (const cb of due.values()) { try { cb(virtual); } catch (e) { console.error(e); } }
      return queue.size;
    },
  };
})();`;
}

// ── Clip length ──────────────────────────────────────────────────────────────
// How long one pass of a rig's motion is, read straight out of the .glb: the
// JSON chunk carries every animation sampler's input accessor, and an input
// accessor's `max` is its last keyframe time. Only the header and that chunk are
// read, so a 40 MB rig costs a few hundred bytes.

async function glbClipSeconds(file) {
  const { open } = await import('node:fs/promises');
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

// ── Frame sink ───────────────────────────────────────────────────────────────
// ffmpeg reads the frames off stdin; nothing touches the disk unless asked.

function ffmpegArgs(opts, out, size, alpha) {
  const ext = extname(out).toLowerCase();
  const input = ['-f', 'image2pipe', '-framerate', String(opts.fps), '-i', 'pipe:0'];
  const needsAlpha = (kind) => {
    if (alpha) fail(`--background transparent needs a format that keeps the alpha channel — ${kind} does not.`
      + ' Use .mov (ProRes 4444) or a .png sequence.');
  };

  // Two things happen in this one filter, and both are why an untagged encode
  // comes back soft and off-colour:
  //   · the supersampled frames are filtered down with lanczos, which is the
  //     resolution the thin skeleton lines actually need;
  //   · the RGB screenshots are converted to Rec.709 limited-range explicitly.
  //     ffmpeg otherwise picks BT.601 coefficients and leaves the stream
  //     untagged, while every player assumes 709 — that mismatch IS the colour
  //     shift, greens and the terracotta chips drifting against the browser.
  const scale = `scale=${size.width}:${size.height}:flags=lanczos`;
  // setparams, not the -color_* output options alone: the filter chain hands
  // ffmpeg frames whose primaries and transfer are "unspecified", and frame
  // metadata wins — the stream ends up tagged bt709/unknown/unknown, which is
  // the half-tagged state QuickTime guesses its way through.
  // `format` comes AFTER scale on purpose: filter negotiation makes scale itself
  // produce that pixel format, so the colour options above are what performs the
  // conversion. A format filter placed elsewhere would redo it on its own terms.
  const toRec709 = (pixelFormat) =>
    `${scale}:in_range=full:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,`
    + `format=${pixelFormat},setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
  const tags = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

  if (ext === '.mp4') {
    needsAlpha('h264 in .mp4');
    return [...input, '-vf', toRec709('yuv420p'), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(opts.crf),
      '-pix_fmt', 'yuv420p', ...tags, '-movflags', '+faststart', '-y', out];
  }
  if (ext === '.webm') {
    // libvpx-vp9 advertises yuva420p, but this build drops the alpha plane
    // without a word — the file decodes back as plain yuv420p. Refuse instead of
    // handing over an opaque render that was asked to be transparent.
    needsAlpha('libvpx-vp9 in .webm (it drops the alpha plane silently)');
    return [...input, '-vf', toRec709('yuv420p'), '-c:v', 'libvpx-vp9', '-crf', String(opts.crf), '-b:v', '0',
      '-pix_fmt', 'yuv420p', '-row-mt', '1', ...tags, '-y', out];
  }
  if (ext === '.mov') {
    // ProRes 4444 is the alpha format an editor actually takes; 422 HQ otherwise.
    const pix = alpha ? 'yuva444p10le' : 'yuv422p10le';
    return [...input, '-vf', toRec709(pix), '-c:v', 'prores_ks', '-profile:v', alpha ? '4444' : '3',
      '-pix_fmt', pix, ...(alpha ? ['-alpha_bits', '16'] : []), '-vendor', 'apl0', ...tags, '-y', out];
  }
  if (ext === '.gif') {
    needsAlpha('gif');
    // Stays in RGB, so no colour conversion — but a rig against a flat backdrop
    // banners badly on the default 216-colour web palette, hence a per-clip one.
    return [...input, '-vf', `${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`,
      '-loop', '0', '-y', out];
  }
  fail(`unsupported output extension "${ext}" — use .mp4, .webm, .mov, .gif, or .png for a frame sequence`);
}

function startEncoder(opts, out, size, alpha) {
  const args = ffmpegArgs(opts, out, size, alpha);
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  ff.on('error', (err) => fail(`could not run ffmpeg (${err.code}). Install it, or pass a .png output for a frame sequence.`));
  return ff;
}

// ── Drive ────────────────────────────────────────────────────────────────────

async function evalIn(cdp, session, expression, awaitPromise = false) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise,
  }, session);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function waitUntil(fn, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const transparentBackground = !!opts.background && opts.background.trim().toLowerCase() === 'transparent';
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
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: opts.width, height: opts.height, deviceScaleFactor: opts.scale, mobile: false,
    }, sessionId);

    // Surface page errors: a broken module here is otherwise a silent 10s of
    // black frames.
    cdp.on('Runtime.exceptionThrown', (p) => {
      console.error('page error:', p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
    });

    const viewerConfig = {
      // With the chrome hidden the panel is gone, so the stage's clearance for
      // it has to go too or the subject sits off-centre in the frame.
      ...(opts.chromeUi ? {} : { horizontalSafeArea: 0 }),
      ...(opts.labels ? { hoverPrompts: false } : {}),
      ...(opts.orbit ? {} : { autoOrbitControls: false, initialOrbitAngle: 0 }),
    };
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: bootstrapSource(viewerConfig, opts.zoom),
    }, sessionId);

    // ── Load the lab ─────────────────────────────────────────────────────────
    const slug = opts.category ? slugify(opts.category) : '';
    const url = `${origin}${LAB_PATH}${slug ? '#' + slug : ''}`;
    process.stderr.write(`serving ${REPO_ROOT}\nopening ${url}\n`);
    await cdp.send('Page.navigate', { url }, sessionId);
    await waitUntil(async () => await evalIn(cdp, sessionId, 'document.readyState === "complete"'), 60_000, 'the page to load');
    await waitUntil(async () => await evalIn(cdp, sessionId, 'document.querySelectorAll("#example-sidebar button").length > 0'), 60_000, 'the category list');

    const stages = await evalIn(cdp, sessionId,
      '[...document.querySelectorAll("#example-sidebar .example-name")].map((el) => el.textContent)');

    if (opts.list) {
      console.log(stages.map((label) => `  ${label.padEnd(20)} ${slugify(label)}`).join('\n'));
      return;
    }

    // The hash resolves by slug, and an unknown one silently falls back to the
    // first stage — which would render the wrong category without a word.
    const match = stages.find((label) => slugify(label) === slug);
    if (!match) {
      fail(`no category "${opts.category}". The lab currently shows:\n${stages.map((l) => `  ${l} (${slugify(l)})`).join('\n')}`);
    }

    if (opts.theme === 'light') {
      await evalIn(cdp, sessionId, `(() => {
        const t = document.querySelector('[data-theme-toggle]');
        if (t && document.documentElement.dataset.theme !== 'light') t.click();
      })()`);
    }

    process.stderr.write(`loading "${match}" — rigs, textures, camera fit\n`);
    await waitUntil(async () => await evalIn(cdp, sessionId, `(() => {
      const overlay = document.getElementById('loading-overlay');
      const canvas = document.querySelector('#viewer-wrapper canvas');
      return !!canvas && !!overlay && getComputedStyle(overlay).display === 'none';
    })()`), 180_000, 'the stage to finish loading');

    // ── Backdrop ─────────────────────────────────────────────────────────────
    // Only what is behind the stage: the floor, lights and skeleton stay on the
    // theme. The page's own background matters too — with a transparent canvas
    // it is what shows through.
    const applyBackground = async () => {
      if (!opts.background) return;
      const css = transparentBackground ? null : opts.background;
      const painted = await evalIn(cdp, sessionId,
        `window.__labCapture.setBackground(${JSON.stringify(css)})`);
      if (painted === 0) fail('could not reach the scene to set --background (no scene was observed)');
      if (painted < 0) fail(`could not read a colour from "${opts.background}" — is it a valid CSS colour?`);
      // The canvas is not the only thing painting: `body` carries a gradient and
      // `.viewer-wrapper` its own `--stage` fill, so an inline style on body
      // leaves the wrapper opaque underneath a cleared canvas.
      const pageBackground = transparentBackground ? 'transparent' : opts.background;
      await evalIn(cdp, sessionId, `(() => {
        const id = 'lab-capture-background';
        const style = document.getElementById(id) || document.createElement('style');
        style.id = id;
        style.textContent = 'html,body,.lab-shell,.viewer-panel,.viewer-layout,.viewer-wrapper'
          + '{background: ' + ${JSON.stringify(pageBackground)} + ' !important}';
        document.head.appendChild(style);
      })()`);
    };
    await applyBackground();
    if (transparentBackground) {
      // Chrome composites the page over its own opaque white unless told not to,
      // which would fill the alpha the canvas just cleared.
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      }, sessionId);
    }

    // Chrome off AFTER the wait above, which reads the loading overlay.
    if (!opts.chromeUi) {
      await evalIn(cdp, sessionId, `(() => {
        const style = document.createElement('style');
        style.textContent = '.category-panel,.panel-toggle,.control-bar,.control-dock,.drop-note,#drop-hint,#loading-overlay{display:none !important}';
        document.head.appendChild(style);
      })()`);
    }

    // ── How long the video runs ──────────────────────────────────────────────
    // Every rig in the stage loops on its own clip, so the video is as long as
    // the LONGEST one times --loops: the longest rig gets exactly that many
    // passes and the shorter ones more, and no rig is ever cut mid-motion.
    const assets = await evalIn(cdp, sessionId, 'window.__labCapture.assets()');
    const clips = [];
    for (const asset of assets) {
      const file = join(REPO_ROOT, new URL(asset, origin).pathname);
      if (extname(file).toLowerCase() === '.glb') clips.push(await glbClipSeconds(file));
    }
    const longest = Math.max(0, ...clips);
    let seconds = opts.seconds;
    if (seconds == null) {
      if (longest > 0) {
        seconds = longest * opts.loops;
        process.stderr.write(`${clips.length} rigs, longest clip ${longest.toFixed(2)}s`
          + ` x ${opts.loops} loops = ${seconds.toFixed(2)}s\n`);
      } else {
        seconds = 2 * opts.loops;
        console.error(`warning: no clip length found in the rigs — falling back to 2s x ${opts.loops} loops`);
      }
    }

    // Real time, so first-frame shader compiles and the camera's damped fit are
    // spent before the clock freezes.
    await new Promise((r) => setTimeout(r, opts.warmup));

    // ── Capture ──────────────────────────────────────────────────────────────
    const sequence = opts.out && extname(opts.out).toLowerCase() === '.png';
    const out = opts.out
      ? resolve(process.cwd(), opts.out)
      : join(DEFAULT_OUT_DIR, `${slug}.mp4`);
    await mkdir(sequence ? out : dirname(out), { recursive: true });
    if (opts.keepFrames) await mkdir(resolve(process.cwd(), opts.keepFrames), { recursive: true });

    // yuv420p halves both axes, so an odd dimension is a hard encoder error.
    const even = (n) => Math.max(2, Math.round(n / 2) * 2);
    const captured = { width: even(opts.width * opts.scale), height: even(opts.height * opts.scale) };
    const size = opts.downsample ? { width: even(opts.width), height: even(opts.height) } : captured;

    const total = Math.max(1, Math.round(seconds * opts.fps));
    const frameMs = 1000 / opts.fps;
    // JPEG has no alpha, so a transparent render captured as JPEG is just a
    // black backdrop — the one option that silently undoes the request.
    if (transparentBackground && opts.jpeg) {
      console.error('warning: --jpeg carries no alpha — capturing PNG frames instead');
    }
    const format = opts.jpeg && !transparentBackground ? 'jpeg' : 'png';
    const encoder = sequence ? null : startEncoder(opts, out, size, transparentBackground);
    const { writeFile } = await import('node:fs/promises');

    const resampled = size.width !== captured.width ? ` → ${size.width}x${size.height}` : '';
    process.stderr.write(`capturing ${total} frames at ${opts.fps} fps `
      + `(${captured.width}x${captured.height}${resampled})\n`);

    await evalIn(cdp, sessionId, 'window.__labCapture.begin()');
    // The render loop hands itself over one real frame after the clock flips;
    // stepping before that lands on an empty queue and burns frames.
    await waitUntil(async () => await evalIn(cdp, sessionId, 'window.__labCapture.pending() > 0'),
      10_000, 'the render loop to join the virtual clock');

    // Frame 0 is the stage as the lab first shows it — opening orbit angle, every
    // motion at t=0 — and the way to get there is to load it again now that the
    // clock is virtual. Loading runs on fetch and promises, not on frames, so it
    // completes while time is frozen: no mixer advances and the camera does not
    // orbit between the fit and the first captured frame. (Resetting in place
    // cannot do this — nothing rewinds a running mixer.)
    const stageIndex = stages.indexOf(match);
    await evalIn(cdp, sessionId, `document.querySelectorAll('#example-sidebar button')[${stageIndex}].click()`);
    // The INLINE style, not the computed one: hiding the chrome put a
    // `display: none !important` on the overlay, so computed says "hidden" from
    // the first poll. loadStage writes 'flex' then 'none' on the element itself.
    await waitUntil(async () => await evalIn(cdp, sessionId,
      `document.getElementById('loading-overlay').style.display === 'none'`),
      180_000, 'the stage to reload on the virtual clock');
    await applyBackground();   // insurance: the reload must not repaint over it

    const started = Date.now();
    let stalled = false;
    for (let i = 0; i < total; i++) {
      const queued = await evalIn(cdp, sessionId, `window.__labCapture.step(${frameMs})`);
      if (!queued && !stalled) {
        stalled = true;
        console.error('warning: nothing re-registered a frame callback — the render loop may have stopped');
      }
      const shot = await cdp.send('Page.captureScreenshot', {
        format, ...(opts.jpeg ? { quality: 95 } : {}), fromSurface: true, captureBeyondViewport: false,
      }, sessionId);
      const buf = Buffer.from(shot.data, 'base64');
      const name = `frame-${String(i).padStart(5, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      if (opts.keepFrames) await writeFile(join(resolve(process.cwd(), opts.keepFrames), name), buf);
      if (sequence) {
        await writeFile(join(out, name), buf);
      } else if (!encoder.stdin.write(buf)) {
        await once(encoder.stdin, 'drain');
      }
      if (i % opts.fps === 0 || i === total - 1) {
        const done = i + 1;
        const rate = done / ((Date.now() - started) / 1000);
        const left = Math.round((total - done) / Math.max(rate, 0.01));
        process.stderr.write(`\r  ${done}/${total} frames · ${rate.toFixed(1)} fps · ~${left}s left    `);
      }
    }
    process.stderr.write('\n');

    if (encoder) {
      encoder.stdin.end();
      const [code] = await once(encoder, 'exit');
      if (code !== 0) fail(`ffmpeg exited with ${code}`);
    }
    process.stderr.write(`wrote ${out} — ${(total / opts.fps).toFixed(1)}s of "${match}"\n`);
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(`render-category: ${err.stack || err.message}`);
  process.exit(1);
});
