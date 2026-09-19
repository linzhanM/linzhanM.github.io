// The paper's rendering self-supervision, run on the lab's street: rays from
// the ego camera through the SDF, NeuS weights along each ray (Appendix B.5,
// eq. 13), rendered depth d = Σ wᵢdᵢ and flow f = Σ wᵢfᵢ (eq. 14), the optical
// flow they imply between frames t and t+1, the static flow that the depth and
// ego motion alone imply, and their difference — the dynamic flow of eq. 10.

import {
  VOX, EGO, LABEL, egoZ, agentStates, agentSDF, sampleSDF, labelAt,
} from './scene.js?v=1';

// nuScenes' CAM_FRONT as the lab draws it: 1600 px wide, a 70° horizontal
// field, and flow between keyframes 0.5 s apart (2 Hz, as the paper supervises
// nuScenes).
export const CAMERA = { width: 1600, hfov: 70, dt: 0.5, far: 80 };

const scratch = { d: 0, who: -1 };

export function cameraAt(t) {
  return { x: EGO.x, y: EGO.camHeight, z: egoZ(t) };
}

const focal = (W) => (W / 2) / Math.tan((CAMERA.hfov * Math.PI) / 360);

// Looking down +z with y up puts the camera's right along −x.
function project(px, py, pz, cam, W, H, out) {
  const fx = focal(W);
  const xc = -(px - cam.x), yc = py - cam.y, zc = pz - cam.z;
  out[0] = W / 2 + (fx * xc) / zc;
  out[1] = H / 2 - (fx * yc) / zc;
  return out;
}

export function rayDirection(u, v, W, H, out) {
  const fx = focal(W);
  const x = -(u - W / 2) / fx, y = -(v - H / 2) / fx, len = Math.hypot(x, y, 1);
  out[0] = x / len; out[1] = y / len; out[2] = 1 / len;
  return out;
}

export function sceneSDF(sdf, boxes, x, y, z, out) {
  const s = sampleSDF(sdf, x, y, z);
  agentSDF(boxes, x, y, z, scratch);
  if (scratch.d < s) { out.d = scratch.d; out.who = scratch.who; } else { out.d = s; out.who = -1; }
  return out;
}

// The boxes a ray can reach: a slab test against each box grown by `pad`.
// A box the ray misses cannot stop the sphere trace, so leaving it out changes
// no hit — only far-away distance values, which the render never reads.
const culled = new Float32Array(7 * 256);
function boxesOnRay(packed, cam, dir, pad) {
  let n = 0;
  for (let o = 0; o < packed.length; o += 7) {
    let t0 = 0, t1 = CAMERA.far;
    for (let a = 0; a < 3; a++) {
      const origin = a === 0 ? cam.x : a === 1 ? cam.y : cam.z;
      const lo = packed[o + a] - packed[o + 3 + a] - pad, hi = packed[o + a] + packed[o + 3 + a] + pad;
      if (Math.abs(dir[a]) < 1e-9) { if (origin < lo || origin > hi) { t0 = 1; t1 = 0; } continue; }
      let ta = (lo - origin) / dir[a], tb = (hi - origin) / dir[a];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
    }
    if (t0 <= t1) { culled.set(packed.subarray(o, o + 7), n); n += 7; }
  }
  return culled.subarray(0, n);
}

const sigmoid = (x, xi) => 1 / (1 + Math.exp(-xi * x));

// NeuS weights over one run of samples: αᵢ = max((Φ(sᵢ) − Φ(sᵢ₊₁)) / Φ(sᵢ), 0),
// wᵢ = αᵢ Πⱼ<ᵢ (1 − αⱼ). Writes the weights into `ws`.
function composite(ts, ss, fsx, fsz, n, xi, ws, result) {
  let T = 1, d = 0, fx = 0, fz = 0, sum = 0;
  for (let i = 0; i < n; i++) {
    const a = sigmoid(ss[i], xi), b = sigmoid(ss[i + 1], xi);
    const alpha = a > 1e-6 ? Math.max((a - b) / a, 0) : 0;
    const w = T * alpha;
    ws[i] = w;
    d += w * ts[i]; fx += w * fsx[i]; fz += w * fsz[i]; sum += w;
    T *= 1 - alpha;
  }
  result.d = d; result.fx = fx; result.fz = fz; result.sum = sum;
  return result;
}

// Sphere-trace to the first surface; NaN when the ray leaves for the sky.
function firstHit(sdf, boxes, cam, dir) {
  let t = 0.3;
  for (let it = 0; it < 200; it++) {
    const s = sceneSDF(sdf, boxes, cam.x + dir[0] * t, cam.y + dir[1] * t, cam.z + dir[2] * t, scratch).d;
    if (s < 0.01 + t * 0.0015) return t;
    // A floor on the step that grows with distance: a ray grazing the road
    // would otherwise creep along it. The window below re-samples the hit.
    t += Math.max(s * 0.95, 0.03 + t * 0.006);
    if (t > CAMERA.far) return NaN;
  }
  return NaN;
}

// Rendering near the hit is enough: far from a surface the SDF is large and
// every α is zero. 28 samples at 0.15 m from 2.4 m in front of it.
const WINDOW = { before: 2.4, step: 0.15, count: 28 };
const buf = {
  ts: new Float32Array(601), ss: new Float32Array(601), fx: new Float32Array(601),
  fz: new Float32Array(601), ws: new Float32Array(601), who: new Int8Array(601),
};

function sampleRun(sdf, boxes, states, cam, dir, t0, step, count) {
  for (let i = 0; i <= count; i++) {
    const t = t0 + i * step;
    const hit = sceneSDF(sdf, boxes, cam.x + dir[0] * t, cam.y + dir[1] * t, cam.z + dir[2] * t, scratch);
    buf.ts[i] = t;
    buf.ss[i] = hit.d;
    buf.who[i] = hit.who;
    // The flow field: an agent's velocity inside it and within half a voxel of
    // its skin, zero elsewhere (the static world does not move).
    const s = hit.who >= 0 && hit.d < VOX * 0.5 ? states[hit.who] : null;
    buf.fx[i] = s ? s.vx : 0;
    buf.fz[i] = s ? s.vz : 0;
  }
}

// Every pixel of the camera pane at time t. Returns typed arrays the colour
// maps and the disentanglement read.
export function renderFrame(sdf, labels, t, W, H, xi, frame) {
  const n = W * H;
  if (!frame || frame.W !== W || frame.H !== H) {
    frame = {
      W, H,
      depth: new Float32Array(n), hitY: new Float32Array(n), shade: new Float32Array(n),
      label: new Uint8Array(n), who: new Int8Array(n),
      flow: new Float32Array(n * 2), stat: new Float32Array(n * 2),
    };
  }
  const states = agentStates(t);
  const cam = cameraAt(t);
  const next = { x: cam.x, y: cam.y, z: cam.z + EGO.speed * CAMERA.dt };
  const dir = [0, 0, 0], p = [0, 0], q = [0, 0], res = {};
  const toImage = CAMERA.width / W;   // pane pixels to the 1600 px image
  for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) {
    const idx = v * W + u;
    rayDirection(u + 0.5, v + 0.5, W, H, dir);
    const boxes = boxesOnRay(states.packed, cam, dir, 0.05);
    const tHit = firstHit(sdf, boxes, cam, dir);
    if (Number.isNaN(tHit)) {
      frame.depth[idx] = NaN;
      frame.who[idx] = -1;
      frame.label[idx] = 0;
      frame.flow[idx * 2] = frame.flow[idx * 2 + 1] = 0;
      frame.stat[idx * 2] = frame.stat[idx * 2 + 1] = 0;
      continue;
    }
    const t0 = Math.max(0.3, tHit - WINDOW.before);
    sampleRun(sdf, boxes, states, cam, dir, t0, WINDOW.step, WINDOW.count);
    composite(buf.ts, buf.ss, buf.fx, buf.fz, WINDOW.count, xi, buf.ws, res);
    const ok = res.sum > 0.05;
    const d = ok ? res.d / res.sum : tHit;
    const fX = ok ? res.fx / res.sum : 0, fZ = ok ? res.fz / res.sum : 0;
    const px = cam.x + dir[0] * d, py = cam.y + dir[1] * d, pz = cam.z + dir[2] * d;
    frame.depth[idx] = d;
    frame.hitY[idx] = py;

    // Surface normal from the SDF's gradient, for shading.
    const hx = cam.x + dir[0] * tHit, hy = cam.y + dir[1] * tHit, hz = cam.z + dir[2] * tHit, e = 0.08;
    const g = (ax, ay, az) => sceneSDF(sdf, boxes, hx + ax, hy + ay, hz + az, scratch).d;
    const gx = g(e, 0, 0) - g(-e, 0, 0), gy = g(0, e, 0) - g(0, -e, 0), gz = g(0, 0, e) - g(0, 0, -e);
    const gl = Math.hypot(gx, gy, gz) || 1;
    frame.shade[idx] = Math.max(0, (-gx * 0.35 + gy * 0.8 - gz * 0.45) / gl);

    const hit = sceneSDF(sdf, boxes, hx, hy, hz, scratch);
    frame.who[idx] = hit.who >= 0 && hit.d <= sampleSDF(sdf, hx, hy, hz) ? hit.who : -1;
    frame.label[idx] = frame.who[idx] >= 0 ? 0 : labelAt(labels, hx - (gx / gl) * 0.12, hy - (gy / gl) * 0.12, hz - (gz / gl) * 0.12);

    // Eq. 9's target: where the point lands in the next keyframe, the camera
    // having moved on by the ego motion and the point by its flow.
    project(px, py, pz, cam, W, H, p);
    project(px + fX * CAMERA.dt, py, pz + fZ * CAMERA.dt, next, W, H, q);
    frame.flow[idx * 2] = (q[0] - p[0]) * toImage;
    frame.flow[idx * 2 + 1] = (q[1] - p[1]) * toImage;
    // Eq. 10's static flow: the same point, held still.
    project(px, py, pz, next, W, H, q);
    frame.stat[idx * 2] = (q[0] - p[0]) * toImage;
    frame.stat[idx * 2 + 1] = (q[1] - p[1]) * toImage;
  }
  frame.t = t;
  return frame;
}

// One ray in full, for the inspector: 600 samples from the camera out to the
// far plane, with the SDF, α, weight and flow at each.
export function inspectRay(sdf, t, u, v, W, H, xi) {
  const states = agentStates(t);
  const cam = cameraAt(t);
  const dir = rayDirection(u, v, W, H, [0, 0, 0]);
  const count = 600, step = (CAMERA.far - 0.3) / count;
  sampleRun(sdf, states.packed, states, cam, dir, 0.3, step, count);
  const res = composite(buf.ts, buf.ss, buf.fx, buf.fz, count, xi, buf.ws, {});
  let lead = 0;
  for (let i = 1; i < count; i++) if (buf.ws[i] > buf.ws[lead]) lead = i;
  const who = res.sum > 0.05 ? buf.who[lead] : -1;
  return {
    cam, dir, count, step,
    ts: buf.ts.slice(0, count), ss: buf.ss.slice(0, count), ws: buf.ws.slice(0, count),
    d: res.sum > 0.05 ? res.d / res.sum : NaN, sum: res.sum, fx: res.fx, fz: res.fz,
    who: who >= 0 && buf.ss[lead] < 0.3 ? who : -1,
  };
}

// ── Colour maps ──────────────────────────────────────────────────────────────
const lerp = (a, b, u) => a + (b - a) * u;
function ramp(stops, u, out) {
  u = Math.min(1, Math.max(0, u));
  for (let i = 1; i < stops.length; i++) {
    if (u <= stops[i][0] || i === stops.length - 1) {
      const [u0, c0] = stops[i - 1], [u1, c1] = stops[i];
      const f = Math.min(1, Math.max(0, (u - u0) / (u1 - u0 || 1)));
      out[0] = lerp(c0[0], c1[0], f); out[1] = lerp(c0[1], c1[1], f); out[2] = lerp(c0[2], c1[2], f);
      return out;
    }
  }
  return out;
}
export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// The paper's depth maps: magma, near bright.
const MAGMA = [[0, '#000004'], [0.2, '#2c115f'], [0.42, '#721f81'], [0.62, '#b73779'], [0.8, '#f1605d'], [0.92, '#feb078'], [1, '#fcfdbf']].map(([u, c]) => [u, hex(c)]);
// The stage's height ramp, after Tesla's occupancy renders: dark ground,
// indigo walls whitening to the top. Pavements (0.4 m) stay near the ground's
// grey; white is kept for the roofline. viewer.js's shader takes these stops
// as uniforms and interactive.css's .legend-ramp repeats them as a gradient —
// change all three together.
export const HEIGHT_STOPS = [[-0.4, '#3C3D3A'], [0.2, '#403F3C'], [0.8, '#3B2F90'], [1.8, '#5E50C8'], [3.2, '#8E83DC'], [4.6, '#C7C1EF'], [5.2, '#F4F2FC']];
const HEIGHT = HEIGHT_STOPS.map(([y, c]) => [(y + 0.4) / 5.6, hex(c)]);
export const heightColor = (y, out = [0, 0, 0]) => ramp(HEIGHT, (y + 0.4) / 5.6, out);
// Inverse depth from the far plane (black) to 5 m (white).
export const depthColor = (d, out = [0, 0, 0]) => ramp(MAGMA, Math.pow((1 / d - 1 / CAMERA.far) / (1 / 5 - 1 / CAMERA.far), 0.45), out);

// Optical flow in the usual colour wheel: hue is direction, saturation is
// magnitude against `scale` px, white is no motion.
export function flowColor(du, dv, scale, out = [0, 0, 0]) {
  const m = Math.min(1, Math.hypot(du, dv) / scale);
  const h = ((Math.atan2(-dv, -du) / Math.PI + 1) * 3) % 6;
  const i = Math.floor(h), f = h - i;
  const rgb = [[1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]][i];
  out[0] = 255 * (1 - m * (1 - rgb[0])); out[1] = 255 * (1 - m * (1 - rgb[1])); out[2] = 255 * (1 - m * (1 - rgb[2]));
  return out;
}

// The input image: flat paint per class under the SDF normal, a sky above.
const PAINT = {
  [LABEL.ROAD]: '#6B6E70', [LABEL.MARKING]: '#E9E7DF', [LABEL.SIDEWALK]: '#B6B0A4', [LABEL.GRASS]: '#7D9A55',
  [LABEL.BUILDING]: '#CDB08F', [LABEL.WALL2]: '#B9B6AE', [LABEL.WALL3]: '#A5623E', [LABEL.ROOF]: '#6E4A3A',
  [LABEL.GLASS]: '#3C4A57', [LABEL.AWNING]: '#2F7F74', [LABEL.HEDGE]: '#476F38', [LABEL.FURNITURE]: '#4A4F55',
  [LABEL.TRUNK]: '#5A4632', [LABEL.CANOPY]: '#557E3C', [LABEL.CONIFER]: '#2F5A3A', [LABEL.POLE]: '#8A8F94',
  [LABEL.SIGN]: '#2E62B8', [LABEL.LIGHT]: '#26292D',
};
const PAINT_RGB = Object.fromEntries(Object.entries(PAINT).map(([k, v]) => [k, hex(v)]));
const AGENT_RGB = new Map();

// Paint the pane for one mode into an ImageData. Returns the disentanglement's
// counts for the panel.
export function paintFrame(frame, mode, image, opts) {
  const { W, H } = frame, data = image.data, c = [0, 0, 0];
  // Full colour at 60 px: 0.5 s of ego motion moves the street by tens of
  // pixels at the image's edges and a few straight ahead.
  const tau = opts.tau, scale = 60;
  let movable = 0, dynamic = 0, rays = 0;
  for (let idx = 0; idx < W * H; idx++) {
    const v = Math.floor(idx / W), d = frame.depth[idx], hit = !Number.isNaN(d);
    const du = frame.flow[idx * 2], dv = frame.flow[idx * 2 + 1];
    const su = frame.stat[idx * 2], sv = frame.stat[idx * 2 + 1];
    const isMovable = frame.who[idx] >= 0;
    const isDynamic = isMovable && Math.hypot(du - su, dv - sv) > tau;
    if (hit) { rays++; if (isMovable) movable++; if (isDynamic) dynamic++; }

    if (mode === 'depth') {
      if (hit) depthColor(d, c); else { c[0] = 0; c[1] = 0; c[2] = 4; }
    } else if (mode === 'flow') {
      flowColor(du, dv, scale, c);
    } else if (mode === 'static') {
      flowColor(su, sv, scale, c);
    } else if (mode === 'occupancy') {
      if (hit) {
        heightColor(frame.hitY[idx], c);
        const k = 0.6 + 0.45 * frame.shade[idx];
        c[0] *= k; c[1] *= k; c[2] *= k;
      } else { c[0] = 46; c[1] = 47; c[2] = 50; }
    } else {
      imageColor(frame, idx, v, H, opts.agents, c);
      if (mode === 'dynamic') {
        const g = ((c[0] + c[1] + c[2]) / 3) * 0.42;
        if (isDynamic) { c[0] = 236; c[1] = 64; c[2] = 180; }
        else if (isMovable) { c[0] = c[1] = c[2] = g + 70; }
        else { c[0] = c[1] = c[2] = g; }
      }
    }
    const o = idx * 4;
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return { rays, movable, dynamic };
}

function imageColor(frame, idx, v, H, agents, c) {
  const d = frame.depth[idx];
  if (Number.isNaN(d)) {
    const u = v / (H * 0.5);
    c[0] = lerp(126, 212, u); c[1] = lerp(170, 226, u); c[2] = lerp(220, 238, u);
    return c;
  }
  const who = frame.who[idx];
  let base;
  if (who >= 0) {
    if (!AGENT_RGB.has(who)) AGENT_RGB.set(who, hex(agents[who].paint));
    base = AGENT_RGB.get(who);
  } else base = PAINT_RGB[frame.label[idx]] || PAINT_RGB[LABEL.BUILDING];
  const k = 0.55 + 0.5 * frame.shade[idx];
  const haze = Math.min(0.55, d / 130);
  c[0] = lerp(base[0] * k, 212, haze); c[1] = lerp(base[1] * k, 224, haze); c[2] = lerp(base[2] * k, 236, haze);
  return c;
}
