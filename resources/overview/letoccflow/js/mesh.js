// Surface nets: a smooth shell from a field sampled on a regular grid. One
// vertex per cell of eight samples that straddles the surface, at the mean of
// its edges' crossings; one quad per sample edge that crosses, joining the four
// cells around it. Shared vertices give smooth normals.
//
// `field(i, k, j)` returns the value at sample (i, k, j) of an nx × ny × nz grid
// whose sample (0, 0, 0) sits at `origin`, `step` apart. Negative is inside.
// `relax` runs constrained smoothing afterwards: each vertex moves toward the
// mean of its neighbours but never leaves its own cell. Over a binary field
// (±1) that keeps flat walls flat and thin poles standing while it rounds the
// voxel steps off corners and roofs.
export function surfaceNets(field, nx, ny, nz, origin, step, { relax = 0 } = {}) {
  const values = new Float32Array(nx * ny * nz);
  for (let j = 0; j < nz; j++) for (let k = 0; k < ny; k++) for (let i = 0; i < nx; i++) values[i + nx * (k + ny * j)] = field(i, k, j);
  const at = (i, k, j) => values[i + nx * (k + ny * j)];

  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const vertexOf = new Int32Array(cx * cy * cz).fill(-1);
  const positions = [], cells = [];
  const corner = new Float32Array(8);
  // The 12 edges of a cell as pairs of corner ids (corner id = dx + 2dy + 4dz).
  const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let j = 0; j < cz; j++) for (let k = 0; k < cy; k++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = at(i + (c & 1), k + ((c >> 1) & 1), j + ((c >> 2) & 1));
      corner[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of EDGES) {
      const va = corner[a], vb = corner[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t;
      sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      n++;
    }
    vertexOf[i + cx * (k + cy * j)] = positions.length / 3;
    positions.push(i + sx / n, k + sy / n, j + sz / n);   // grid units until the end
    cells.push(i, k, j);
  }

  const quads = [];
  const cell = (i, k, j) => (i < 0 || k < 0 || j < 0 || i >= cx || k >= cy || j >= cz ? -1 : vertexOf[i + cx * (k + cy * j)]);
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) quads.push(a, d, c, b); else quads.push(a, b, c, d);
  };
  for (let j = 0; j < nz; j++) for (let k = 0; k < ny; k++) for (let i = 0; i < nx; i++) {
    const inside = at(i, k, j) < 0;
    if (i < cx && (at(i + 1, k, j) < 0) !== inside) quad(cell(i, k - 1, j - 1), cell(i, k, j - 1), cell(i, k, j), cell(i, k - 1, j), !inside);
    if (k < cy && (at(i, k + 1, j) < 0) !== inside) quad(cell(i - 1, k, j - 1), cell(i - 1, k, j), cell(i, k, j), cell(i, k, j - 1), !inside);
    if (j < cz && (at(i, k, j + 1) < 0) !== inside) quad(cell(i - 1, k - 1, j), cell(i, k - 1, j), cell(i, k, j), cell(i - 1, k, j), !inside);
  }

  const count = positions.length / 3;
  let p = new Float32Array(positions);
  if (relax > 0) {
    // Neighbours along quad edges, packed: offsets into one flat list.
    const degree = new Int32Array(count + 1);
    for (let q = 0; q < quads.length; q += 4) for (let e = 0; e < 4; e++) degree[quads[q + e] + 1] += 2;
    for (let v = 0; v < count; v++) degree[v + 1] += degree[v];
    const fill = degree.slice(0, count), links = new Int32Array(degree[count]);
    for (let q = 0; q < quads.length; q += 4) {
      for (let e = 0; e < 4; e++) {
        const a = quads[q + e], b = quads[q + ((e + 1) % 4)];
        links[fill[a]++] = b;
        links[fill[b]++] = a;
      }
    }
    let next = new Float32Array(p.length);
    for (let pass = 0; pass < relax; pass++) {
      for (let v = 0; v < count; v++) {
        const from = degree[v], to = degree[v + 1];
        for (let a = 0; a < 3; a++) {
          let sum = 0;
          for (let l = from; l < to; l++) sum += p[links[l] * 3 + a];
          const mean = to > from ? sum / (to - from) : p[v * 3 + a];
          const lo = cells[v * 3 + a], moved = p[v * 3 + a] * 0.4 + mean * 0.6;
          next[v * 3 + a] = Math.min(lo + 1, Math.max(lo, moved));
        }
      }
      [p, next] = [next, p];
    }
  }
  for (let v = 0; v < count; v++) {
    p[v * 3] = origin[0] + p[v * 3] * step;
    p[v * 3 + 1] = origin[1] + p[v * 3 + 1] * step;
    p[v * 3 + 2] = origin[2] + p[v * 3 + 2] * step;
  }

  const Index = count > 65535 ? Uint32Array : Uint16Array;
  const indices = new Index((quads.length / 4) * 6);
  for (let q = 0, o = 0; q < quads.length; q += 4, o += 6) {
    indices[o] = quads[q]; indices[o + 1] = quads[q + 1]; indices[o + 2] = quads[q + 2];
    indices[o + 3] = quads[q]; indices[o + 4] = quads[q + 2]; indices[o + 5] = quads[q + 3];
  }
  return { positions: p, indices };
}
