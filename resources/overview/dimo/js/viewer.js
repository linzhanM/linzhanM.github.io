// ─────────────────────────────────────────────────────────────────────────────
// DIMO Motion Lab — the engine (interactive.html; its config is interactive.js).
//
// Builds every object in the catalog up front (rigs.js) and shows one at a
// time: several bodies of it on the stage, each playing the motion decoded
// (decoder.js) from its own latent code on the object's 2-D sheet — the
// paper's claim in one frame, diverse motions of one object from one model.
// The rail picks the object; the panel edits the selected body. A body draws
// as its meshes or as canonical Gaussians skinned from its key points, with
// the key points and their trails as overlays.
//
// Sections:
//   1. Config, DOM, palettes
//   2. Scene: renderer, camera, lights, floor, controls, point materials
//   3. Stage: objects, bodies, layout, framing, what is drawn
//   4. Frame: pose, key points, trails
//   5. Latent state: codes, selection, resample, interpolation
//   6. Latent sheet (canvas)
//   7. Stage tags and picking
//   8. Controls: rail, dock, chips, keys
//   9. Loop, resize, deep links, start
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Config, DOM, palettes ─────────────────────────────────────────────────
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OBJECTS, CYCLE_SECONDS, LATENT_SIGMA, KEYPOINTS, GAUSSIANS } from './examples.js?v=4';
import { buildRig, cloneRig } from './rigs.js?v=3';
import { controlNames, weightsAt, decodePose, bindGaussians, skinGaussians, transformKeypoints } from './decoder.js?v=1';

const config = window.DIMO_LAB_CONFIG || {};
// The homepage thumbnail's objects in the order it plays them, as catalog
// indices; empty in the lab (see advanceCycle).
const EMBED_CYCLE = (config.embedded && config.embedCycle?.slugs || [])
  .map((slug) => OBJECTS.findIndex((o) => o.slug === slug))
  .filter((index) => index >= 0);
const $ = (id) => document.getElementById(id);
const dom = {
  wrapper: $('viewer-wrapper'),
  tags: $('stage-tags'),
  rail: $('object-rail'),
  sheet: $('latent-canvas'),
  chips: $('prompt-chips'),
  weights: $('decoder-weights'),
  code: $('z-readout'),
  selection: $('selected-name'),
  phase: $('phase-bar'),
  interpToggle: $('interp-toggle'),
  interpPanel: $('interp-panel'),
  interpA: $('interp-a'),
  interpB: $('interp-b'),
  resample: $('resample'),
  theme: $('theme-toggle'),
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const setPressed = (button, on) => {
  button.classList.toggle('is-active', on);
  button.setAttribute('aria-pressed', String(on));
};

// The project page's blue → violet → pink, as colours to mix.
const SPECTRUM = [new THREE.Color('#3B82F6'), new THREE.Color('#8B5CF6'), new THREE.Color('#FF5C8A')];
function spectrumAt(t, out = new THREE.Color()) {
  const x = clamp01(t) * 2;
  return x < 1 ? out.copy(SPECTRUM[0]).lerp(SPECTRUM[1], x) : out.copy(SPECTRUM[1]).lerp(SPECTRUM[2], x - 1);
}

// Two palettes, the project page's own: the lab opens in its hero's dark
// "latent space"; light is its paper body. CSS reads html[data-theme].
const THEMES = {
  dark: {
    background: '#0B0E14', grid: { cell: '#0B0E14', line: '#232b3d' },
    pool: ['rgba(139, 92, 246, 0.30)', 'rgba(59, 130, 246, 0.10)', 'rgba(11, 14, 20, 0)'],
    hemi: ['#cfd8ff', '#241c33'], shadow: 0.42, keypointCore: '#ffffff',
  },
  light: {
    // UniMate's light stage (--ivory-medium): the two homepage thumbnails sit
    // side by side, so the paper and its lines take that stage's beiges.
    // The cell IS the background, as the UniMate thumbnail's paper is (its
    // viewer.js paper.cell): a darker cell (#EAE6DB, until 2026-09-12) made
    // this frame read greyer than its neighbour edge to edge, and the fog,
    // which fades to the background, never seemed to arrive.
    background: '#F0EEE6', grid: { cell: '#F0EEE6', line: '#D3CCB9' },
    hemi: ['#ffffff', '#a9aebb'], shadow: 0.24, keypointCore: '#1a1033',
  },
};
// Framed and dark: the UniMate lab's dark (unimate/interactive), as its
// thumbnail takes it — the #151817 sky, also the homepage's dark plate, and
// its checker floor in place of the paper. No pool: the thumbnail is a stage,
// not the project page's hero.
if (config.embedded) {
  Object.assign(THEMES.dark, { background: '#151817', grid: { checker: ['#35312c', '#222321'], opacity: 0.88 }, pool: null });
}
let themeName = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

const settings = {
  surface: config.surface || 'mesh',   // 'mesh' | 'gaussians'
  keypoints: config.keypoints !== false,
  trajectories: config.trajectories !== false,
  paused: false,
  orbit: config.autoOrbit !== false && !reduceMotion,
};

// ── 2. Scene ─────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0x000000, 7, 16);   // range refitted per object (frameCamera)

const DEFAULT_FOV = 32;   // vertical degrees; an object's camera.fov overrides it
const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.05, 60);
// Framed on a touch screen (the homepage thumbnail on a phone), the stage draws
// lighter: a 1.5 pixel ratio and a 1024 shadow map read as 2 and 2048 do at
// 350 CSS px, for ~44% fewer pixels a frame and a quarter of the shadow memory.
const touchEmbed = config.embedded && window.matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Capped at 2 (1.5 in touchEmbed); `maxPixelRatio` lifts the cap for
// unimate/tools/render-category.mjs (--lab homepage-dimo), which lays this page
// out at a fraction of its output size so the pixel-sized trails and key points
// keep a phone's weight in a 4K frame. The latent sheet keeps its own 2 below.
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, config.maxPixelRatio || (touchEmbed ? 1.5 : 2)));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Down from 1.05 on 2026-09-12 at the owner's request: beside the UniMate
// thumbnail's direct-lit stage the shells read too bright; 0.8 then read a
// little dark, 0.88 a touch dull, so it sits just under where it began. ACES
// absorbs small steps (0.9 alone moved the shells by nothing measurable), so
// the hemisphere, the key and the environment moved with it (below, and
// rigs.js envMapIntensity).
renderer.toneMappingExposure = 0.95;
dom.wrapper.prepend(renderer.domElement);

// Image-based light for the clearcoats and metals; the directional lights
// carry the shadow and the pink and blue rims.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 0.5);
const key = new THREE.DirectionalLight('#ffffff', 1.7);
key.position.set(2.4, 4.6, 2.8);
key.castShadow = true;
key.shadow.mapSize.setScalar(touchEmbed ? 1024 : 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 14;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.04;
const rim = new THREE.DirectionalLight('#ff5c8a', 0.8);
rim.position.set(-2.2, 2.2, -3);
const fill = new THREE.DirectionalLight('#3b82f6', 0.6);
fill.position.set(-3, 1.2, 2.4);
scene.add(hemi, key, rim, fill);

// The shadow frustum is fitted to what the shown object sweeps (frameCamera):
// one wide enough for any layout spreads the map thin enough for acne.
function fitShadow(halfExtent) {
  const c = key.shadow.camera;
  c.left = c.bottom = -halfExtent;
  c.right = c.top = halfExtent;
  c.updateProjectionMatrix();
}

// Floor: graph paper (the UniMate teaser's stage, render_teaser_unimate.py), a
// soft violet pool over it in the dark theme, and a shadow catcher. The grid is
// a mip-mapped texture, not GridHelper lines, which go sub-pixel at the
// homepage thumbnail's size. It runs out to the fog, with no fade of its own:
// an ellipse fading it around the bodies was tried and removed.
// The sizes below are at floor scale 1. frameCamera scales the floor, pool and
// catcher (and the fog's margins) to each object's view, so every scene lays
// the same paper under its bodies: a cell is FLOOR_VIEW_SHARE of the view's
// half-height at the target, whether the stage holds 0.29 m ducks or 1 m arms.
// In metres the duck's cells came out 2.7 times the arm's on screen.
const FLOOR_SIZE = 24, FLOOR_CELL = 0.5, FLOOR_LINE = 0.02;   // line as a share of a cell
const FLOOR_VIEW_SHARE = 0.456;   // the UR5e thumbnail's 0.5 m cell, kept
const floorCanvas = document.createElement('canvas');
floorCanvas.width = floorCanvas.height = 256;
const floorTexture = new THREE.CanvasTexture(floorCanvas);
floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
floorTexture.repeat.setScalar(FLOOR_SIZE / FLOOR_CELL);
floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
floorTexture.colorSpace = THREE.SRGBColorSpace;
// toneMapped off: ACES would grey the paper's beiges off the homepage plate.
const floorMaterial = new THREE.MeshBasicMaterial({ map: floorTexture, transparent: true, depthWrite: false, toneMapped: false });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.002;
// Transparent planes sort by distance, which flickers between coplanar ones:
// paper first, then the pool, then the shadow on top.
floor.renderOrder = -3;
const poolCanvas = document.createElement('canvas');
poolCanvas.width = poolCanvas.height = 512;
const poolTexture = new THREE.CanvasTexture(poolCanvas);
const pool = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ map: poolTexture, transparent: true, depthWrite: false }));
pool.renderOrder = -2;
pool.rotation.x = -Math.PI / 2;
pool.position.y = 0.001;
const catcher = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial());
catcher.rotation.x = -Math.PI / 2;
catcher.receiveShadow = true;
catcher.renderOrder = -1;
scene.add(floor, pool, catcher);

function paintFloor(theme) {
  pool.visible = Boolean(theme.pool);
  if (theme.pool) {
    const ctx = poolCanvas.getContext('2d');
    const size = poolCanvas.width;
    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, theme.pool[0]);
    g.addColorStop(0.45, theme.pool[1]);
    g.addColorStop(1, theme.pool[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    poolTexture.needsUpdate = true;
  }
  // One tile: a paper cell with half a line on each edge (lines meet across
  // cells), or for a `checker` grid a 2 × 2 tile of one-cell squares;
  // `opacity` dims it over the sky.
  const fctx = floorCanvas.getContext('2d'), n = floorCanvas.width;
  if (theme.grid.checker) {
    const [base, alternate] = theme.grid.checker, h = n / 2;
    fctx.fillStyle = base;
    fctx.fillRect(0, 0, n, n);
    fctx.fillStyle = alternate;
    fctx.fillRect(0, 0, h, h); fctx.fillRect(h, h, h, h);
  } else {
    const half = Math.max(1, Math.round((n * FLOOR_LINE) / 2));
    fctx.fillStyle = theme.grid.cell;
    fctx.fillRect(0, 0, n, n);
    fctx.fillStyle = theme.grid.line;
    fctx.fillRect(0, 0, n, half); fctx.fillRect(0, n - half, n, half);
    fctx.fillRect(0, 0, half, n); fctx.fillRect(n - half, 0, half, n);
  }
  floorTexture.repeat.setScalar(FLOOR_SIZE / FLOOR_CELL / (theme.grid.checker ? 2 : 1));
  floorTexture.needsUpdate = true;
  floorMaterial.opacity = theme.grid.opacity ?? 1;
  catcher.material.opacity = theme.shadow;
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 0.9;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.autoRotateSpeed = config.orbitSpeed ?? 4 / 6;
// Framed on the homepage: drag still orbits, but the wheel is left to the
// page — with zoom off OrbitControls never preventDefaults it. Touch likewise:
// OrbitControls sets touch-action none, which traps a phone's thumb in the
// frame; pan-y hands a vertical swipe (and a pinch) back to the page and keeps
// sideways drags for orbiting.
if (config.embedded) {
  controls.enableZoom = false;
  renderer.domElement.style.touchAction = 'pan-y pinch-zoom';
}

// Gaussians: a Gaussian falloff per point, sized in world units.
const splatMaterial = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 1 }, uOpacity: { value: 0.8 } },
  vertexShader: `
    attribute float size;
    varying vec3 vColor;
    uniform float uScale;
    void main() {
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * uScale / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying vec3 vColor;
    uniform float uOpacity;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(c, c);
      if (r2 > 1.0) discard;
      gl_FragColor = vec4(vColor, exp(-r2 * 3.2) * uOpacity);
    }`,
  vertexColors: true, transparent: true, depthWrite: false,
});

// Key points: each in its own colour — the spectrum up the body, shared with
// its trail — a bright core in a soft halo, a fixed few pixels wide, pulled a
// centimetre toward the camera so they sit on the surface, not in it.
const keypointMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uSize: { value: 7 * renderer.getPixelRatio() },
    uCore: { value: new THREE.Color() },
  },
  vertexShader: `
    uniform float uSize;
    varying vec3 vColor;
    void main() {
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      mv.z += 0.012;
      gl_PointSize = uSize;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uCore;
    varying vec3 vColor;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(c, c);
      if (r2 > 1.0) discard;
      float core = 1.0 - smoothstep(0.08, 0.30, r2);
      float halo = exp(-r2 * 2.4) * 0.6;
      gl_FragColor = vec4(mix(vColor, mix(vColor, uCore, 0.55), core), max(core, halo));
    }`,
  vertexColors: true, transparent: true, depthWrite: false,
});

const TRAIL_OPACITY = 0.9;
// Plain GL lines, one device pixel wide: three's fat segments (LineSegments2
// at 1.25 CSS px) were tried on 2026-09-12 and taken out the same day at the
// owner's request.
// What trails fade into: the stage's own colour, in the renderer's linear space.
const trailFade = new THREE.Color();

function applyTheme(name) {
  themeName = name === 'light' ? 'light' : 'dark';
  const theme = THEMES[themeName];
  document.documentElement.dataset.theme = themeName;
  // Stored under the root pages' key, so the site and the lab are one
  // setting; framed, the homepage owns it.
  if (!config.embedded) {
    try { localStorage.setItem('theme', themeName); } catch (e) { /* private mode */ }
  }
  scene.background.set(theme.background);
  scene.fog.color.set(theme.background);
  trailFade.set(theme.background);
  hemi.color.set(theme.hemi[0]);
  hemi.groundColor.set(theme.hemi[1]);
  keypointMaterial.uniforms.uCore.value.set(theme.keypointCore);
  paintFloor(theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme.background;
  dom.theme.setAttribute('aria-pressed', String(themeName === 'light'));
  dom.theme.querySelector('span').textContent = themeName === 'light' ? 'Light' : 'Dark';
  drawSheet();
}

// ── 3. Stage ─────────────────────────────────────────────────────────────────
// One entry per catalog object: its base rig (sampled once), the bodies that
// share it. `shown` is the object on stage.
const stage = { objects: [], shown: null, ready: false };
let selected = { o: 0, i: 0 };

function makeBody(obj, i, rig) {
  const color = spectrumAt(obj.n > 1 ? i / (obj.n - 1) : 0.5);

  const splatGeometry = new THREE.BufferGeometry();
  const splatPositions = new THREE.BufferAttribute(new Float32Array(GAUSSIANS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const sizes = new Float32Array(GAUSSIANS);
  for (let k = 0; k < GAUSSIANS; k++) sizes[k] = 0.022 * (0.75 + 0.5 * ((k * 0.6180339) % 1));
  splatGeometry.setAttribute('position', splatPositions);
  splatGeometry.setAttribute('color', new THREE.BufferAttribute(rig.gaussians.colors, 3));
  splatGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  const splats = new THREE.Points(splatGeometry, splatMaterial);
  splats.frustumCulled = false;

  const pointGeometry = new THREE.BufferGeometry();
  const pointPositions = new THREE.BufferAttribute(new Float32Array(KEYPOINTS * 3), 3).setUsage(THREE.DynamicDrawUsage);
  pointGeometry.setAttribute('position', pointPositions);
  pointGeometry.setAttribute('color', new THREE.BufferAttribute(obj.keypointColors, 3));
  const points = new THREE.Points(pointGeometry, keypointMaterial);
  points.frustumCulled = false;

  // Trails: the last `trailFrames` samples of each traced key point's period,
  // re-cut every frame behind the live point (cutTrail) from a loop sampled
  // once per latent change (sampleTrails).
  const trailCount = Math.min(config.trailCount ?? 48, KEYPOINTS);
  const trailSamples = config.trailSamples ?? 48;
  const trailFrames = Math.max(2, Math.min(config.trailFrames ?? 14, trailSamples));
  const segments = trailCount * (trailFrames - 1);
  const trailGeometry = new THREE.BufferGeometry();
  const trailPositions = new THREE.BufferAttribute(new Float32Array(segments * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const trailColors = new THREE.BufferAttribute(new Float32Array(segments * 6), 3).setUsage(THREE.DynamicDrawUsage);
  trailGeometry.setAttribute('position', trailPositions);
  trailGeometry.setAttribute('color', trailColors);
  const trails = new THREE.LineSegments(trailGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: TRAIL_OPACITY }));
  trails.frustumCulled = false;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(obj.spec.ringRadius ?? Math.max(0.35, rig.radius * 0.62), 0.006, 8, 72),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  );
  ring.rotation.x = -Math.PI / 2;

  const tag = document.createElement('button');
  tag.type = 'button';
  tag.className = 'tag';
  tag.style.setProperty('--c', '#' + color.getHexString());
  tag.addEventListener('click', () => select(obj.index, i));
  dom.tags.append(tag);

  const meshes = [];
  rig.root.traverse((o) => { if (o.isMesh) { meshes.push(o); o.userData.body = { o: obj.index, i }; } });
  scene.add(rig.root, splats, points, trails, ring);

  return {
    index: i, rig, color, meshes, tag, ring,
    spot: new THREE.Vector3(),
    code: [0.5, 0.5], weights: [],
    E: new Float32Array(rig.links.length * 16),
    splats, splatPositions, points, pointPositions,
    trails, trailPositions, trailColors, trailCount, trailSamples, trailFrames,
    trailLoop: new Float32Array(trailCount * 3 * trailSamples),
    trailScratch: new Float32Array(KEYPOINTS * 3), trailDirty: true, trailTimer: 0,
    top: 1,   // highest point this body sweeps (frameCamera); its tag stands on it
  };
}

// One colour per key point, the spectrum climbing the body.
function keypointColorsByHeight(positions) {
  const n = positions.length / 3;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < n; k++) { lo = Math.min(lo, positions[3 * k + 1]); hi = Math.max(hi, positions[3 * k + 1]); }
  const colors = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    spectrumAt(hi > lo ? (positions[3 * k + 1] - lo) / (hi - lo) : 0.5, c);
    colors.set([c.r, c.g, c.b], 3 * k);
  }
  return colors;
}

async function buildStage(openIndex) {
  dom.wrapper.classList.add('is-loading');
  // The homepage thumbnail has no rail, so it builds only what it shows: the
  // object it opened on and the ones it cycles through. Each model is
  // megabytes, and the page it sits in should not fetch the rest.
  const bases = await Promise.all(OBJECTS.map((spec, index) => (config.embedded && index !== openIndex && !EMBED_CYCLE.includes(index))
    ? null
    : buildRig(spec, { keypoints: KEYPOINTS, gaussians: GAUSSIANS })));
  dom.wrapper.classList.remove('is-loading');

  stage.objects = OBJECTS.map((spec, index) => {
    const base = bases[index];
    if (!base) return null;
    const n = Math.max(1, spec.instances || 1);
    const spacing = spec.spacing || base.radius * 2.4;
    const obj = {
      index, spec, base, n, spacing,
      slots: rankSlots(spec.ranks, n),
      depth: spec.depth || spacing * 1.1,
      stagger: spec.stagger || 0,
      cycle: spec.cycleSeconds ?? CYCLE_SECONDS,
      controls: controlNames(spec),
      binding: bindGaussians(base.gaussians.positions, base.keypoints.positions, base.keypoints.linkIndex, 6),
      keypointColors: keypointColorsByHeight(base.keypoints.positions),
      bodies: [],
    };
    for (let i = 0; i < n; i++) obj.bodies.push(makeBody(obj, i, i === 0 ? base : cloneRig(base)));
    // Open on the basis itself: the bodies stand on the first anchors, so the
    // stage names the motions before anyone samples.
    obj.bodies.forEach((body, i) => setCode(obj, body, spec.motions[i % spec.motions.length].z, { quiet: true }));
    return obj;
  });
  stage.ready = true;
  showObject(openIndex, { force: true });
}

// One object on stage at a time: each category is its own scene.
function showObject(index, { force = false } = {}) {
  const obj = stage.objects[index];
  if (!obj || (obj === stage.shown && !force)) return;
  stage.shown = obj;
  shownSince = elapsed;   // every object opens at its own t = 0
  layout(obj);
  syncDrawn();
  frameCamera();
  select(index, 0, { force: true });
  dom.rail.querySelectorAll('button').forEach((b, i) => setPressed(b, i === index));
  history.replaceState(null, '', `#${obj.spec.slug}`);
}

// Each body's rank and place in it. `ranks` counts bodies per rank, front rank
// first (default: one rank of all); every rank is centred on its own, so a
// shorter rank behind a longer one stands in its gaps.
function rankSlots(ranks, n) {
  const counts = ranks && ranks.reduce((a, b) => a + b, 0) === n ? ranks : [n];
  return counts.flatMap((count, rank) => Array.from({ length: count }, (_, k) => ({ rank, k, count, ranks: counts.length })));
}

// The object's bodies in their ranks, centred on the stage, front rank at +z.
// With `stagger`, neighbouring ranks sit that fraction of a step apart sideways.
function layout(obj) {
  obj.bodies.forEach((body, i) => {
    const { rank, k, count, ranks } = obj.slots[i];
    const shift = ranks > 1 ? (rank % 2 ? 0.5 : -0.5) * obj.stagger : 0;
    body.spot.set((k - (count - 1) / 2 + shift) * obj.spacing, 0, ((ranks - 1) / 2 - rank) * obj.depth);
    body.rig.root.position.copy(body.spot);
    body.ring.position.set(body.spot.x, 0.004, body.spot.z);
    body.trailDirty = true;   // trails are sampled in world space
  });
}

// Frame the shown object from what its bodies actually sweep: every key point
// over one period of each body's motion, plus the corners of any scenery,
// seen from the object's view (elevation, azimuth, fov). With the direction
// fixed, each point's nearest allowed camera distance has a closed form, and
// the camera stands at the largest: the closest view in which every point
// clears the frame's insets (config: the lab's heads and dock; a hair in the
// homepage thumbnail). In the lab each body's name tag must clear them too.
// The view is then re-centred on what it sees and fitted again. Orbiting away
// from it may crop; the thumbnail does not orbit on its own.
const FIT_PHASES = 24;
const TAG_LIFT = 0.1;     // a tag's anchor above its body's top (world)
const TAG_SLACK = 40;     // px of room for a tag's name to grow ("… blend")

function sweptCloud(obj) {
  const { positions, linkIndex } = obj.base.keypoints;
  const corners = [];
  const bounds = new THREE.Box3();
  for (const body of obj.bodies) {
    body.rig.root.updateMatrixWorld(true);
    for (const mesh of body.meshes) {
      if (!mesh.userData.scenery) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      bounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      for (let c = 0; c < 8; c++) {
        corners.push(c & 1 ? bounds.max.x : bounds.min.x, c & 2 ? bounds.max.y : bounds.min.y, c & 4 ? bounds.max.z : bounds.min.z);
      }
    }
  }
  const out = new Float32Array(positions.length);
  const cloud = new Float32Array(obj.bodies.length * FIT_PHASES * positions.length + corners.length);
  let at = 0;
  for (const body of obj.bodies) {
    body.top = -Infinity;
    for (let f = 0; f < FIT_PHASES; f++) {
      body.rig.setPose(decodePose(obj.spec, obj.controls, body.weights, f / FIT_PHASES));
      linkTransforms(body);
      transformKeypoints(positions, linkIndex, body.E, out);
      for (let i = 1; i < out.length; i += 3) body.top = Math.max(body.top, out[i]);
      cloud.set(out, at);
      at += out.length;
    }
  }
  cloud.set(corners, at);
  return cloud;
}

function frameCamera() {
  const obj = stage.shown;
  const w = dom.wrapper.clientWidth, h = dom.wrapper.clientHeight;
  if (!obj || !w || !h) return;
  const cloud = sweptCloud(obj);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < cloud.length; i += 3) {
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], cloud[i + a]); hi[a] = Math.max(hi[a], cloud[i + a]); }
  }
  fitShadow(Math.max(-lo[0], hi[0], -lo[2], hi[2]) + 0.6);

  // The object's lens, then the view's axes: `back` points from the target
  // toward the camera. The cloud goes into them once, about the swept bounds'
  // centre.
  const { elevation, fov = DEFAULT_FOV } = obj.spec.camera;
  const azimuth = config.cameraAzimuth ?? obj.spec.camera.azimuth;
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    scaleSplats();
  }
  const back = new THREE.Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
  const right = new THREE.Vector3(0, 1, 0).cross(back).normalize();
  const up = new THREE.Vector3().crossVectors(back, right);
  const target = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  const view = new Float32Array(cloud.length);
  for (let i = 0; i < cloud.length; i += 3) {
    const x = cloud[i] - target.x, y = cloud[i + 1] - target.y, z = cloud[i + 2] - target.z;
    view[i] = x * right.x + z * right.z;
    view[i + 1] = x * up.x + y * up.y + z * up.z;
    view[i + 2] = x * back.x + y * back.y + z * back.z;
  }

  // The allowed box as slopes (sideways over depth) from the lens axis.
  const inset = (config.embedded ? config.embedInsets : config.frameInsets) || {};
  const th = Math.tan(camera.fov * Math.PI / 360), tw = th * camera.aspect;
  const box = {
    x0: (-1 + 2 * (inset.left ?? 0) / w) * tw, x1: (1 - 2 * (inset.right ?? 0) / w) * tw,
    y0: (-1 + 2 * (inset.bottom ?? 0) / h) * th, y1: (1 - 2 * (inset.top ?? 0) / h) * th,
  };
  // Each tag's anchor in view coordinates, and its chip (centred above the
  // anchor) as slopes: a fixed pixel size is a fixed slope at any depth. Below
  // the lab's 720px breakpoint a chip is a third of the stage wide, so there
  // only its height is fitted; fitting its width would shrink the arms to a
  // strip, and a centred chip on a fitted anchor overhangs a side by at most half.
  const narrow = w <= 720;
  const tags = config.embedded ? [] : obj.bodies.map((body) => {
    const x = body.spot.x - target.x, y = body.top + TAG_LIFT - target.y, z = body.spot.z - target.z;
    return {
      x: x * right.x + z * right.z, y: x * up.x + y * up.y + z * up.z, z: x * back.x + y * back.y + z * back.z,
      half: narrow ? 0 : (((body.tag.offsetWidth || 96) + TAG_SLACK) / w) * tw,
      rise: ((body.tag.offsetHeight || 26) / h) * 2 * th,
    };
  });
  // Closest distance with the target shifted (sx, sy) along right and up: a
  // point at depth d − z stays inside while |offset| / depth is within its edge.
  const closest = (sx, sy) => {
    let d = 0;
    for (let i = 0; i < view.length; i += 3) {
      const x = view[i] - sx, y = view[i + 1] - sy, z = view[i + 2];
      d = Math.max(d, z + camera.near, z + x / (x > 0 ? box.x1 : box.x0), z + y / (y > 0 ? box.y1 : box.y0));
    }
    for (const t of tags) {
      const x = t.x - sx, y = t.y - sy;
      d = Math.max(d, t.z + camera.near,
        t.z + x / (x > 0 ? box.x1 - t.half : box.x0 + t.half),
        t.z + y / (y > 0 ? box.y1 - t.rise : box.y0));
    }
    return d;
  };
  let sx = 0, sy = 0, d = closest(sx, sy);
  for (let pass = 0; pass < 3; pass++) {
    const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    for (let i = 0; i < view.length; i += 3) {
      const depth = d - view[i + 2];
      const x = (view[i] - sx) / depth, y = (view[i + 1] - sy) / depth;
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x);
      b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }
    for (const t of tags) {
      const depth = d - t.z;
      const x = (t.x - sx) / depth, y = (t.y - sy) / depth;
      b.x0 = Math.min(b.x0, x - t.half); b.x1 = Math.max(b.x1, x + t.half);
      b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y + t.rise);
    }
    sx += ((b.x0 + b.x1 - box.x0 - box.x1) / 2) * d;
    sy += ((b.y0 + b.y1 - box.y0 - box.y1) / 2) * d;
    d = closest(sx, sy);
  }
  target.addScaledVector(right, sx).addScaledVector(up, sy);
  controls.target.copy(target);
  controls.maxDistance = Math.max(controls.maxDistance, d);
  // The floor in view units (see FLOOR_VIEW_SHARE): the same cells on screen,
  // and the same run of them out to the fog, for every object.
  const floorScale = (d * Math.tan(camera.fov * Math.PI / 360) * FLOOR_VIEW_SHARE) / FLOOR_CELL;
  for (const plane of [floor, pool, catcher]) plane.scale.setScalar(floorScale);
  // Fog starts past the farthest body, so only the floor fades out.
  let farthest = 0;
  for (let i = 2; i < view.length; i += 3) farthest = Math.max(farthest, d - view[i]);
  scene.fog.near = farthest + 0.5 * floorScale;
  scene.fog.far = farthest + 9 * floorScale;
  camera.position.copy(target).addScaledVector(back, d);
  controls.update();
}

// What every body draws, from the settings and whether its object is shown.
// Mesh mode draws colour; Gaussian mode keeps only the meshes' shadow
// (colorWrite off keeps the shadow pass). Materials are shared across bodies.
function syncDrawn() {
  const gaussians = settings.surface === 'gaussians';
  for (const obj of stage.objects) {
    if (!obj) continue;   // not built (the homepage thumbnail builds one)
    const shown = obj === stage.shown;
    for (const link of obj.base.links) {
      for (const { mesh } of link.meshes) {
        if (mesh.userData.scenery) continue;
        mesh.material.colorWrite = !gaussians;
        mesh.material.depthWrite = !gaussians;
        mesh.material.needsUpdate = true;
      }
    }
    for (const body of obj.bodies) {
      body.rig.root.visible = shown;
      body.splats.visible = shown && gaussians;
      body.points.visible = shown && settings.keypoints;
      body.trails.visible = shown && settings.trajectories;
      body.tag.hidden = !shown;
      if (shown && settings.trajectories && body.trailDirty) sampleTrails(obj, body);
    }
  }
  document.querySelectorAll('[data-surface]').forEach((b) => setPressed(b, b.dataset.surface === settings.surface));
  document.querySelectorAll('[data-overlay]').forEach((b) => setPressed(b, settings[b.dataset.overlay]));
}

// ── 4. Frame ─────────────────────────────────────────────────────────────────
// E_l = current · canonical⁻¹ per link, packed for the skinning loops.
const linkMatrix = new THREE.Matrix4();
function linkTransforms(body) {
  const { links } = body.rig;
  for (let l = 0; l < links.length; l++) {
    linkMatrix.multiplyMatrices(links[l].group.matrixWorld, links[l].canonicalInverse);
    body.E.set(linkMatrix.elements, l * 16);
  }
}

function poseBody(obj, body, u) {
  body.rig.setPose(decodePose(obj.spec, obj.controls, body.weights, u));
  linkTransforms(body);
  if (settings.surface === 'gaussians') {
    skinGaussians(obj.base.gaussians.positions, obj.binding, body.E, body.splatPositions.array);
    body.splatPositions.needsUpdate = true;
  }
  if (settings.keypoints || settings.trajectories) {
    transformKeypoints(obj.base.keypoints.positions, obj.base.keypoints.linkIndex, body.E, body.pointPositions.array);
    body.pointPositions.needsUpdate = true;
  }
  if (settings.trajectories && !body.trailDirty) cutTrail(obj, body, u);
}

// From each traced key point's live position back through the previous
// `trailFrames − 1` samples of its loop, the colour fading with age.
function cutTrail(obj, body, u) {
  const { trailCount, trailSamples, trailFrames, trailLoop: loop } = body;
  const live = body.pointPositions.array;
  const pos = body.trailPositions.array, col = body.trailColors.array;
  const kc = obj.keypointColors;
  const head = Math.floor(u * trailSamples);
  const fade = [trailFade.r, trailFade.g, trailFade.b];
  let i = 0;
  for (let k = 0; k < trailCount; k++) {
    let ax = live[3 * k], ay = live[3 * k + 1], az = live[3 * k + 2];
    for (let j = 1; j < trailFrames; j++) {
      const s = ((head - j) % trailSamples + trailSamples) % trailSamples;
      const b = (s * trailCount + k) * 3;
      const ageA = 1 - (j - 1) / trailFrames, ageB = 1 - j / trailFrames;
      pos[i] = ax; pos[i + 1] = ay; pos[i + 2] = az;
      pos[i + 3] = loop[b]; pos[i + 4] = loop[b + 1]; pos[i + 5] = loop[b + 2];
      for (let c = 0; c < 3; c++) {
        col[i + c] = fade[c] + (kc[3 * k + c] - fade[c]) * ageA;
        col[i + 3 + c] = fade[c] + (kc[3 * k + c] - fade[c]) * ageB;
      }
      ax = loop[b]; ay = loop[b + 1]; az = loop[b + 2];
      i += 6;
    }
  }
  body.trailPositions.needsUpdate = true;
  body.trailColors.needsUpdate = true;
}

// Sample the traced key points over one period at the body's code, for
// cutTrail to cut from. Runs once per code change or relayout.
function sampleTrails(obj, body) {
  if (!settings.trajectories || obj !== stage.shown) { body.trailDirty = true; return; }
  const { rig, E, trailCount, trailSamples, trailScratch, trailLoop } = body;
  for (let s = 0; s < trailSamples; s++) {
    rig.setPose(decodePose(obj.spec, obj.controls, body.weights, s / trailSamples));
    linkTransforms(body);
    transformKeypoints(obj.base.keypoints.positions, obj.base.keypoints.linkIndex, E, trailScratch);
    trailLoop.set(trailScratch.subarray(0, trailCount * 3), s * trailCount * 3);
  }
  body.trailDirty = false;
}
// While the sheet is dragged, at most one resample every 90 ms per body.
function scheduleTrails(obj, body) {
  body.trailDirty = true;
  if (body.trailTimer) return;
  body.trailTimer = setTimeout(() => { body.trailTimer = 0; sampleTrails(obj, body); }, 90);
}

// ── 5. Latent state ──────────────────────────────────────────────────────────
const latent = { interpolating: false, a: 0, b: 1 };
const currentObject = () => stage.objects[selected.o];
const currentBody = () => currentObject()?.bodies[selected.i];

function setCode(obj, body, code, { quiet = false } = {}) {
  body.code = [clamp01(code[0]), clamp01(code[1])];
  body.weights = weightsAt(body.code, obj.spec.motions, LATENT_SIGMA);
  if (quiet) sampleTrails(obj, body); else scheduleTrails(obj, body);
  const lead = leading(obj, body);
  body.tag.textContent = lead.weight >= 0.6 ? lead.name : `${lead.name} blend`;
  if (obj.index === selected.o) {
    if (body.index === selected.i) renderSelection();
    drawSheet();
  }
}

// The motion with the most weight at a body's code.
function leading(obj, body) {
  let best = 0;
  body.weights.forEach((w, i) => { if (w > body.weights[best]) best = i; });
  return { index: best, name: obj.spec.motions[best].name, weight: body.weights[best] || 0 };
}

// Select a body. The panel is its object's — sheet, chips, weights — and is
// rebuilt when the object changes.
function select(o, i, { force = false } = {}) {
  if (!stage.ready) return;
  const objectChanged = force || o !== selected.o;
  selected = { o, i: Math.max(0, Math.min(stage.objects[o].bodies.length - 1, i)) };
  if (objectChanged) {
    setInterpolating(false);
    buildMotionLists(currentObject().spec);
  }
  for (const obj of stage.objects) {
    if (!obj) continue;
    obj.bodies.forEach((body, k) => {
      const on = obj.index === selected.o && k === selected.i;
      body.ring.visible = on && obj === stage.shown && !config.embedded;
      body.tag.classList.toggle('is-selected', on);
      body.tag.setAttribute('aria-pressed', String(on));
    });
  }
  renderSelection();
  drawSheet();
}

// Interpolate: the shown object's bodies become the paper's interpolation
// figure, even steps of t from motion A to motion B. Resample is off meanwhile.
function setInterpolating(on) {
  if (latent.interpolating === on) return;
  latent.interpolating = on;
  setPressed(dom.interpToggle, on);
  dom.interpPanel.hidden = !on;
  dom.resample.disabled = on;
  if (on) applyInterpolation(); else drawSheet();
}
function applyInterpolation() {
  const obj = currentObject();
  const a = obj.spec.motions[latent.a].z, b = obj.spec.motions[latent.b].z;
  const n = obj.bodies.length;
  obj.bodies.forEach((body, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    setCode(obj, body, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  });
}

// Resample: every shown body a new code, uniform in the sheet, a step in from
// the edge where every weight is small.
function resample() {
  setInterpolating(false);
  const obj = stage.shown;
  for (const body of obj.bodies) setCode(obj, body, [0.08 + Math.random() * 0.84, 0.08 + Math.random() * 0.84]);
  dom.resample.classList.add('is-flash');
  setTimeout(() => dom.resample.classList.remove('is-flash'), 240);
}

function renderSelection() {
  const obj = currentObject(), body = currentBody();
  if (!body) return;
  const lead = leading(obj, body).index;
  const color = '#' + body.color.getHexString();
  dom.weights.querySelectorAll('li').forEach((li, i) => {
    const w = body.weights[i] || 0;
    li.style.setProperty('--w', w.toFixed(3));
    li.style.setProperty('--c', color);
    li.querySelector('.w-value').textContent = w.toFixed(2);
    li.classList.toggle('is-lead', i === lead);
  });
  dom.code.textContent = `z = (${body.code[0].toFixed(2)}, ${body.code[1].toFixed(2)})`;
  dom.selection.textContent = `${obj.spec.label}, body ${selected.i + 1} of ${obj.bodies.length}`;
  dom.selection.style.setProperty('--c', color);
  dom.chips.querySelectorAll('button').forEach((chip, i) => {
    const m = obj.spec.motions[i];
    chip.classList.toggle('is-active', Math.hypot(m.z[0] - body.code[0], m.z[1] - body.code[1]) < 0.035);
    chip.style.setProperty('--c', color);
  });
}

// ── 6. Latent sheet ──────────────────────────────────────────────────────────
// The unit square leaned into a parallelogram so it reads as a surface seen at
// an angle, like the manifold in the project page's hero.
const sheetContext = dom.sheet.getContext('2d');
const sheet = { w: 0, h: 0, dpr: 1 };
const SHEET_PAD = 24, SHEET_SKEW = 0.14;

function sheetFrame() {
  const skew = SHEET_SKEW * sheet.w;
  return { x0: SHEET_PAD + skew / 2, y0: SHEET_PAD, w: sheet.w - 2 * SHEET_PAD - skew, h: sheet.h - 2 * SHEET_PAD - 6, skew };
}
function toSheet(z) {
  const f = sheetFrame();
  return [f.x0 + z[0] * f.w + (z[1] - 0.5) * f.skew, f.y0 + (1 - z[1]) * f.h];
}
function fromSheet(px, py) {
  const f = sheetFrame();
  const zy = 1 - (py - f.y0) / f.h;
  return [(px - f.x0 - (zy - 0.5) * f.skew) / f.w, zy];
}
function sizeSheet() {
  const r = dom.sheet.getBoundingClientRect();
  if (!r.width) return;
  Object.assign(sheet, { w: r.width, h: r.height, dpr: Math.min(window.devicePixelRatio || 1, 2) });
  dom.sheet.width = Math.round(r.width * sheet.dpr);
  dom.sheet.height = Math.round(r.height * sheet.dpr);
  drawSheet();
}

function drawSheet() {
  if (!stage.ready || !sheet.w) return;
  const obj = currentObject();
  const ctx = sheetContext;
  const light = themeName === 'light';
  const { motions } = obj.spec;
  ctx.setTransform(sheet.dpr, 0, 0, sheet.dpr, 0, 0);
  ctx.clearRect(0, 0, sheet.w, sheet.h);

  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(toSheet);
  const [cx, cy] = toSheet([0.5, 0.5]);
  const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, sheet.w * 0.62);
  glow.addColorStop(0, light ? 'rgba(139, 92, 246, 0.16)' : 'rgba(139, 92, 246, 0.30)');
  glow.addColorStop(0.6, 'rgba(139, 92, 246, 0.06)');
  glow.addColorStop(1, 'rgba(139, 92, 246, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, sheet.w, sheet.h);

  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  const fillGradient = ctx.createLinearGradient(corners[3][0], corners[3][1], corners[1][0], corners[1][1]);
  fillGradient.addColorStop(0, light ? 'rgba(59, 130, 246, 0.16)' : 'rgba(59, 130, 246, 0.26)');
  fillGradient.addColorStop(0.5, light ? 'rgba(139, 92, 246, 0.14)' : 'rgba(139, 92, 246, 0.20)');
  fillGradient.addColorStop(1, light ? 'rgba(255, 92, 138, 0.12)' : 'rgba(255, 92, 138, 0.16)');
  ctx.fillStyle = fillGradient;
  ctx.fill();
  ctx.strokeStyle = light ? 'rgba(110, 96, 190, 0.45)' : 'rgba(186, 176, 255, 0.42)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.strokeStyle = light ? 'rgba(60, 64, 90, 0.16)' : 'rgba(190, 198, 224, 0.2)';
  ctx.lineWidth = 0.8;
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    for (const [from, to] of [[[t, 0], [t, 1]], [[0, t], [1, t]]]) {
      const [ax, ay] = toSheet(from), [bx, by] = toSheet(to);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }

  const ink = light ? 'rgba(14, 19, 32, 0.78)' : 'rgba(244, 246, 250, 0.82)';
  if (latent.interpolating) {
    const [ax, ay] = toSheet(motions[latent.a].z), [bx, by] = toSheet(motions[latent.b].z);
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = light ? 'rgba(14, 19, 32, 0.55)' : 'rgba(244, 246, 250, 0.6)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.restore();
  }

  // Anchors: hollow marks with their motion's name.
  ctx.font = '500 10.5px "Space Grotesk", system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const m of motions) {
    const [x, y] = toSheet(m.z);
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = THEMES[themeName].background;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = light ? 'rgba(14, 19, 32, 0.62)' : 'rgba(174, 182, 196, 0.92)';
    ctx.fillText(m.name, x, y + 15);
  }

  // The bodies' codes, the selected one ringed.
  obj.bodies.forEach((body, i) => {
    const [x, y] = toSheet(body.code);
    const color = '#' + body.color.getHexString();
    if (i === selected.i) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y, 9.5, 0, Math.PI * 2);
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.fill();
  });
}

// Press a body's dot to select it; press near an anchor to snap the selected
// body onto that motion; drag anywhere to move its code.
{
  let dragging = false;
  const place = (px, py, snap) => {
    const obj = currentObject();
    let z = fromSheet(px, py);
    if (snap) {
      const near = obj.spec.motions.find((m) => {
        const [mx, my] = toSheet(m.z);
        return Math.hypot(mx - px, my - py) < 11;
      });
      if (near) z = near.z;
    }
    setInterpolating(false);
    setCode(obj, currentBody(), z);
  };
  const local = (e) => {
    const r = dom.sheet.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  dom.sheet.addEventListener('pointerdown', (e) => {
    if (!stage.ready) return;
    const [px, py] = local(e);
    let hit = -1, hitDistance = 12;
    currentObject().bodies.forEach((body, i) => {
      const [x, y] = toSheet(body.code);
      const d = Math.hypot(x - px, y - py);
      if (d < hitDistance) { hitDistance = d; hit = i; }
    });
    dragging = true;
    dom.sheet.setPointerCapture(e.pointerId);
    if (hit >= 0) select(selected.o, hit);
    else place(px, py, true);
  });
  dom.sheet.addEventListener('pointermove', (e) => { if (dragging) place(...local(e), false); });
  const stop = () => { dragging = false; };
  dom.sheet.addEventListener('pointerup', stop);
  dom.sheet.addEventListener('pointercancel', stop);
}

// ── 7. Stage tags and picking ────────────────────────────────────────────────
const tagPoint = new THREE.Vector3();
function placeTags() {
  const obj = stage.shown;
  if (!obj) return;
  const w = dom.wrapper.clientWidth, h = dom.wrapper.clientHeight;
  for (const body of obj.bodies) {
    // Just above the highest point this body sweeps (frameCamera).
    tagPoint.set(body.spot.x, body.top + TAG_LIFT, body.spot.z).project(camera);
    const behind = tagPoint.z > 1;
    body.tag.hidden = behind;
    if (behind) continue;
    const x = (tagPoint.x * 0.5 + 0.5) * w, y = (0.5 - tagPoint.y * 0.5) * h;
    body.tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

// A click on a body (a quick press that did not orbit) selects it.
{
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || !stage.shown) return;
    const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5 && performance.now() - down.t < 500;
    down = null;
    if (!click) return;
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(stage.shown.bodies.flatMap((body) => body.meshes), false)[0];
    if (hit) select(hit.object.userData.body.o, hit.object.userData.body.i);
  });
}

// ── 8. Controls ──────────────────────────────────────────────────────────────
// The panel's per-motion lists: prompt chips, weight bars, interpolation ends.
function buildMotionLists(spec) {
  dom.chips.replaceChildren();
  dom.weights.replaceChildren();
  for (const m of spec.motions) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = m.caption;
    chip.addEventListener('click', () => { setInterpolating(false); setCode(currentObject(), currentBody(), m.z); });
    dom.chips.append(chip);

    const li = document.createElement('li');
    li.innerHTML = '<span class="w-name"></span><span class="w-bar"><i></i></span><span class="w-value">0.00</span>';
    li.querySelector('.w-name').textContent = m.name;
    dom.weights.append(li);
  }
  for (const list of [dom.interpA, dom.interpB]) {
    list.replaceChildren(...spec.motions.map((m, i) => new Option(m.name, String(i))));
  }
  latent.a = 0;
  latent.b = Math.min(1, spec.motions.length - 1);
  dom.interpA.value = String(latent.a);
  dom.interpB.value = String(latent.b);
}

OBJECTS.forEach((spec, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = spec.label;
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => showObject(i));
  dom.rail.append(b);
});

dom.interpToggle.addEventListener('click', () => setInterpolating(!latent.interpolating));
dom.interpA.addEventListener('change', () => { latent.a = Number(dom.interpA.value); if (latent.interpolating) applyInterpolation(); });
dom.interpB.addEventListener('change', () => { latent.b = Number(dom.interpB.value); if (latent.interpolating) applyInterpolation(); });
dom.resample.addEventListener('click', resample);
dom.theme.addEventListener('click', () => applyTheme(themeName === 'dark' ? 'light' : 'dark'));

const setSurface = (surface) => { settings.surface = surface; syncDrawn(); };
const toggleOverlay = (name) => { settings[name] = !settings[name]; syncDrawn(); };
document.querySelectorAll('[data-surface]').forEach((b) => b.addEventListener('click', () => setSurface(b.dataset.surface)));
document.querySelectorAll('[data-overlay]').forEach((b) => b.addEventListener('click', () => toggleOverlay(b.dataset.overlay)));

const dockToggles = {
  paused: document.querySelector('[data-toggle="paused"]'),
  orbit: document.querySelector('[data-toggle="orbit"]'),
};
function setToggle(name, on) {
  settings[name] = on;
  setPressed(dockToggles[name], on);
  if (name === 'orbit') controls.autoRotate = on;
  if (name === 'paused') dockToggles.paused.querySelector('span').textContent = on ? 'Play' : 'Pause';
}
dockToggles.paused.addEventListener('click', () => setToggle('paused', !settings.paused));
dockToggles.orbit.addEventListener('click', () => setToggle('orbit', !settings.orbit));
document.querySelector('[data-action="reset"]').addEventListener('click', frameCamera);
setToggle('orbit', settings.orbit);

window.addEventListener('keydown', (event) => {
  if (config.embedded || !stage.ready) return;   // framed: no dock or panel to reflect a key
  if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const n = currentObject().bodies.length;
  switch (event.code) {
    case 'Space': event.preventDefault(); setToggle('paused', !settings.paused); break;
    case 'KeyO': setToggle('orbit', !settings.orbit); break;
    case 'KeyR': frameCamera(); break;
    case 'KeyS': if (!latent.interpolating) resample(); break;
    case 'KeyI': setInterpolating(!latent.interpolating); break;
    case 'KeyG': setSurface(settings.surface === 'mesh' ? 'gaussians' : 'mesh'); break;
    case 'KeyK': toggleOverlay('keypoints'); break;
    case 'KeyT': toggleOverlay('trajectories'); break;
    case 'KeyL': applyTheme(themeName === 'dark' ? 'light' : 'dark'); break;
    case 'Tab': event.preventDefault(); select(selected.o, (selected.i + (event.shiftKey ? -1 : 1) + n) % n); break;
    default:
      if (/^Digit[1-9]$/.test(event.code)) showObject(Number(event.code.slice(5)) - 1);
  }
});

// ── 9. Loop, resize, deep links, start ───────────────────────────────────────
// Splats are sized in pixels, so their scale follows the lens and the canvas.
function scaleSplats() {
  splatMaterial.uniforms.uScale.value = (dom.wrapper.clientHeight * renderer.getPixelRatio()) / (2 * Math.tan(camera.fov * Math.PI / 360));
}

let lastHeight = 0;
function resize() {
  const w = dom.wrapper.clientWidth, h = dom.wrapper.clientHeight;
  if (!w || !h) return;
  const aspectBefore = camera.aspect;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  scaleSplats();
  // The insets are pixels, so any size change can move the fit.
  if (Math.abs(aspectBefore - camera.aspect) > 0.001 || h !== lastHeight) frameCamera();
  lastHeight = h;
}
new ResizeObserver(resize).observe(dom.wrapper);
new ResizeObserver(sizeSheet).observe(dom.sheet);

const clock = new THREE.Clock();
const MAX_FRAME_DELTA = 1 / 20;   // a stalled tab resumes where it was, not a jump ahead
let elapsed = 0;
let shownSince = 0;   // `elapsed` when the object on stage opened

// The homepage thumbnail takes its objects in turn (config.embedCycle): each
// plays `loops` whole periods, so the cut lands where its clips already cut
// back to their first frame, and the canvas fades out over the last
// FADE_SECONDS and back in once the next has opened. Timed on `elapsed`, so a
// frame scrolled off screen holds its place in the cycle. Reduced motion cuts.
const FADE_SECONDS = 0.18;   // matches the canvas transition in interactive.css
function advanceCycle(obj, t) {
  const hold = (config.embedCycle.loops || 1) * obj.cycle;
  dom.wrapper.classList.toggle('is-switching', !reduceMotion && t >= hold - FADE_SECONDS);
  if (t < hold) return;
  showObject(EMBED_CYCLE[(EMBED_CYCLE.indexOf(obj.index) + 1) % EMBED_CYCLE.length]);
  dom.wrapper.classList.remove('is-switching');
}

// Framed on the homepage, render only while the frame is on screen: a
// same-origin iframe's rAF is not throttled for being scrolled away, and the
// implicit root of an observer inside an iframe is the top-level viewport.
let onScreen = true;
if (config.embedded && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }, { rootMargin: '120px 0px' })
    .observe(renderer.domElement);
}
(function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
  if (!onScreen) return;   // the clock was read, so nothing accumulates
  if (!settings.paused) elapsed += dt;
  const obj = stage.shown;
  if (obj) {
    // Each object keeps its own period: a UR5e clip and a hand-authored ball
    // loop run at different lengths.
    const t = elapsed - shownSince;
    const u = (t / obj.cycle) % 1;
    for (const body of obj.bodies) poseBody(obj, body, u);
    dom.phase.style.setProperty('--u', u.toFixed(4));
    if (EMBED_CYCLE.length > 1) advanceCycle(obj, t);
  }
  controls.update(dt);
  renderer.render(scene, camera);
  placeTags();
})();

// #ur5e opens on that object; no hash, or an unknown one, opens on the first.
const hashIndex = () => OBJECTS.findIndex((o) => o.slug === decodeURIComponent(location.hash.slice(1)).toLowerCase());
window.addEventListener('hashchange', () => { if (stage.ready && hashIndex() >= 0) showObject(hashIndex()); });

applyTheme(themeName);

// Framed: follow the framing page's html[data-theme] (same-origin), and the
// system query, which pageTheme falls back to without a parent.
if (config.embedded) {
  const follow = () => applyTheme(window.pageTheme ? window.pageTheme() : 'light');
  try {
    new MutationObserver(follow).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) { /* not framed by the homepage */ }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', follow);
}
resize();
// A failed load keeps the stage covered and says so, in UniMate's words.
buildStage(Math.max(0, hashIndex())).catch((err) => {
  console.error('Failed to load stage', err);
  document.getElementById('loading-overlay').textContent = 'Failed to load model.';
});

// A handle for the console and for offline tooling (probes, renders); the page
// itself never reads it.
window.dimoLab = {
  scene, camera, controls, settings, latent, stage,
  get selected() { return selected; },
  setCode, select, showObject, frameCamera, applyTheme,
};
