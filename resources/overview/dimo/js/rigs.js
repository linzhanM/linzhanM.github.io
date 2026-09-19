// ─────────────────────────────────────────────────────────────────────────────
// DIMO Motion Lab — rig builder.
//
// Builds an object from its examples.js entry, one of two ways, and hands both
// back in one shape: LINKS (an Object3D a joint rotates or slides, the meshes
// it carries, its canonical world matrix) and a setPose over them.
//
//   model   a skinned GLB out of resources/glbs/. Its bones are the links; the
//           catalog names which bones are joints (axis + control). Every mesh
//           part must be rigidly bound to one bone — that bone is the link the
//           part samples into.
//   joints  a kinematic tree of primitives built here: the whole object when
//           there is no model (the bouncing balls), or extra links hung off a
//           model's bones by naming one as `parent` (the UR5e's gripper).
//
// Then it samples the two point sets the lab visualises: N_k key points spread
// over the surface by farthest-point sampling (the paper initialises its key
// points as Gaussians in a sphere and anneals them down to N_k with FPS — the
// spread is the same idea, here started from the surface), and a denser set of
// Gaussians in the surface's colour. Everything is sampled in the REST pose,
// which is what "canonical" means here.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { FREE_CONTROLS } from './decoder.js?v=1';

const DEG = Math.PI / 180;

// A shape sits at `pos` in its link's frame, unrotated.
const shapeMatrix = (shape) => new THREE.Matrix4().makeTranslation(...(shape.pos || [0, 0, 0]));

function shapeGeometry(shape) {
  switch (shape.kind) {
    case 'cylinder': return new THREE.CylinderGeometry(shape.r, shape.r, shape.h, 40);
    case 'sphere': return new THREE.SphereGeometry(shape.r, 48, 32);
    case 'box': {
      const [a, b, c] = shape.size;
      return new RoundedBoxGeometry(a, b, c, 3, shape.radius ?? Math.min(a, b, c) * 0.22);
    }
    default: throw new Error(`Unknown shape kind: ${shape.kind}`);
  }
}

// Surface area in WORLD units, from the triangles under `matrix`: a model's
// parts are quantized, each in its own local scale, so their raw local areas
// are not comparable.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function geometryArea(geometry, matrix) {
  const pos = geometry.attributes.position;
  const index = geometry.index;
  const n = index ? index.count : pos.count;
  let area = 0;
  for (let i = 0; i < n; i += 3) {
    const ia = index ? index.getX(i) : i, ib = index ? index.getX(i + 1) : i + 1, ic = index ? index.getX(i + 2) : i + 2;
    _a.fromBufferAttribute(pos, ia).applyMatrix4(matrix);
    _b.fromBufferAttribute(pos, ib).applyMatrix4(matrix);
    _c.fromBufferAttribute(pos, ic).applyMatrix4(matrix);
    area += _b.sub(_a).cross(_c.sub(_a)).length() / 2;
  }
  return area;
}

// Deterministic per build so the same object always samples the same points.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Farthest-point sampling: the first `count` of the returned order are spread
// as evenly as the candidates allow, so a prefix of it is also a good subset
// (the trajectory overlay traces a prefix of the key points for that reason).
function farthestPoints(candidates, count) {
  const n = candidates.length / 3;
  const dist = new Float64Array(n).fill(Infinity);
  const order = new Int32Array(count);
  let current = 0;
  for (let i = 0; i < count; i++) {
    order[i] = current;
    const cx = candidates[3 * current], cy = candidates[3 * current + 1], cz = candidates[3 * current + 2];
    let far = 0, farD = -1;
    for (let j = 0; j < n; j++) {
      const dx = candidates[3 * j] - cx, dy = candidates[3 * j + 1] - cy, dz = candidates[3 * j + 2] - cz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < dist[j]) dist[j] = d;
      if (dist[j] > farD) { farD = dist[j]; far = j; }
    }
    current = far;
  }
  return order;
}

// Three finishes, keyed by the shape's `finish` or, failing that, by how dark
// its colour is: light shells are painted plastic with a clearcoat, dark parts
// are anodised metal, and `gloss` is the glassy plastic of the bouncing balls.
// A model's own materials are re-cast into these by colour, so every object
// in the lab is lit the same way. envMapIntensity 0.6 (was 0.75) since
// 2026-09-12, with viewer.js's exposure and key light: too bright before.
const materialCache = new Map();
function materialFor(color, finish) {
  if (!finish) finish = new THREE.Color(color).getHSL({}).l < 0.4 ? 'metal' : 'shell';
  const key = `${color}|${finish}`;
  if (!materialCache.has(key)) {
    const presets = {
      shell: { roughness: 0.42, metalness: 0.04, clearcoat: 0.55, clearcoatRoughness: 0.28 },
      metal: { roughness: 0.38, metalness: 0.62 },
      gloss: { roughness: 0.16, metalness: 0.02, clearcoat: 1, clearcoatRoughness: 0.08 },
      matte: { roughness: 0.85, metalness: 0 },
    };
    materialCache.set(key, new THREE.MeshPhysicalMaterial({ color, envMapIntensity: 0.6, ...presets[finish] }));
  }
  return materialCache.get(key);
}

// The models in resources/glbs/ are meshopt-compressed (EXT_meshopt_compression;
// how they were made is in AGENTS.md), so the decoder is registered or none of
// them parses. Each URL is fetched once per session; every build clones it.
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const models = new Map();
function loadModel(url) {
  if (!models.has(url)) models.set(url, gltfLoader.loadAsync(url));
  return models.get(url);
}

// Pose a tree from a control → value map. The canonical matrices are taken
// with the root at the origin, so matrixWorld doubles as the link's frame in
// object space; an instance placed elsewhere carries its offset in E.
const jointQuat = new THREE.Quaternion();
const freeOffset = new THREE.Vector3();
const freeEuler = new THREE.Euler();
const slideAxis = new THREE.Vector3();
function poseLinks(root, links, pose) {
  for (const link of links) {
    if (link.type === 'free') {
      // A floating bone (a trunk that sits or lies down): translation from rest
      // in its parent's frame, rotation after rest as XYZ Euler angles, the six
      // controls its generated motions carry.
      const p = FREE_CONTROLS.map((k) => pose[`${link.drive}_${k}`] ?? 0);
      if (!p.every(Number.isFinite)) throw new Error(`Pose values for "${link.drive}" are not numbers`);
      link.group.position.copy(link.basePosition).add(freeOffset.set(p[0], p[1], p[2]));
      link.group.quaternion.copy(link.origin).multiply(jointQuat.setFromEuler(freeEuler.set(p[3], p[4], p[5], 'XYZ')));
      continue;
    }
    if (!link.axis) continue;
    const value = pose[link.drive] ?? 0;
    // A function or a typo in a catalog `rest` used to become NaN here and
    // surface as an empty stage — fail at the source instead.
    if (!Number.isFinite(value)) throw new Error(`Pose value for "${link.drive}" is not a number`);
    if (link.type === 'slide') {
      link.group.position.copy(link.basePosition).addScaledVector(slideAxis.copy(link.axis).applyQuaternion(link.origin), value);
    } else {
      link.group.quaternion.copy(link.origin).multiply(jointQuat.setFromAxisAngle(link.axis, value));
    }
  }
  root.updateMatrixWorld(true);
}

// A second body for the same object. SkeletonUtils.clone, not Object3D.clone:
// a plain clone leaves every copy's skinned parts bound to the FIRST body's
// bones, so all bodies would move as one. Geometry and materials stay shared;
// links are re-pointed by name — a model's parts are named, a primitive link's
// meshes are its first children. The sampled key points, Gaussians and
// canonical matrices are reused: they describe the object, not the copy.
export function cloneRig(rig) {
  const root = SkeletonUtils.clone(rig.root);
  const byName = new Map();
  root.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  const links = rig.links.map((l) => {
    const group = byName.get(l.group.name);
    const meshes = l.meshes.map((m, i) => ({ ...m, mesh: m.mesh.name ? byName.get(m.mesh.name) : group.children[i] }));
    return { ...l, group, meshes };
  });
  return { ...rig, root, links, setPose: (pose) => poseLinks(root, links, pose), dispose: () => {} };
}

function makeLink(name, group, { axis = null, type = 'revolute', drive = name } = {}) {
  return {
    name, group, meshes: [],
    axis: axis ? new THREE.Vector3(...axis).normalize() : null,
    type, drive,
    basePosition: group.position.clone(),
    origin: group.quaternion.clone(),
    canonical: new THREE.Matrix4(),
    canonicalInverse: new THREE.Matrix4(),
  };
}

// The model's parts, bound to their bones. Rigid binding is read off the
// first vertex: the bone with the most weight there.
function addModel(spec, gltf, root, links, byName) {
  const model = SkeletonUtils.clone(gltf.scene);
  const holder = new THREE.Group();
  holder.name = `${spec.slug}:model`;
  const [rx, ry, rz] = spec.model.rotation || [0, 0, 0];
  holder.rotation.set(rx * DEG, ry * DEG, rz * DEG);
  holder.add(model);
  root.add(holder);

  const joints = spec.model.joints || {};
  model.traverse((o) => {
    if (!o.isBone) return;
    const j = joints[o.name];
    const link = makeLink(o.name, o, j ? { axis: j.axis, drive: j.drive, type: j.free ? 'free' : 'revolute' } : {});
    links.push(link);
    byName.set(o.name, link);
  });
  for (const name of Object.keys(joints)) {
    if (!byName.has(name)) throw new Error(`No bone "${name}" in ${spec.model.url}`);
  }

  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    const weights = [sw.getX(0), sw.getY(0), sw.getZ(0), sw.getW(0)];
    const indices = [si.getX(0), si.getY(0), si.getZ(0), si.getW(0)];
    const slot = weights.indexOf(Math.max(...weights));
    const boneIndex = indices[slot];
    const bone = o.skeleton.bones[boneIndex];
    const color = '#' + o.material.color.getHexString();
    o.material = materialFor(color, spec.model.finish);
    o.castShadow = true;
    // Its bounds are the bind pose's, not wherever the bone has swung it.
    o.frustumCulled = false;
    // An attached SkinnedMesh draws a vertex at bone.matrixWorld ·
    // boneInverse · bindMatrix · v, so that product, taken at rest, is what
    // carries the part's samples into the canonical frame.
    byName.get(bone.name).meshes.push({
      mesh: o,
      shape: { kind: 'skinned', color },
      matrix: new THREE.Matrix4().multiplyMatrices(o.skeleton.boneInverses[boneIndex], o.bindMatrix),
    });
  });
}

export async function buildRig(spec, { keypoints, gaussians }) {
  const root = new THREE.Group();
  root.name = spec.label;
  const links = [];
  const byName = new Map();

  if (spec.model) addModel(spec, await loadModel(spec.model.url), root, links, byName);

  for (const j of spec.joints || []) {
    const group = new THREE.Group();
    group.name = j.name;
    group.position.set(...(j.pos || [0, 0, 0]));
    if (j.parent && !byName.has(j.parent)) throw new Error(`No link "${j.parent}" for "${j.name}"`);
    (j.parent ? byName.get(j.parent).group : root).add(group);
    const link = makeLink(j.name, group, { axis: j.axis, type: j.type || 'revolute', drive: j.drive || j.name });
    for (const shape of j.shapes || []) {
      const mesh = new THREE.Mesh(shapeGeometry(shape), materialFor(shape.color, shape.finish));
      mesh.applyMatrix4(shapeMatrix(shape));
      mesh.castShadow = true;
      mesh.userData.scenery = shape.scenery === true;
      group.add(mesh);
      link.meshes.push({ mesh, shape, matrix: shapeMatrix(shape) });
    }
    links.push(link);
    byName.set(j.name, link);
  }

  const setPose = (pose) => poseLinks(root, links, pose);
  setPose(spec.rest);
  for (const link of links) {
    link.canonical.copy(link.group.matrixWorld);
    link.canonicalInverse.copy(link.canonical).invert();
  }

  // Surface sampling, area-weighted across every part of every link, from the
  // triangles (MeshSurfaceSampler), so it holds for any geometry.
  const rand = mulberry32(0x51a7);
  const pieces = [];
  let totalArea = 0;
  links.forEach((link, li) => {
    for (const m of link.meshes) {
      if (m.shape.scenery) continue;   // drawn with the object, not part of it
      const matrix = new THREE.Matrix4().multiplyMatrices(link.canonical, m.matrix);
      const area = geometryArea(m.mesh.geometry, matrix);
      totalArea += area;
      const sampler = new MeshSurfaceSampler(m.mesh).setRandomGenerator(rand).build();
      pieces.push({ link: li, sampler, matrix, area, color: new THREE.Color(m.shape.color) });
    }
  });
  const sampleSurface = (count) => {
    const positions = new Float32Array(count * 3);
    const linkIndex = new Int16Array(count);
    const colors = new Float32Array(count * 3);
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    let i = 0;
    pieces.forEach((piece, pi) => {
      const n = pi === pieces.length - 1 ? count - i : Math.round(count * piece.area / totalArea);
      for (let k = 0; k < n && i < count; k++, i++) {
        piece.sampler.sample(p);
        p.applyMatrix4(piece.matrix);
        positions[3 * i] = p.x; positions[3 * i + 1] = p.y; positions[3 * i + 2] = p.z;
        linkIndex[i] = piece.link;
        c.copy(piece.color).offsetHSL(0, 0, (rand() - 0.5) * 0.07);
        colors[3 * i] = c.r; colors[3 * i + 1] = c.g; colors[3 * i + 2] = c.b;
      }
    });
    return { positions, linkIndex, colors };
  };

  // Key points: 8× candidates, FPS'd down to N_k.
  const candidates = sampleSurface(keypoints * 8);
  const order = farthestPoints(candidates.positions, keypoints);
  const kp = { positions: new Float32Array(keypoints * 3), linkIndex: new Int16Array(keypoints) };
  for (let i = 0; i < keypoints; i++) {
    const s = order[i];
    kp.positions[3 * i] = candidates.positions[3 * s];
    kp.positions[3 * i + 1] = candidates.positions[3 * s + 1];
    kp.positions[3 * i + 2] = candidates.positions[3 * s + 2];
    kp.linkIndex[i] = candidates.linkIndex[s];
  }

  const gs = sampleSurface(gaussians);

  // Horizontal reach of the rest pose about the root: sizes the selection ring
  // and the default spacing.
  let radius = 0;
  for (let i = 0; i < gaussians; i++) radius = Math.max(radius, Math.hypot(gs.positions[3 * i], gs.positions[3 * i + 2]));

  // A model's geometry is shared with the cached GLB, so only what was built
  // here is disposed.
  const dispose = () => {
    root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) o.geometry.dispose(); });
  };

  return { spec, root, links, setPose, keypoints: kp, gaussians: gs, radius, dispose };
}
