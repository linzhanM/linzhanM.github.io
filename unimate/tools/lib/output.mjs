// Where the pixels go: frame geometry, the ffmpeg command, and the sink the
// capture loop writes each frame to. Nothing here touches the disk except the
// output itself — ffmpeg reads the frames off stdin.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';

import { DEFAULT_OUT_DIR } from './paths.mjs';
import { fail } from './util.mjs';

// yuv420p halves both axes, so an odd dimension is a hard encoder error.
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// What Chrome paints versus what is written: the lab renders at --scale times
// the output size and the frames are filtered back down (see the lanczos pass
// below), unless --no-downsample keeps the captured pixels.
export function frameGeometry(opts) {
  const captured = { width: even(opts.width * opts.scale), height: even(opts.height * opts.scale) };
  const size = opts.downsample ? { width: even(opts.width), height: even(opts.height) } : captured;
  return { captured, size };
}

// JPEG has no alpha, so a transparent render captured as JPEG is just a black
// backdrop — the one option that silently undoes the request.
export function frameFormat(opts, alpha) {
  if (alpha && opts.jpeg) console.error('warning: --jpeg carries no alpha — capturing PNG frames instead');
  return opts.jpeg && !alpha ? 'jpeg' : 'png';
}

export const frameName = (i, format) => `frame-${String(i).padStart(5, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`;

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

// The capture loop hands every frame to this and knows nothing else about the
// destination: a .png output is a directory of numbered frames, anything else is
// an ffmpeg process fed on stdin. --keep-frames mirrors either one to disk.
export async function openSink(opts, { slug, size, alpha }) {
  const sequence = !!opts.out && extname(opts.out).toLowerCase() === '.png';
  const path = opts.out ? resolve(process.cwd(), opts.out) : join(DEFAULT_OUT_DIR, `${slug}.mp4`);
  await mkdir(sequence ? path : dirname(path), { recursive: true });

  const mirror = opts.keepFrames ? resolve(process.cwd(), opts.keepFrames) : null;
  if (mirror) await mkdir(mirror, { recursive: true });

  const encoder = sequence ? null : startEncoder(opts, path, size, alpha);

  return {
    path,
    sequence,
    async write(buffer, name) {
      if (mirror) await writeFile(join(mirror, name), buffer);
      if (sequence) {
        await writeFile(join(path, name), buffer);
      } else if (!encoder.stdin.write(buffer)) {
        await once(encoder.stdin, 'drain');
      }
    },
    async finish() {
      if (!encoder) return;
      encoder.stdin.end();
      const [code] = await once(encoder, 'exit');
      if (code !== 0) fail(`ffmpeg exited with ${code}`);
    },
  };
}
