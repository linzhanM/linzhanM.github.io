// The street the lab predicts over: a static voxel grid, its signed distance
// field, and the agents that move through it. Everything is procedural and
// seeded (mulberry32, seed 2407), so every visit sees the same street. The
// voxel is the paper's nuScenes 0.4 m (Appendix B.1); the grid is 80 m across,
// 6.4 m tall and 144 m long, and the paper's 80 × 80 × 6.4 m volume is the
// ±VOLUME.half window along z that rides with the ego car (viewer.js clips and
// fades the stage at its edges).

export const VOX = 0.4;
export const NX = 200, NY = 16, NZ = 360;            // x across, y up, z along the street
export const X0 = -40, Y0 = -1.2, Z0 = 0;            // world position of the grid's min corner
export const VOLUME = { half: 40, bottom: Y0, top: Y0 + NY * VOX };

// One loop of the stage. The ego car drives the right-hand lane through an
// intersection at a steady speed; the front camera rides 1.5 m up.
export const CYCLE = 12;
export const EGO = { x: -1.8, z0: 42, speed: 5, camHeight: 1.5 };
export const egoZ = (t) => EGO.z0 + EGO.speed * t;

export const LABEL = {
  EMPTY: 0, ROAD: 1, MARKING: 2, SIDEWALK: 3, GRASS: 4, BUILDING: 5, TRUNK: 6, CANOPY: 7, POLE: 8,
  SIGN: 9, WALL2: 10, WALL3: 11, ROOF: 12, GLASS: 13, AWNING: 14, HEDGE: 15, FURNITURE: 16, CONIFER: 17, LIGHT: 18,
};

// The cross street and the corners kept clear around it.
export const CROSS = { z0: 84, z1: 92, corner0: 78, corner1: 98 };

export const cellIndex = (i, k, j) => i + NX * (k + NY * j);
export const cellX = (i) => X0 + (i + 0.5) * VOX;
export const cellY = (k) => Y0 + (k + 0.5) * VOX;
export const cellZ = (j) => Z0 + (j + 0.5) * VOX;

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Static street ────────────────────────────────────────────────────────────
export function buildStatic() {
  const labels = new Uint8Array(NX * NY * NZ);
  const rng = mulberry32(2407);
  const R = (a, b) => a + rng() * (b - a);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const span = (lo, hi, origin, n) => [
    Math.max(0, Math.ceil((lo - origin) / VOX - 0.5)),
    Math.min(n - 1, Math.floor((hi - origin) / VOX - 0.5)),
  ];
  // Cells whose centres fall inside the box; label 0 carves.
  const box = (x0, x1, y0, y1, z0, z1, label) => {
    const [i0, i1] = span(Math.min(x0, x1), Math.max(x0, x1), X0, NX);
    const [k0, k1] = span(y0, y1, Y0, NY), [j0, j1] = span(z0, z1, Z0, NZ);
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) labels[cellIndex(i, k, j)] = label;
  };
  const ball = (x, y, z, r, label, squash = 1) => {
    const [i0, i1] = span(x - r, x + r, X0, NX), [k0, k1] = span(y - r * squash, y + r * squash, Y0, NY), [j0, j1] = span(z - r, z + r, Z0, NZ);
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const dx = cellX(i) - x, dy = (cellY(k) - y) / squash, dz = cellZ(j) - z;
      if (dx * dx + dy * dy + dz * dz <= r * r) labels[cellIndex(i, k, j)] = label;
    }
  };
  const disc = (x, y0, y1, z, r, label) => {
    const [i0, i1] = span(x - r, x + r, X0, NX), [k0, k1] = span(y0, y1, Y0, NY), [j0, j1] = span(z - r, z + r, Z0, NZ);
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const dx = cellX(i) - x, dz = cellZ(j) - z;
      if (dx * dx + dz * dz <= r * r) labels[cellIndex(i, k, j)] = label;
    }
  };
  const inCross = (z) => z >= CROSS.z0 && z < CROSS.z1;
  const inCorner = (z) => z >= CROSS.corner0 && z < CROSS.corner1;

  // Ground: three layers under y = 0. The road runs down the middle and across
  // at the intersection; kerbed pavements (one layer up) line both, grass
  // beyond. Paint only recolours the road's top cell.
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const x = cellX(i), ax = Math.abs(x), z = cellZ(j);
    const crossWalkway = (z >= CROSS.z0 - 2.4 && z < CROSS.z0) || (z >= CROSS.z1 && z < CROSS.z1 + 2.4);
    let label = LABEL.GRASS;
    if (ax < 7.2 || inCross(z)) label = LABEL.ROAD;
    else if (ax < 10.4 || (inCorner(z) && crossWalkway)) label = LABEL.SIDEWALK;
    for (let k = 0; k < 3; k++) labels[cellIndex(i, k, j)] = label;
    if (label === LABEL.SIDEWALK) labels[cellIndex(i, 3, j)] = LABEL.SIDEWALK;
    if (label !== LABEL.ROAD) continue;
    const zebra = ((z >= 80 && z < 83.6) || (z >= 92.4 && z < 96)) && ax < 7.2 && i % 2 === 0;
    const zebraCross = inCross(z) && ax >= 7.6 && ax < 10 && j % 2 === 0;
    const centre = i === 100 && !inCorner(z) && Math.floor(z / 3) % 2 === 0;
    const crossCentre = j === 220 && ax > 10.4 && Math.floor(x / 3) % 2 === 0;
    const stop = (z >= 78.4 && z < 78.8 && x < 0 && x > -7.2) || (z >= 97.2 && z < 97.6 && x > 0 && x < 7.2);
    if (zebra || zebraCross || centre || crossCentre || stop) labels[cellIndex(i, 2, j)] = LABEL.MARKING;
  }

  // Buildings. Each lot is one of four kinds, all facing the street:
  // a gabled house behind a hedge, an apartment block with recessed windows and
  // balconies, a shop with display windows, awning, sign and rooftop plant, or
  // an L-shaped block with a rear wing.
  const walls = [LABEL.BUILDING, LABEL.WALL2, LABEL.WALL3];
  const facadeCell = (s, face) => (s > 0 ? Math.ceil((face - X0) / VOX - 0.5) : Math.floor((-face - X0) / VOX - 0.5));
  const cellsAlong = (z0, z1) => span(z0, z1, Z0, NZ);
  // Recess window cells one deep on the street face, glass behind.
  const windows = (s, face, z0, z1, rows, every = 4, open = [1, 2]) => {
    const i = facadeCell(s, face), [j0, j1] = cellsAlong(z0, z1);
    for (let j = j0 + 1; j <= j1 - 1; j++) {
      if (!open.includes((j - j0) % every)) continue;
      for (const k of rows) {
        if (!labels[cellIndex(i, k, j)]) continue;
        labels[cellIndex(i, k, j)] = 0;
        labels[cellIndex(i + s, k, j)] = LABEL.GLASS;
      }
    }
  };
  const hedge = (s, z0, z1, gapAt) => {
    const x = s * 10.8;
    box(x - 0.2, x + 0.2, 0, 0.8, z0, z1, LABEL.HEDGE);
    if (gapAt !== undefined) box(x - 0.2, x + 0.2, 0, 0.8, gapAt - 0.8, gapAt + 0.8, 0);
  };

  function house(s, z0, z1, face, depth, wall) {
    const inner = s * face, outer = s * (face + depth), eave = R(2.0, 2.6);
    box(inner, outer, 0, eave, z0, z1, wall);
    // Gable: steps of one cell, the ridge along the street, a cell of overhang.
    const lo = Math.min(inner, outer) - 0.4, hi = Math.max(inner, outer) + 0.4;
    for (let n = 0; lo + n * 0.4 < hi - n * 0.4; n++) {
      const y = eave + n * 0.4;
      if (y > VOLUME.top) break;
      box(lo + n * 0.4, hi - n * 0.4, y, y + 0.4, z0 - 0.4, z1 + 0.4, LABEL.ROOF);
    }
    const cx = s * (face + depth * 0.7);
    box(cx - 0.3, cx + 0.3, eave, VOLUME.top, z0 + 1.2, z0 + 1.8, wall);   // chimney
    windows(s, face, z0, z1, [5, 6], 5, [1, 2]);
    const door = (z0 + z1) / 2;
    const di = facadeCell(s, face), [dj] = cellsAlong(door - 0.4, door + 0.4);
    for (let k = 3; k <= 6; k++) for (const j of [dj, dj + 1]) { labels[cellIndex(di, k, j)] = 0; labels[cellIndex(di + s, k, j)] = LABEL.GLASS; }
    hedge(s, z0 - 0.4, z1 + 0.4, door);
    box(s * 11.2, s * face, 0, 0.4, door - 0.6, door + 0.6, LABEL.SIDEWALK);   // front path
  }

  function apartments(s, z0, z1, face, depth, wall) {
    const inner = s * face, outer = s * (face + depth);
    box(inner, outer, 0, VOLUME.top, z0, z1, wall);
    windows(s, face, z0, z1, [5, 6], 4, [1, 2]);
    windows(s, face, z0, z1, [12, 13], 4, [1, 2]);
    // Balconies: a slab and a rail one cell out, under every second window pair.
    const [j0, j1] = cellsAlong(z0, z1), i = facadeCell(s, face) - s;
    for (let j = j0 + 1; j <= j1 - 1; j++) {
      if (((j - j0) % 8) > 3) continue;
      labels[cellIndex(i, 9, j)] = wall;
      labels[cellIndex(i - s, 9, j)] = wall;
      labels[cellIndex(i - s, 10, j)] = LABEL.FURNITURE;
    }
  }

  function shop(s, z0, z1, face, depth, wall) {
    const inner = s * face, outer = s * (face + depth), height = R(3.2, 4.0);
    box(inner, outer, 0, height, z0, z1, wall);
    // Display windows between pillars, two cells tall.
    windows(s, face, z0, z1, [4, 5, 6], 5, [1, 2, 3]);
    // Awning over the pavement side, sloping down a cell at its lip.
    const lip = s * (face - 1.6);
    box(s * face, lip, 2.4, 2.8, z0 + 0.4, z1 - 0.4, LABEL.AWNING);
    box(lip, lip + s * 0.4, 2.0, 2.4, z0 + 0.4, z1 - 0.4, LABEL.AWNING);
    // A sign board above the awning, and a parapet and plant on the roof.
    box(s * (face - 0.4), s * face, 3.0, 3.8 > height ? height : 3.8, z0 + 1.6, z1 - 1.6, LABEL.SIGN);
    const top = Math.min(VOLUME.top, height + 0.4);
    box(inner, outer, height, top, z0, z0 + 0.4, wall);
    box(inner, outer, height, top, z1 - 0.4, z1, wall);
    box(inner, inner + s * 0.4, height, top, z0, z1, wall);
    box(outer - s * 0.4, outer, height, top, z0, z1, wall);
    for (let n = 0; n < 2; n++) {
      const x = s * (face + depth * R(0.35, 0.75)), z = R(z0 + 1.2, z1 - 1.6);
      box(x - 0.4, x + 0.4, height, height + 0.8, z, z + 0.8, LABEL.FURNITURE);
    }
  }

  function lshape(s, z0, z1, face, depth, wall) {
    const inner = s * face, outer = s * (face + depth), height = R(3.6, VOLUME.top);
    box(inner, s * (face + depth * 0.5), 0, height, z0, z1, wall);
    box(s * (face + depth * 0.5), outer, 0, height - 0.8, (z0 + z1) / 2, z1, wall);
    windows(s, face, z0, z1, [5, 6], 3, [1]);
    if (height > 4.2) windows(s, face, z0, z1, [12, 13], 3, [1]);
    box(inner, s * (face - 0.4), 0.8, 1.2, z0, z1, wall);   // a plinth ledge along the street
  }

  const kinds = [house, apartments, shop, lshape];
  for (const s of [-1, 1]) {
    let z = R(0, 3);
    while (z < NZ * VOX - 4) {
      let z1 = z + R(7, 16);
      if (z1 > CROSS.corner0 && z < CROSS.corner1) { z = CROSS.corner1 + R(0.4, 2); continue; }
      z1 = Math.min(z1, NZ * VOX - 0.4);
      const kind = pick(kinds);
      if (rng() > 0.08) kind(s, z, z1, R(11.6, 12.8), R(7, 12), pick(walls));
      // Sometimes a fence runs down the gap to the next lot.
      if (rng() > 0.5) box(s * 11.2, s * 22, 0, 1.2, z1 + 0.8, z1 + 1.2, LABEL.FURNITURE);
      z = z1 + R(1.6, 5);
    }
    // A second, taller row behind, only its fronts visible over the first.
    for (let zb = R(0, 6); zb < NZ * VOX - 6; zb += R(10, 20)) {
      if (zb + 8 > CROSS.corner0 && zb < CROSS.corner1) continue;
      const face = R(26, 30);
      box(s * face, s * R(34, 39.6), 0, VOLUME.top, zb, zb + R(6, 12), pick(walls));
    }
  }

  // Trees: round crowns of three overlapping balls, conifers of stacked
  // discs, and bushes in the yards. The pavement's trees are always round and
  // crowned above head height, so the pedestrian walking under them clears.
  const tree = (x, z, street = false) => {
    if (street || rng() < 0.55) {
      box(x - 0.2, x + 0.2, 0, 2.8, z - 0.2, z + 0.2, LABEL.TRUNK);
      const r = R(1.1, 1.5);
      ball(x, 3.7, z, r, LABEL.CANOPY, 0.8);
      ball(x + R(-0.5, 0.5), 3.4, z + R(0.5, 0.9), r * 0.7, LABEL.CANOPY);
      ball(x + R(-0.5, 0.5), 4.1, z - R(0.3, 0.7), r * 0.7, LABEL.CANOPY);
    } else {
      box(x - 0.2, x + 0.2, 0, 1.2, z - 0.2, z + 0.2, LABEL.TRUNK);
      const base = R(1.2, 1.6);
      for (let y = 1.0; y < VOLUME.top; y += 0.4) disc(x, y, y + 0.4, z, base * (1 - (y - 1.0) / 4.4) + 0.15, LABEL.CONIFER);
    }
  };
  for (const s of [-1, 1]) {
    for (let z = R(2, 6); z < NZ * VOX - 2; z += R(8, 12)) {
      if (inCorner(z)) continue;
      tree(s * 8.4, z, true);
    }
    for (let n = 0; n < 40; n++) {
      const x = s * R(23, 26), z = R(2, NZ * VOX - 2);
      if (inCorner(z)) continue;
      if (rng() < 0.5) tree(x, z); else ball(x, 0.2, z, R(0.7, 1.2), LABEL.HEDGE, 0.8);
    }
  }

  // Street furniture.
  const lamp = (s, z) => {
    const x = s * 7.6;
    box(x - 0.2, x + 0.2, 0, 4.8, z - 0.2, z + 0.2, LABEL.POLE);
    box(x, x - s * 2.4, 4.4, 4.8, z - 0.2, z + 0.2, LABEL.POLE);
    box(x - s * 2.0, x - s * 2.8, 4.0, 4.4, z - 0.2, z + 0.2, LABEL.LIGHT);
  };
  for (const s of [-1, 1]) for (let z = 14 + s * 5; z < NZ * VOX - 2; z += 24) if (!inCorner(z)) lamp(s, z);

  // Traffic lights at the four corners: a mast over the lanes it governs, a
  // signal hanging off its end, a pedestrian signal on the pole. The signal
  // clears the bus's roof (3.2 m).
  const signal = (x, z, reach) => {
    box(x - 0.2, x + 0.2, 0, 4.8, z - 0.2, z + 0.2, LABEL.POLE);
    box(x, x + reach, 4.4, 4.8, z - 0.2, z + 0.2, LABEL.POLE);
    box(x + reach - 0.2, x + reach + 0.2, 3.6, 4.4, z - 0.2, z + 0.2, LABEL.LIGHT);
    box(x - 0.2, x + 0.2, 2.0, 2.8, z + 0.2, z + 0.6, LABEL.LIGHT);
  };
  signal(-7.8, 79.0, 5.6);
  signal(7.8, 97.0, -5.6);
  signal(-9.8, 93.2, 0);
  signal(9.8, 82.8, 0);
  for (const x of [-7.6, 7.6]) for (const z of [80.2, 83.2, 92.6, 95.6]) box(x - 0.2, x + 0.2, 0, 1.0, z - 0.2, z + 0.2, LABEL.FURNITURE);

  // A bus stop on the far pavement: roof, back and side glass, a bench.
  box(8.4, 10.0, 2.4, 2.8, 42, 46, LABEL.FURNITURE);
  box(9.6, 10.0, 0, 2.4, 42, 46, LABEL.GLASS);
  box(8.8, 10.0, 0, 2.4, 42, 42.4, LABEL.GLASS);
  box(9.2, 9.6, 0.4, 0.8, 42.8, 45.2, LABEL.FURNITURE);

  // Benches, bins, hydrants and a speed sign along the pavements.
  for (const s of [-1, 1]) {
    for (let z = R(6, 14); z < NZ * VOX - 4; z += R(14, 26)) {
      if (inCorner(z) || (s > 0 && z > 38 && z < 50)) continue;
      const x = s * 9.8;
      box(x - 0.2, x + 0.2, 0.4, 0.8, z, z + 1.6, LABEL.FURNITURE);
      box(x + s * 0.2, x + s * 0.6, 0.4, 1.4, z, z + 1.6, LABEL.FURNITURE);
      box(s * 7.8 - 0.2, s * 7.8 + 0.2, 0, 1.0, z + 4, z + 4.4, LABEL.FURNITURE);
      if (rng() > 0.5) box(s * 8.0 - 0.2, s * 8.0 + 0.2, 0, 0.8, z + 9, z + 9.4, LABEL.SIGN);
    }
  }
  box(-7.8, -7.4, 0, 2.4, 60, 60.4, LABEL.POLE);
  box(-8.2, -7.0, 2.0, 3.0, 60, 60.4, LABEL.SIGN);
  return labels;
}

// ── Signed distance field ────────────────────────────────────────────────────
// A 26-neighbour chamfer distance, one pass each way, for the distance to the
// nearest occupied cell (outside) and to the nearest empty one (inside). The
// surface sits half a cell from each centre, so neighbours across a face read
// +0.2 m and −0.2 m and the zero crossing lands on the face.
export function buildSDF(labels) {
  const N = labels.length, INF = 1e4;
  const outside = new Float32Array(N), inside = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    const occupied = labels[n] !== 0;
    outside[n] = occupied ? 0 : INF;
    inside[n] = occupied ? INF : 0;
  }
  const forward = [], backward = [];
  for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
    const before = dj < 0 || (dj === 0 && (dk < 0 || (dk === 0 && di < 0)));
    const after = dj > 0 || (dj === 0 && (dk > 0 || (dk === 0 && di > 0)));
    const w = Math.hypot(di, dk, dj), off = di + NX * (dk + NY * dj);
    if (before) forward.push([di, dk, dj, w, off]);
    if (after) backward.push([di, dk, dj, w, off]);
  }
  const sweep = (d, mask, reverse) => {
    const s = reverse ? -1 : 1;
    for (let j = reverse ? NZ - 1 : 0; j !== (reverse ? -1 : NZ); j += s) {
      for (let k = reverse ? NY - 1 : 0; k !== (reverse ? -1 : NY); k += s) {
        for (let i = reverse ? NX - 1 : 0; i !== (reverse ? -1 : NX); i += s) {
          const n = cellIndex(i, k, j);
          let best = d[n];
          if (best === 0) continue;
          // Interior cells skip the bounds checks.
          const edge = i === 0 || i === NX - 1 || k === 0 || k === NY - 1 || j === 0 || j === NZ - 1;
          for (let m = 0; m < mask.length; m++) {
            const e = mask[m];
            if (edge) {
              const ii = i + e[0], kk = k + e[1], jj = j + e[2];
              if (ii < 0 || ii >= NX || kk < 0 || kk >= NY || jj < 0 || jj >= NZ) continue;
            }
            const v = d[n + e[4]] + e[3];
            if (v < best) best = v;
          }
          d[n] = best;
        }
      }
    }
  };
  for (const d of [outside, inside]) { sweep(d, forward, false); sweep(d, backward, true); }
  const sdf = new Float32Array(N);
  for (let n = 0; n < N; n++) sdf[n] = labels[n] ? -(inside[n] - 0.5) * VOX : (outside[n] - 0.5) * VOX;
  return sdf;
}

// Trilinear lookup. Outside the grid the distance grows with the overshoot:
// above the volume a ray is in open sky, below it in the ground.
export function sampleSDF(sdf, x, y, z) {
  let fx = (x - X0) / VOX - 0.5, fy = (y - Y0) / VOX - 0.5, fz = (z - Z0) / VOX - 0.5;
  let extra = 0;
  if (fx < 0) { extra += -fx * VOX; fx = 0; } else if (fx > NX - 1) { extra += (fx - NX + 1) * VOX; fx = NX - 1; }
  if (fz < 0) { extra += -fz * VOX; fz = 0; } else if (fz > NZ - 1) { extra += (fz - NZ + 1) * VOX; fz = NZ - 1; }
  if (fy > NY - 1) { extra += (fy - NY + 1) * VOX; fy = NY - 1; } else if (fy < 0) { fy = 0; }
  const i = Math.min(NX - 2, fx | 0), k = Math.min(NY - 2, fy | 0), j = Math.min(NZ - 2, fz | 0);
  const u = fx - i, v = fy - k, w = fz - j;
  const n = cellIndex(i, k, j), dx = 1, dy = NX, dz = NX * NY;
  const c00 = sdf[n] * (1 - u) + sdf[n + dx] * u, c10 = sdf[n + dy] * (1 - u) + sdf[n + dy + dx] * u;
  const c01 = sdf[n + dz] * (1 - u) + sdf[n + dz + dx] * u, c11 = sdf[n + dz + dy] * (1 - u) + sdf[n + dz + dy + dx] * u;
  const c0 = c00 * (1 - v) + c10 * v, c1 = c01 * (1 - v) + c11 * v;
  return c0 * (1 - w) + c1 * w + extra;
}

export function labelAt(labels, x, y, z) {
  const i = Math.floor((x - X0) / VOX), k = Math.floor((y - Y0) / VOX), j = Math.floor((z - Z0) / VOX);
  if (i < 0 || i >= NX || k < 0 || k >= NY || j < 0 || j >= NZ) return LABEL.EMPTY;
  return labels[cellIndex(i, k, j)];
}

// ── Agents ───────────────────────────────────────────────────────────────────
// Every agent is a movable class (what the Grounded-SAM prompt of Figure 4
// would mask); parked cars and a waiting pedestrian are movable but still,
// which is exactly what the dynamic mask has to tell apart. Parts are boxes as
// centre + half extents in the agent's frame (x across, y up, z along its
// axis of travel).
const wheels = (x, z, r, w) => [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ c: [sx * x, r, sz * z], h: [w, r, r] })));
export const SHAPES = {
  car: [
    { c: [0, 0.72, 0.05], h: [0.9, 0.3, 2.25] },
    { c: [0, 1.22, -0.25], h: [0.78, 0.22, 1.2] },
    ...wheels(0.78, 1.45, 0.33, 0.14),
  ],
  van: [
    { c: [0, 0.85, 0], h: [0.97, 0.42, 2.45] },
    { c: [0, 1.6, -0.35], h: [0.92, 0.36, 1.95] },
    ...wheels(0.82, 1.6, 0.36, 0.15),
  ],
  bus: [
    { c: [0, 1.7, 0], h: [1.25, 1.25, 5.3] },
    { c: [0, 3.08, 1.2], h: [0.7, 0.14, 1.4] },
    ...wheels(1.05, 3.7, 0.45, 0.18),
  ],
  cyclist: [
    { c: [0, 0.34, 0.55], h: [0.06, 0.34, 0.34] },
    { c: [0, 0.34, -0.55], h: [0.06, 0.34, 0.34] },
    { c: [0, 0.68, 0], h: [0.06, 0.1, 0.5] },
    { c: [0, 1.3, -0.12], h: [0.22, 0.34, 0.24] },
    { c: [0, 1.78, 0.02], h: [0.13, 0.13, 0.13] },
  ],
  pedestrian: [
    { c: [0.12, 0.44, 0], h: [0.09, 0.44, 0.11] },
    { c: [-0.12, 0.44, 0], h: [0.09, 0.44, 0.11] },
    { c: [0, 1.16, 0], h: [0.25, 0.3, 0.15] },
    { c: [0, 1.62, 0], h: [0.12, 0.14, 0.12] },
  ],
};

// Motions were laid out so nobody meets: the crossing cars take the
// intersection in the gaps between the main road's traffic, the pedestrian
// crosses ahead of the lead car.
const wave = (t) => Math.sin((2 * Math.PI * t) / CYCLE);
export const AGENTS = [
  { name: 'Lead car', kind: 'car', axis: 'z', paint: '#B8433A', at: (t) => [EGO.x, egoZ(t) + 12 + 3 * wave(t)] },
  { name: 'Oncoming car', kind: 'car', axis: 'z', paint: '#D7D9DC', at: (t) => [1.8, 150 - 9 * t] },
  { name: 'Bus', kind: 'bus', axis: 'z', paint: '#E0A33A', at: (t) => [1.9, 170 - 8.5 * t] },
  { name: 'Cyclist', kind: 'cyclist', axis: 'z', paint: '#3F6FB5', at: (t) => [-3.6, 50 + 4 * t] },
  { name: 'Crossing car', kind: 'van', axis: 'x', paint: '#3C6E4F', at: (t) => [40 - 7 * (t + 2.94), 86] },
  { name: 'Crossing car', kind: 'car', axis: 'x', paint: '#6D6F74', at: (t) => [-4.95 + 6 * (t - 10.9), 90] },
  { name: 'Pedestrian', kind: 'pedestrian', axis: 'x', paint: '#6B4E9B', at: (t) => [2.6 - 1.4 * t, 81.8] },
  { name: 'Pedestrian', kind: 'pedestrian', axis: 'z', paint: '#9B5A3C', at: (t) => [-9.3, 56 + 1.3 * t] },
  { name: 'Waiting pedestrian', kind: 'pedestrian', axis: 'z', paint: '#3D5A80', at: () => [8.7, 44.2] },
  { name: 'Parked car', kind: 'car', axis: 'z', paint: '#50565E', at: () => [-5.8, 30] },
  { name: 'Parked van', kind: 'van', axis: 'z', paint: '#E8E6E1', at: () => [-5.8, 64] },
  { name: 'Parked car', kind: 'car', axis: 'z', paint: '#8C3B44', at: () => [-5.8, 112] },
  { name: 'Parked car', kind: 'car', axis: 'z', paint: '#2F4F5F', at: () => [5.8, 20] },
  { name: 'Parked car', kind: 'car', axis: 'z', paint: '#A4A7AB', at: () => [5.8, 52] },
  { name: 'Parked van', kind: 'van', axis: 'z', paint: '#44484E', at: () => [5.8, 70] },
  { name: 'Parked car', kind: 'car', axis: 'z', paint: '#7A5C3E', at: () => [5.8, 106] },
  { name: 'Parked car', kind: 'car', axis: 'z', paint: '#D5D3CD', at: () => [5.8, 132] },
];

// Each agent's world boxes and velocity (m/s, along x and z) at time t, and
// the heading it faces (the sign of its axis of travel).
export function agentStates(t) {
  const h = 1e-3;
  const states = AGENTS.map((agent, index) => {
    const [x, z] = agent.at(t), [xa, za] = agent.at(t - h), [xb, zb] = agent.at(t + h);
    const vx = (xb - xa) / (2 * h), vz = (zb - za) / (2 * h);
    const facing = (agent.axis === 'z' ? vz : vx) < -0.01 ? -1 : 1;
    const boxes = SHAPES[agent.kind].map(({ c, h: e }) => agent.axis === 'z'
      ? { cx: x + c[0] * facing, cy: c[1], cz: z + c[2] * facing, hx: e[0], hy: e[1], hz: e[2] }
      : { cx: x + c[2] * facing, cy: c[1], cz: z - c[0] * facing, hx: e[2], hy: e[1], hz: e[0] });
    const moving = Math.hypot(vx, vz) > 0.05;
    return { agent, index, x, z, vx, vz, facing, moving, boxes };
  });
  packBoxes(states);
  return states;
}

// The boxes flattened for the distance queries below, which run a few
// million times a pane: centre, half extents, owner.
export function packBoxes(states) {
  const boxes = states.flatMap((s) => s.boxes.map((b) => [b.cx, b.cy, b.cz, b.hx, b.hy, b.hz, s.index]));
  const packed = new Float32Array(boxes.length * 7);
  boxes.forEach((b, n) => packed.set(b, n * 7));
  states.packed = packed;
  return packed;
}

// Distance to the nearest box of `packed`, and whose it is.
export function agentSDF(packed, x, y, z, out) {
  const p = packed;
  let best = 1e9, who = -1;
  for (let o = 0; o < p.length; o += 7) {
    let qx = x - p[o]; if (qx < 0) qx = -qx; qx -= p[o + 3];
    let qy = y - p[o + 1]; if (qy < 0) qy = -qy; qy -= p[o + 4];
    let qz = z - p[o + 2]; if (qz < 0) qz = -qz; qz -= p[o + 5];
    // A cheap lower bound first: most boxes are far from most samples.
    const bound = qx > qy ? (qx > qz ? qx : qz) : (qy > qz ? qy : qz);
    if (bound >= best) continue;
    let d;
    if (bound <= 0) d = bound;
    else {
      const ax = qx > 0 ? qx : 0, ay = qy > 0 ? qy : 0, az = qz > 0 ? qz : 0;
      d = Math.sqrt(ax * ax + ay * ay + az * az);
    }
    if (d < best) { best = d; who = p[o + 6]; }
  }
  out.d = best;
  out.who = who;
  return out;
}

// The cells an agent occupies: centres inside a box grown by a little, so a
// wheel or a head thinner than a cell still takes one.
export function voxelizeAgents(states) {
  const cells = new Map(), grow = 0.1;
  for (const s of states) {
    for (const b of s.boxes) {
      const i0 = Math.max(0, Math.ceil((b.cx - b.hx - grow - X0) / VOX - 0.5)), i1 = Math.min(NX - 1, Math.floor((b.cx + b.hx + grow - X0) / VOX - 0.5));
      const k0 = Math.max(0, Math.ceil((b.cy - b.hy - grow - Y0) / VOX - 0.5)), k1 = Math.min(NY - 1, Math.floor((b.cy + b.hy + grow - Y0) / VOX - 0.5));
      const j0 = Math.max(0, Math.ceil((b.cz - b.hz - grow - Z0) / VOX - 0.5)), j1 = Math.min(NZ - 1, Math.floor((b.cz + b.hz + grow - Z0) / VOX - 0.5));
      for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) cells.set(cellIndex(i, k, j), s);
    }
  }
  return cells;
}

// Occupied cells with at least one empty face neighbour: the shell the voxel
// view draws. Below the grid counts as ground.
export function surfaceCells(labels) {
  const out = [];
  const empty = (i, k, j) => {
    if (k < 0) return false;
    if (k >= NY || i < 0 || i >= NX || j < 0 || j >= NZ) return true;
    return labels[cellIndex(i, k, j)] === 0;
  };
  for (let j = 0; j < NZ; j++) for (let k = 0; k < NY; k++) for (let i = 0; i < NX; i++) {
    if (!labels[cellIndex(i, k, j)]) continue;
    if (empty(i + 1, k, j) || empty(i - 1, k, j) || empty(i, k + 1, j) || empty(i, k - 1, j) || empty(i, k, j + 1) || empty(i, k, j - 1)) {
      out.push(cellIndex(i, k, j));
    }
  }
  return out;
}
