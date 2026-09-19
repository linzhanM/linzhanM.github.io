// ─────────────────────────────────────────────────────────────────────────────
// DIMO Motion Lab — the toy motion decoder and the key-point skinning.
//
// The paper's decoder D_c(z, p_k, t) is an MLP that maps a 32-D latent code, a
// key point's canonical position and a time to that key point's 6-DoF
// transform. The lab's stands in for it with two honest simplifications:
//
//   1. The latent sheet is 2-D so a visitor can point at it, and the decoder
//      is an RBF blend over the object's basis motions (the UR5e's and the
//      duck's clips, hand-authored ball loops): at a latent z the joint pose
//      at phase u is Σ_m w_m(z) · θ_m(u), with
//      w = softmax-normalised exp(−|z − z_m|² / 2σ²). At an anchor it plays
//      that motion; between anchors it interpolates in joint space, which is
//      what makes the latent walk in the panel read as continuous.
//   2. Key points ride their link rigidly, so each key point's transform is
//      its link's forward-kinematics change from the canonical pose. The
//      Gaussians are then skinned FROM THE KEY POINTS, with the paper's RBF
//      weights (Eq. 1: w_jk ∝ exp(−|p_j − p_k|² / 2 r_k)) over each Gaussian's
//      K nearest key points — so a Gaussian beside a joint blends two links,
//      which is the softness the paper's renders have and a rigid mesh lacks.
// ─────────────────────────────────────────────────────────────────────────────

// A free bone's six controls, suffixed to its drive: translation from rest in
// its parent's frame, then rotation after rest as XYZ Euler angles.
export const FREE_CONTROLS = ['tx', 'ty', 'tz', 'rx', 'ry', 'rz'];

// Every control name an object's joints read: a model's bones first, then
// its primitive links, in tree order.
export function controlNames(spec) {
  const names = [];
  const add = (drive) => { if (!names.includes(drive)) names.push(drive); };
  for (const j of Object.values(spec.model?.joints || {})) {
    if (j.free) for (const k of FREE_CONTROLS) add(`${j.drive}_${k}`);
    else add(j.drive);
  }
  for (const j of spec.joints || []) if (j.axis) add(j.drive || j.name);
  return names;
}

// RBF weights of the basis motions at latent z, normalised to sum to one.
export function weightsAt(z, motions, sigma) {
  const inv = 1 / (2 * sigma * sigma);
  const w = motions.map((m) => {
    const dx = z[0] - m.z[0], dy = z[1] - m.z[1];
    return Math.exp(-(dx * dx + dy * dy) * inv);
  });
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((v) => v / sum);
}

// The blended pose at phase u: control → value.
export function decodePose(spec, controls, weights, u) {
  const pose = {};
  for (const name of controls) {
    let v = 0;
    for (let i = 0; i < weights.length; i++) {
      if (weights[i] < 1e-4) continue;
      const fn = spec.motions[i].joints[name];
      v += weights[i] * (fn ? fn(u) : (spec.rest[name] ?? 0));
    }
    pose[name] = v;
  }
  return pose;
}

// Bind each Gaussian to its K nearest key points with the paper's RBF weights,
// then fold the weights per LINK (key points on one link share a transform),
// so the per-frame skin is at most K matrix-vector products per Gaussian.
// r_k is each key point's spacing — the distance to its nearest neighbour —
// so the kernel adapts to how densely a region was sampled.
export function bindGaussians(gaussianPositions, keypointPositions, keypointLinks, K = 6) {
  const nG = gaussianPositions.length / 3;
  const nK = keypointPositions.length / 3;

  const spacing = new Float32Array(nK);
  for (let k = 0; k < nK; k++) {
    let best = Infinity;
    const kx = keypointPositions[3 * k], ky = keypointPositions[3 * k + 1], kz = keypointPositions[3 * k + 2];
    for (let j = 0; j < nK; j++) {
      if (j === k) continue;
      const dx = keypointPositions[3 * j] - kx, dy = keypointPositions[3 * j + 1] - ky, dz = keypointPositions[3 * j + 2] - kz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    spacing[k] = Math.sqrt(best) * 1.25;
  }

  const bindOffset = new Uint32Array(nG + 1);
  const linkOut = [];
  const weightOut = [];
  const nearIdx = new Int32Array(K);
  const nearD2 = new Float64Array(K);
  for (let g = 0; g < nG; g++) {
    const gx = gaussianPositions[3 * g], gy = gaussianPositions[3 * g + 1], gz = gaussianPositions[3 * g + 2];
    nearD2.fill(Infinity); nearIdx.fill(-1);
    for (let k = 0; k < nK; k++) {
      const dx = keypointPositions[3 * k] - gx, dy = keypointPositions[3 * k + 1] - gy, dz = keypointPositions[3 * k + 2] - gz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= nearD2[K - 1]) continue;
      let i = K - 1;
      while (i > 0 && nearD2[i - 1] > d2) { nearD2[i] = nearD2[i - 1]; nearIdx[i] = nearIdx[i - 1]; i--; }
      nearD2[i] = d2; nearIdx[i] = k;
    }
    const perLink = new Map();
    let sum = 0;
    for (let i = 0; i < K; i++) {
      const k = nearIdx[i];
      if (k < 0) continue;
      const r = spacing[k];
      const w = Math.exp(-nearD2[i] / (2 * r * r));
      sum += w;
      const link = keypointLinks[k];
      perLink.set(link, (perLink.get(link) || 0) + w);
    }
    bindOffset[g] = linkOut.length;
    for (const [link, w] of perLink) { linkOut.push(link); weightOut.push(w / (sum || 1)); }
  }
  bindOffset[nG] = linkOut.length;
  return { bindOffset, bindLink: Int16Array.from(linkOut), bindWeight: Float32Array.from(weightOut) };
}

// Skin the Gaussians: out_i = Σ_l w_il · (E_l · p_i), with E_l the link's
// canonical-to-current matrix (16 column-major floats per link in `E`).
export function skinGaussians(canonical, binding, E, out) {
  const { bindOffset, bindLink, bindWeight } = binding;
  const nG = canonical.length / 3;
  for (let g = 0; g < nG; g++) {
    const px = canonical[3 * g], py = canonical[3 * g + 1], pz = canonical[3 * g + 2];
    let x = 0, y = 0, z = 0;
    for (let b = bindOffset[g]; b < bindOffset[g + 1]; b++) {
      const e = bindLink[b] * 16, w = bindWeight[b];
      x += w * (E[e] * px + E[e + 4] * py + E[e + 8] * pz + E[e + 12]);
      y += w * (E[e + 1] * px + E[e + 5] * py + E[e + 9] * pz + E[e + 13]);
      z += w * (E[e + 2] * px + E[e + 6] * py + E[e + 10] * pz + E[e + 14]);
    }
    out[3 * g] = x; out[3 * g + 1] = y; out[3 * g + 2] = z;
  }
}

// Move the key points rigidly with their links.
export function transformKeypoints(canonical, links, E, out) {
  const n = canonical.length / 3;
  for (let k = 0; k < n; k++) {
    const e = links[k] * 16;
    const px = canonical[3 * k], py = canonical[3 * k + 1], pz = canonical[3 * k + 2];
    out[3 * k] = E[e] * px + E[e + 4] * py + E[e + 8] * pz + E[e + 12];
    out[3 * k + 1] = E[e + 1] * px + E[e + 5] * py + E[e + 9] * pz + E[e + 13];
    out[3 * k + 2] = E[e + 2] * px + E[e + 6] * py + E[e + 10] * pz + E[e + 14];
  }
}
