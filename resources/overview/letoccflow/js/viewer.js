// Let Occ Flow lab engine. Sections:
//   1. Config, palettes             5. Camera pane and ray inspector
//   2. Renderer and stage shaders   6. Panel controls
//   3. Stage objects                7. Loop
//   4. Framing and controls
//
// The stage takes its look from Tesla's occupancy-flow demos (AI Day 2022):
// smooth surfaces pulled out of the occupancy, coloured by height, moving
// things painted by the direction they travel, the volume dissolving into fog
// around a chase camera. The voxel view keeps the paper's own grid one key away.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  VOX, VOLUME, CYCLE, EGO, NX, NY, NZ, X0, Y0, Z0, AGENTS, SHAPES, egoZ, cellX, cellY, cellZ, cellIndex,
  buildStatic, buildSDF, surfaceCells, agentStates, voxelizeAgents,
} from './scene.js?v=1';
import { surfaceNets } from './mesh.js?v=1';
import { renderFrame, paintFrame, inspectRay, rayDirection, CAMERA, HEIGHT_STOPS } from './render2d.js?v=1';

// ── 1. Config, palettes ─────────────────────────────────────────────────────
const config = window.OCC_LAB_CONFIG || {};
const embedded = Boolean(config.embedded);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (id) => document.getElementById(id);
const dom = { wrapper: $('viewer-wrapper'), phase: $('phase-bar'), clock: $('stage-clock'), tags: $('stage-tags') };
const setPressed = (button, on) => {
  if (!button) return;
  button.classList.toggle('is-active', on);
  button.setAttribute('aria-pressed', String(on));
};

// On its own the lab is Tesla's charcoal (or a pale grey), with no floor: the
// occupancy is the ground. Framed on the homepage it takes the thumbnails'
// shared stage — ivory paper, or the UniMate lab's sky and checker.
const THEMES = embedded ? {
  light: { background: '#F0EEE6', floor: { cell: '#F0EEE6', line: '#D3CCB9' }, ego: '#26272B' },
  dark: { background: '#151817', floor: { checker: ['#35312c', '#222321'], opacity: 0.88 }, ego: '#0F1012' },
} : {
  light: { background: '#E2E2E6', floor: null, ego: '#26272B' },
  dark: { background: '#2A2B2F', floor: null, ego: '#131416' },
};
let themeName = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

const settings = {
  view: config.view || 'flow',          // 'occupancy' | 'flow'
  surface: config.surface || 'mesh',    // 'mesh' | 'voxels'
  arrows: Boolean(config.arrows),
  history: Boolean(config.history),
  sensor: config.sensor !== false,      // the camera frustum and the inspected ray
  paused: false,
  pane: 'image',
  xi: 24,
  tau: 2,
};

// ── 2. Renderer and stage shaders ───────────────────────────────────────────
const touchEmbed = embedded && window.matchMedia('(pointer: coarse)').matches;
const TOUCH_EMBED_FPS = 30;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, config.maxPixelRatio || (touchEmbed ? 1.5 : 2)));
renderer.outputColorSpace = THREE.SRGBColorSpace;
dom.wrapper.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color();
scene.fog = new THREE.Fog(0x000000, 40, 80);
const camera = new THREE.PerspectiveCamera(config.fov || 38, 1, 0.3, 600);

// One set of uniforms for every stage surface. Colours are linear.
const common = {
  uMode: { value: 1 },
  uEgoZ: { value: 0 },
  uHalf: { value: VOLUME.half },
  uHeightY: { value: HEIGHT_STOPS.map(([y]) => y) },
  uHeight: { value: HEIGHT_STOPS.map(([, c]) => new THREE.Color(c)) },
  // Parked cars and a waiting pedestrian in the flow view: grey lightening upward.
  uStill: { value: ['#6E6E75', '#C9C9CF'].map((c) => new THREE.Color(c)) },
  uFogColor: { value: new THREE.Color() },
  uFogNear: { value: 40 },
  uFogFar: { value: 80 },
};

const SHARED_GLSL = /* glsl */`
  uniform float uMode, uEgoZ, uHalf, uFogNear, uFogFar, uOpacity, uLattice;
  uniform float uHeightY[7];
  uniform vec3 uHeight[7];
  uniform vec3 uStill[2];
  uniform vec3 uFogColor;

  vec3 heightRamp(float y) {
    if (y <= uHeightY[0]) return uHeight[0];
    for (int i = 1; i < 7; i++) {
      if (y <= uHeightY[i]) return mix(uHeight[i - 1], uHeight[i], (y - uHeightY[i - 1]) / (uHeightY[i] - uHeightY[i - 1]));
    }
    return uHeight[6];
  }
  vec3 stillRamp(float y) { return mix(uStill[0], uStill[1], smoothstep(0.2, 2.2, y)); }
  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  // Heading colour, mirrored in headingColor() below: forward (down the
  // street, with the ego car) red, backward blue, right green, left violet;
  // pastel, deeper with speed. v is (velocity x, velocity z).
  vec3 heading(vec2 v) {
    float th = atan(-v.x, v.y);
    if (th < 0.0) th += 6.2831853;
    float hue = th <= 3.14159265 ? th / 3.14159265 * 220.0 : 220.0 + (th - 3.14159265) / 3.14159265 * 140.0;
    float s = 0.32 + 0.36 * clamp(length(v) / 8.0, 0.0, 1.0);
    return pow(hsv2rgb(vec3(hue / 360.0, s, 0.97)), vec3(2.2));
  }

  // One lattice line family: 1 on a voxel boundary, antialiased to a pixel,
  // gone where the cells shrink below a few pixels (they would alias).
  float lattice(float g) {
    float w = fwidth(g);
    float line = 1.0 - clamp(abs(fract(g + 0.5) - 0.5) / max(w, 1e-5) - 0.5, 0.0, 1.0);
    return line * (1.0 - smoothstep(0.12, 0.3, w));
  }

  // Colour carries the scene; light only models form. The agent flag is 0 for the
  // street, 0.5 for a still agent, 1 for a moving one: the flow view keeps the
  // street height-graded, greys what could move but is still, and hues what
  // moves by its heading. The street's smooth surface keeps the 0.4 m voxel
  // lattice as faint lines, layers on walls and cells on tops; agents are
  // left continuous. Everything fades into the stage over the volume's last
  // 8 m and into fog with distance.
  vec4 shade(vec3 world, vec3 normal, float agent, vec2 velocity, float rim) {
    float edge = uHalf - abs(world.z - uEgoZ);
    if (edge < 0.0) discard;
    vec3 n = normalize(normal);
    vec3 view = normalize(cameraPosition - world);
    vec3 base = heightRamp(world.y);
    vec3 flow = agent > 0.75 ? heading(velocity) : agent > 0.25 ? stillRamp(world.y) : base;
    vec3 color = mix(base, flow, uMode);

    float up = clamp(n.y, 0.0, 1.0), wall = 1.0 - up;
    float form = 0.72 + 0.16 * up + 0.16 * max(dot(n, normalize(vec3(0.45, 0.55, -0.7))), 0.0);
    // Walls darken where they meet the ground.
    float contact = mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 1.1, world.y)), wall * step(agent, 0.25));
    vec3 g = world / 0.4;
    float lines = max(lattice(g.y) * wall, max(lattice(g.x), lattice(g.z)) * up * 0.4);
    lines *= uLattice * step(agent, 0.25);
    color *= form * contact * rim * (1.0 - 0.2 * lines);
    // A thin rim of its own hue lifts what moves off the street.
    float fresnel = pow(1.0 - max(dot(n, view), 0.0), 3.0);
    color += heading(velocity) * fresnel * 0.45 * step(0.75, agent) * uMode;

    float fog = smoothstep(uFogNear, uFogFar, distance(world, cameraPosition));
    fog = max(fog, 1.0 - smoothstep(0.0, 8.0, edge));
    return vec4(mix(color, uFogColor, fog), uOpacity);
  }`;

const MESH_VERTEX = /* glsl */`
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormal = mat3(modelMatrix) * normal;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;
const MESH_FRAGMENT = /* glsl */`
  ${SHARED_GLSL}
  uniform float uMoving;
  uniform vec2 uVelocity;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    gl_FragColor = shade(vWorld, vNormal, uMoving, uVelocity, 1.0);
    #include <colorspace_fragment>
  }`;

const VOXEL_VERTEX = /* glsl */`
  uniform float uEgoZ, uHalf;
  attribute vec3 offset;
  attribute vec3 aInfo;          // velocity x, velocity z, moving (0 or 1)
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vInfo;
  void main() {
    if (abs(offset.z - uEgoZ) > uHalf + 0.3) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vWorld = position + offset;
    vNormal = normal;
    vUv = uv;
    vInfo = aInfo;
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  }`;
const VOXEL_FRAGMENT = /* glsl */`
  ${SHARED_GLSL}
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying vec3 vInfo;
  void main() {
    // Each face keeps a darker rim so the grid reads, fading out where a face
    // is only a few pixels across (it would alias into moiré).
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float px = max(fwidth(vUv.x), fwidth(vUv.y));
    float rim = mix(0.74, 1.0, smoothstep(0.0, max(0.09, px * 1.5), e));
    rim = mix(rim, 1.0, smoothstep(0.12, 0.3, px));
    gl_FragColor = shade(vWorld, vNormal, vInfo.z, vInfo.xy, rim);
    #include <colorspace_fragment>
  }`;

function meshMaterial({ ghost = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...common, uOpacity: { value: ghost ? 0.28 : 1 }, uLattice: { value: 1 }, uMoving: { value: 0 }, uVelocity: { value: new THREE.Vector2() } },
    vertexShader: MESH_VERTEX, fragmentShader: MESH_FRAGMENT,
    transparent: ghost, depthWrite: !ghost,
  });
}

function voxelMesh(capacity, { ghost = false } = {}) {
  const box = new THREE.BoxGeometry(VOX, VOX, VOX);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = box.index;
  for (const name of ['position', 'normal', 'uv']) geometry.setAttribute(name, box.getAttribute(name));
  geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.instanceCount = 0;
  const material = new THREE.ShaderMaterial({
    // The cubes draw the lattice themselves (their rims).
    uniforms: { ...common, uOpacity: { value: ghost ? 0.28 : 1 }, uLattice: { value: 0 } },
    vertexShader: VOXEL_VERTEX, fragmentShader: VOXEL_FRAGMENT,
    transparent: ghost, depthWrite: !ghost,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.capacity = capacity;
  if (ghost) mesh.renderOrder = 2;
  return mesh;
}

// Write cells into a voxel mesh.
function fillVoxels(mesh, entries) {
  const offset = mesh.geometry.getAttribute('offset'), info = mesh.geometry.getAttribute('aInfo');
  const count = Math.min(entries.length, mesh.capacity);
  for (let n = 0; n < count; n++) {
    const [index, s] = entries[n];
    const i = index % NX, k = Math.floor(index / NX) % NY, j = Math.floor(index / (NX * NY));
    offset.array[n * 3] = cellX(i); offset.array[n * 3 + 1] = cellY(k); offset.array[n * 3 + 2] = cellZ(j);
    info.array[n * 3] = s ? s.vx : 0; info.array[n * 3 + 1] = s ? s.vz : 0; info.array[n * 3 + 2] = s ? (s.moving ? 1 : 0.5) : 0;
  }
  mesh.geometry.instanceCount = count;
  offset.needsUpdate = info.needsUpdate = true;
}

// The shader's heading() in JS, for the arrows, tags and legend wheel: same
// hue and saturation rules, so a change to one must be made to the other.
function headingColor(vx, vz, out = new THREE.Color()) {
  let th = Math.atan2(-vx, vz);
  if (th < 0) th += Math.PI * 2;
  const hue = th <= Math.PI ? (th / Math.PI) * 220 : 220 + ((th - Math.PI) / Math.PI) * 140;
  const s = 0.32 + 0.36 * Math.min(1, Math.hypot(vx, vz) / 8);
  const rgb = [0, 2 / 3, 1 / 3].map((off) => {
    const p = Math.abs(((hue / 360 + 1 + off) % 1) * 6 - 3);
    return 0.97 * (1 + s * (Math.min(1, Math.max(0, p - 1)) - 1));
  });
  return out.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

// ── 3. Stage objects ────────────────────────────────────────────────────────
const world = { labels: null, sdf: null };
const stage = {
  mesh: new THREE.Mesh(new THREE.BufferGeometry(), meshMaterial()),
  voxels: null,
  agentVoxels: voxelMesh(12000),
  ghostVoxels: voxelMesh(24000, { ghost: true }),
  agents: [],     // one smooth mesh per agent
  ghosts: [],     // two per agent: the previous two keyframes
};
stage.mesh.frustumCulled = false;
scene.add(stage.mesh, stage.agentVoxels, stage.ghostVoxels);

// An agent's surface, once, in its own frame: rounded boxes (each part's
// distance less a small radius) through surface nets at 0.1 m.
function agentGeometry(kind) {
  const parts = SHAPES[kind];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { c, h } of parts) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], c[a] - h[a]); hi[a] = Math.max(hi[a], c[a] + h[a]); }
  const step = 0.1, origin = lo.map((v) => v - 0.3);
  const n = lo.map((v, a) => Math.ceil((hi[a] - v + 0.6) / step) + 1);
  const { positions, indices } = surfaceNets((i, k, j) => {
    const p = [origin[0] + i * step, origin[1] + k * step, origin[2] + j * step];
    let best = Infinity;
    for (const { c, h } of parts) {
      const r = Math.min(0.12, Math.min(...h) * 0.7);
      const q = p.map((v, a) => Math.abs(v - c[a]) - (h[a] - r));
      const d = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0)) + Math.min(Math.max(...q), 0) - r;
      best = Math.min(best, d);
    }
    return best;
  }, n[0], n[1], n[2], origin, step);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}
{
  const geometries = {};
  AGENTS.forEach((agent) => {
    geometries[agent.kind] ||= agentGeometry(agent.kind);
    const mesh = new THREE.Mesh(geometries[agent.kind], meshMaterial());
    mesh.frustumCulled = false;
    stage.agents.push(mesh);
    const ghosts = [0, 1].map(() => {
      const g = new THREE.Mesh(geometries[agent.kind], meshMaterial({ ghost: true }));
      g.frustumCulled = false;
      g.renderOrder = 2;
      return g;
    });
    stage.ghosts.push(ghosts);
    scene.add(mesh, ...ghosts);
  });
}

// Floor (framed only): the thumbnails' paper, level with the road's top. Its
// cell is a share of the fitted view, as in the other two labs.
const FLOOR_SIZE = 600, FLOOR_VIEW_SHARE = 0.456;
const floorCanvas = document.createElement('canvas');
floorCanvas.width = floorCanvas.height = 256;
const floorTexture = new THREE.CanvasTexture(floorCanvas);
floorTexture.wrapS = floorTexture.wrapT = THREE.RepeatWrapping;
floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
floorTexture.colorSpace = THREE.SRGBColorSpace;
const floorMaterial = new THREE.MeshBasicMaterial({
  map: floorTexture, transparent: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.004;
scene.add(floor);
let floorCell = 1;
function paintFloor(theme) {
  floor.visible = Boolean(theme.floor);
  if (!theme.floor) return;
  const ctx = floorCanvas.getContext('2d'), n = floorCanvas.width;
  if (theme.floor.checker) {
    const [a, b] = theme.floor.checker, h = n / 2;
    ctx.fillStyle = a; ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = b; ctx.fillRect(0, 0, h, h); ctx.fillRect(h, h, h, h);
  } else {
    const half = Math.max(1, Math.round(n * 0.01));
    ctx.fillStyle = theme.floor.cell; ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = theme.floor.line;
    ctx.fillRect(0, 0, n, half); ctx.fillRect(0, n - half, n, half);
    ctx.fillRect(0, 0, half, n); ctx.fillRect(n - half, 0, half, n);
  }
  floorMaterial.opacity = theme.floor.opacity ?? 1;
  floorTexture.needsUpdate = true;
  scaleFloor();
}
function scaleFloor() {
  const tile = floorCell * (THEMES[themeName].floor?.checker ? 2 : 1);
  floorTexture.repeat.setScalar(FLOOR_SIZE / tile);
  floor.userData.tile = tile;
}

// The ego car: a side profile extruded to its width with a bevel, a darker
// glasshouse, four wheels. Lit by its own two lights; the stage is unlit.
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 10, -6);
scene.add(sun);
const ego = new THREE.Group();
const egoMaterial = new THREE.MeshLambertMaterial({ color: '#141517' });
{
  const profile = (points) => {
    const shape = new THREE.Shape();
    points.forEach(([z, y], n) => (n ? shape.lineTo(z, y) : shape.moveTo(z, y)));
    return shape;
  };
  const extrude = (shape, width, bevel) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3 });
    g.translate(0, 0, -(width - bevel * 2) / 2);
    g.rotateY(-Math.PI / 2);
    return g;
  };
  const body = extrude(profile([[-2.3, 0.32], [-2.36, 0.78], [-2.1, 0.98], [-0.95, 1.02], [1.05, 0.98], [2.2, 0.74], [2.36, 0.5], [2.28, 0.32]]), 1.86, 0.1);
  const cabin = extrude(profile([[-1.95, 0.96], [-1.2, 1.42], [0.3, 1.46], [1.25, 1.0]]), 1.62, 0.08);
  const glass = new THREE.MeshLambertMaterial({ color: '#08090B' });
  ego.add(new THREE.Mesh(body, egoMaterial), new THREE.Mesh(cabin, glass));
  const tyre = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20).rotateZ(Math.PI / 2);
  const rubber = new THREE.MeshLambertMaterial({ color: '#050505' });
  for (const x of [-0.84, 0.84]) for (const z of [-1.42, 1.45]) {
    const w = new THREE.Mesh(tyre, rubber);
    w.position.set(x, 0.34, z);
    ego.add(w);
  }
}
scene.add(ego);

// The front camera's frustum out to 6 m, in the pane's aspect.
const PANE = { W: 160, H: 90 };
const ACCENT = '#E0409A';
const sensor = new THREE.Group();
{
  const corners = [[0, 0], [PANE.W, 0], [PANE.W, PANE.H], [0, PANE.H]].map(([u, v]) => {
    const d = rayDirection(u, v, PANE.W, PANE.H, [0, 0, 0]);
    return new THREE.Vector3(d[0], d[1], d[2]).multiplyScalar(6 / d[2]);
  });
  const pts = [];
  for (let i = 0; i < 4; i++) pts.push(new THREE.Vector3(), corners[i], corners[i], corners[(i + 1) % 4]);
  sensor.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.75 })));
}
scene.add(sensor);

// The inspected ray: a line from the camera to the rendered depth, and the
// samples that carry most of its weight.
const rayLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false }));
const raySamples = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: ACCENT, size: 6, sizeAttenuation: false, depthTest: false }));
rayLine.renderOrder = raySamples.renderOrder = 5;
rayLine.visible = raySamples.visible = false;
scene.add(rayLine, raySamples);

const arrows = AGENTS.map(() => {
  const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1, 0xffffff, 0.9, 0.6);
  a.line.material.depthTest = false;
  a.cone.material.depthTest = false;
  a.renderOrder = 6;
  a.visible = false;
  scene.add(a);
  return a;
});

// ── 4. Framing and controls ─────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI / 2 - 0.04;
controls.minDistance = 4;
controls.maxDistance = 160;

// Framed on the homepage, as the other two thumbnails: the wheel zooms between
// EMBED_ZOOM_IN and EMBED_ZOOM_OUT of the fitted distance and never scrolls
// the page; on a touch screen the stage is a picture and the page scrolls.
const EMBED_ZOOM_IN = 0.4, EMBED_ZOOM_OUT = 1.2;
if (embedded) {
  if (touchEmbed) {
    controls.enabled = false;
    renderer.domElement.style.touchAction = 'auto';
  } else {
    renderer.domElement.addEventListener('wheel', (event) => event.preventDefault(), { passive: false });
  }
}

const view = { width: 1, height: 1, fit: 0 };
let lastEgoZ = 0;
// A chase camera behind and above the car, following it down the street. Its
// distance is fitted, not tuned: the closest at which the stretch of street it
// should show (config.fitBox, relative to the car) clears the insets, found by
// bisection between 2 and 300 m. Framed, a zoom the visitor made is kept as a
// share of the fit across refits (a resize, a reset).
function frameStage(t) {
  const el = embedded ? config.embedElevation : config.elevation;
  const zc = egoZ(t), box = embedded ? config.embedFitBox : config.fitBox;
  const target = new THREE.Vector3(EGO.x * 0.5, 1, zc + (embedded ? config.embedAhead : config.ahead));
  const dir = new THREE.Vector3(0, Math.sin(el), -Math.cos(el));
  const insets = embedded ? config.embedInsets : config.frameInsets;
  const points = [];
  // The box narrows toward the car, as a road seen in perspective does, so the
  // near corners don't push the camera back.
  for (const [z, half] of [[box.z[0], box.near], [box.z[1], box.far]]) {
    for (const x of [-half, half]) for (const y of box.y) points.push(new THREE.Vector3(EGO.x * 0.5 + x, y, zc + z));
  }
  const share = view.fit ? THREE.MathUtils.clamp(camera.position.distanceTo(controls.target) / view.fit, EMBED_ZOOM_IN, EMBED_ZOOM_OUT) : 1;
  const v = new THREE.Vector3();
  const fits = (d) => {
    camera.position.copy(target).addScaledVector(dir, d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return points.every((p) => {
      v.copy(p).project(camera);
      return v.z < 1
        && v.x >= -1 + (2 * insets.left) / view.width && v.x <= 1 - (2 * insets.right) / view.width
        && v.y >= -1 + (2 * insets.bottom) / view.height && v.y <= 1 - (2 * insets.top) / view.height;
    });
  };
  let lo = 2, hi = 300;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  view.fit = hi;
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir, hi * (embedded ? share : 1));
  if (embedded) {
    controls.minDistance = hi * EMBED_ZOOM_IN;
    controls.maxDistance = hi * EMBED_ZOOM_OUT;
  }
  controls.update();
  floorCell = hi * Math.tan((camera.fov * Math.PI) / 360) * FLOOR_VIEW_SHARE;
  scaleFloor();
  lastEgoZ = zc;
}

// The fog starts past the target and closes over the volume's far edge; it
// rides the zoom so zooming out never fogs the car.
function fogToView() {
  const d = camera.position.distanceTo(controls.target);
  const near = d + (config.fogNear ?? 8), far = d + (config.fogFar ?? 40);
  common.uFogNear.value = scene.fog.near = near;
  common.uFogFar.value = scene.fog.far = far;
}

function resize() {
  const rect = dom.wrapper.getBoundingClientRect();
  view.width = Math.max(1, rect.width);
  view.height = Math.max(1, rect.height);
  renderer.setSize(view.width, view.height, false);
  renderer.domElement.style.width = `${view.width}px`;
  renderer.domElement.style.height = `${view.height}px`;
  camera.aspect = view.width / view.height;
  camera.updateProjectionMatrix();
  if (world.labels) frameStage(currentT());
}
new ResizeObserver(resize).observe(dom.wrapper);

// ── 5. Camera pane and ray inspector ────────────────────────────────────────
const pane = {
  // Framed, the panel is hidden, so the pane never runs.
  canvas: embedded ? null : $('pane-canvas'), plot: embedded ? null : $('ray-plot'),
  frame: null, image: null, stats: null, pick: null, due: 0, dirty: true, ray: null,
};
if (pane.canvas) {
  pane.canvas.width = PANE.W;
  pane.canvas.height = PANE.H;
  pane.image = pane.canvas.getContext('2d').createImageData(PANE.W, PANE.H);
  // Opens on the lead car, straight ahead and below the horizon.
  const fx = (PANE.W / 2) / Math.tan((CAMERA.hfov * Math.PI) / 360);
  pane.pick = [PANE.W / 2 + 0.5, PANE.H / 2 + (fx * (EGO.camHeight - 0.8)) / 12];
  const pickAt = (event) => {
    const r = pane.canvas.getBoundingClientRect();
    pane.pick = [
      THREE.MathUtils.clamp(((event.clientX - r.left) / r.width) * PANE.W, 0, PANE.W - 0.01),
      THREE.MathUtils.clamp(((event.clientY - r.top) / r.height) * PANE.H, 0, PANE.H - 0.01),
    ];
    pane.dirty = true;
  };
  pane.canvas.addEventListener('pointerdown', (event) => {
    pane.canvas.setPointerCapture(event.pointerId);
    pickAt(event);
  });
  pane.canvas.addEventListener('pointermove', (event) => { if (event.buttons) pickAt(event); });
}

const fmt = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits).replace(/^-(0\.0*)$/, '$1') : '—');
const text = (id, value) => { const el = $(id); if (el) el.textContent = value; };

function updatePane(t) {
  pane.frame = renderFrame(world.sdf, world.labels, t, PANE.W, PANE.H, settings.xi, pane.frame);
  drawPane();
  inspect(t);
}

function drawPane() {
  const frame = pane.frame;
  if (!frame) return;
  pane.stats = paintFrame(frame, settings.pane, pane.image, { tau: settings.tau, agents: AGENTS });
  const ctx = pane.canvas.getContext('2d');
  ctx.putImageData(pane.image, 0, 0);
  const u = Math.floor(pane.pick[0]) + 0.5, v = Math.floor(pane.pick[1]) + 0.5;
  ctx.strokeStyle = ['flow', 'static'].includes(settings.pane) ? '#111' : '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(u, v - 5); ctx.lineTo(u, v - 2); ctx.moveTo(u, v + 2); ctx.lineTo(u, v + 5);
  ctx.moveTo(u - 5, v); ctx.lineTo(u - 2, v); ctx.moveTo(u + 2, v); ctx.lineTo(u + 5, v);
  ctx.stroke();

  const s = pane.stats;
  const pct = (n) => `${((100 * n) / Math.max(1, s.rays)).toFixed(1)}%`;
  text('stat-movable', pct(s.movable));
  text('stat-dynamic', pct(s.dynamic));
  text('stat-ratio', s.dynamic ? fmt(s.rays / s.dynamic, 1) : '—');
}

function inspect(t) {
  const frame = pane.frame;
  const [u, v] = pane.pick;
  const ray = inspectRay(world.sdf, t, u, v, PANE.W, PANE.H, settings.xi);
  pane.ray = ray;
  const idx = Math.floor(v) * PANE.W + Math.floor(u);
  const flow = [frame.flow[idx * 2], frame.flow[idx * 2 + 1]];
  const stat = [frame.stat[idx * 2], frame.stat[idx * 2 + 1]];
  const dyn = Math.hypot(flow[0] - stat[0], flow[1] - stat[1]);
  const hit = Number.isFinite(ray.d);
  const who = ray.who >= 0 ? AGENTS[ray.who] : null;
  const moving = Boolean(who) && dyn > settings.tau;
  text('ray-hit', !hit ? 'Sky: no surface' : who ? `${who.name} · ${moving ? 'dynamic' : 'static'}` : 'Static world');
  text('ray-depth', hit ? `${fmt(ray.d)} m` : '—');
  text('ray-sum', fmt(ray.sum, 3));
  const f = ray.sum > 0.05 ? [ray.fx / ray.sum, ray.fz / ray.sum] : [0, 0];
  text('ray-flow3d', hit ? `(${fmt(f[0], 1)}, ${fmt(f[1], 1)}) m/s` : '—');
  text('ray-optical', hit ? `(${fmt(flow[0], 1)}, ${fmt(flow[1], 1)}) px` : '—');
  text('ray-static', hit ? `(${fmt(stat[0], 1)}, ${fmt(stat[1], 1)}) px` : '—');
  text('ray-dynamic', hit ? `${fmt(dyn, 1)} px` : '—');
  $('ray-dynamic')?.classList.toggle('is-moving', moving);
  drawPlot(ray);
  placeRay(ray);
}

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// The inspected ray as a plot: the SDF along it (clipped to ±2 m), its zero
// line, and the NeuS weights as bars, around the rendered depth.
function drawPlot(ray) {
  const canvas = pane.plot;
  if (!canvas) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const ink = cssVar('--ink'), ink2 = cssVar('--ink-2'), line = cssVar('--line'), accent = cssVar('--accent');
  const pad = { l: 30, r: 8, t: 10, b: 20 };
  const hit = Number.isFinite(ray.d);
  const t0 = hit ? Math.max(0, ray.d - 7) : 0, t1 = hit ? ray.d + 3 : 40;
  const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const midY = pad.t + (h - pad.t - pad.b) / 2, span = (h - pad.t - pad.b) / 2;
  const Y = (s) => midY - (Math.max(-2, Math.min(2, s)) / 2) * span;

  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = ink2;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, midY + 0.5); ctx.lineTo(w - pad.r, midY + 0.5);
  ctx.stroke();
  ctx.textAlign = 'right';
  ctx.fillText('+2', pad.l - 5, pad.t + 4);
  ctx.fillText('0', pad.l - 5, midY + 3);
  ctx.fillText('−2', pad.l - 5, h - pad.b + 2);
  ctx.textAlign = 'center';
  for (let t = Math.ceil(t0 / 2) * 2; t <= t1; t += 2) ctx.fillText(`${t}`, X(t), h - 6);
  ctx.textAlign = 'left';
  ctx.fillText('m along the ray', pad.l + 4, pad.t + 4);

  let wmax = 0;
  for (let i = 0; i < ray.count; i++) wmax = Math.max(wmax, ray.ws[i]);
  const barW = Math.max(1, ((w - pad.l - pad.r) * ray.step) / (t1 - t0) - 0.5);
  ctx.fillStyle = accent;
  for (let i = 0; i < ray.count; i++) {
    const t = ray.ts[i];
    if (t < t0 || t > t1 || ray.ws[i] < 1e-4) continue;
    const bh = (ray.ws[i] / (wmax || 1)) * (h - pad.t - pad.b);
    ctx.fillRect(X(t) - barW / 2, h - pad.b - bh, barW, bh);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < ray.count; i++) {
    const t = ray.ts[i];
    if (t < t0 || t > t1) continue;
    if (!started) { ctx.moveTo(X(t), Y(ray.ss[i])); started = true; } else ctx.lineTo(X(t), Y(ray.ss[i]));
  }
  ctx.stroke();
  if (hit) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = accent;
    ctx.beginPath();
    ctx.moveTo(X(ray.d) + 0.5, pad.t); ctx.lineTo(X(ray.d) + 0.5, h - pad.b);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ink;
    ctx.fillText('d', X(ray.d) + 4, pad.t + 14);
  }
}

function placeRay(ray) {
  const visible = settings.sensor && !embedded && Number.isFinite(ray.d);
  rayLine.visible = raySamples.visible = visible;
  if (!visible) return;
  const { dir } = ray;
  // Kept relative to the camera, so the ray rides with the car between updates.
  rayLine.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3(dir[0], dir[1], dir[2]).multiplyScalar(ray.d)]);
  let wmax = 0;
  for (let i = 0; i < ray.count; i++) wmax = Math.max(wmax, ray.ws[i]);
  const pts = [];
  for (let i = 0; i < ray.count; i++) {
    if (ray.ws[i] >= wmax * 0.15) pts.push(new THREE.Vector3(dir[0], dir[1], dir[2]).multiplyScalar(ray.ts[i]));
  }
  raySamples.geometry.setFromPoints(pts);
}

// ── 6. Panel controls ───────────────────────────────────────────────────────
function applyView() {
  common.uMode.value = settings.view === 'flow' ? 1 : 0;
  document.querySelectorAll('[data-view]').forEach((b) => setPressed(b, b.dataset.view === settings.view));
  document.querySelectorAll('[data-surface]').forEach((b) => setPressed(b, b.dataset.surface === settings.surface));
  document.documentElement.dataset.view = settings.view;
  const mesh = settings.surface === 'mesh';
  stage.mesh.visible = mesh;
  stage.agents.forEach((m) => { m.visible = mesh; });
  if (stage.voxels) stage.voxels.visible = !mesh;
  stage.agentVoxels.visible = !mesh;
  applyToggles();
}
function applyToggles() {
  document.querySelectorAll('[data-toggle]').forEach((b) => setPressed(b, Boolean(settings[b.dataset.toggle])));
  const mesh = settings.surface === 'mesh';
  sensor.visible = settings.sensor && !embedded;
  stage.ghosts.forEach((pair) => pair.forEach((g) => { g.visible = settings.history && mesh; }));
  stage.ghostVoxels.visible = settings.history && !mesh;
  if (pane.ray) placeRay(pane.ray);
}
function applyPaneMode() {
  document.querySelectorAll('[data-pane]').forEach((b) => setPressed(b, b.dataset.pane === settings.pane));
  text('pane-caption', document.querySelector(`[data-pane="${settings.pane}"]`)?.dataset.caption || '');
  drawPane();
}

document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { settings.view = b.dataset.view; applyView(); }));
document.querySelectorAll('[data-surface]').forEach((b) => b.addEventListener('click', () => { settings.surface = b.dataset.surface; applyView(); }));
document.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => { settings[b.dataset.toggle] = !settings[b.dataset.toggle]; applyToggles(); }));
document.querySelectorAll('[data-pane]').forEach((b) => b.addEventListener('click', () => { settings.pane = b.dataset.pane; applyPaneMode(); }));
$('reset-view')?.addEventListener('click', () => { view.fit = 0; frameStage(currentT()); });

const bindSlider = (id, key, digits, after) => {
  const input = $(id);
  if (!input) return;
  input.value = settings[key];
  const show = () => text(`${id}-value`, Number(settings[key]).toFixed(digits));
  input.addEventListener('input', () => { settings[key] = Number(input.value); show(); after(); });
  show();
};
bindSlider('xi', 'xi', 0, () => { pane.dirty = true; });
bindSlider('tau', 'tau', 1, () => { drawPane(); if (pane.frame) inspect(pane.frame.t); });

if (!embedded) {
  window.addEventListener('keydown', (event) => {
    if (event.target.closest('input, select, textarea') || event.metaKey || event.ctrlKey || event.altKey) return;
    const k = event.key.toLowerCase();
    if (k === 'v') { settings.view = settings.view === 'flow' ? 'occupancy' : 'flow'; applyView(); }
    else if (k === 'm') { settings.surface = settings.surface === 'mesh' ? 'voxels' : 'mesh'; applyView(); }
    else if (k === 'a') { settings.arrows = !settings.arrows; applyToggles(); }
    else if (k === 'h') { settings.history = !settings.history; applyToggles(); }
    else if (k === 'c') { settings.sensor = !settings.sensor; applyToggles(); }
    else if (k === 'r') { view.fit = 0; frameStage(currentT()); }
    else if (k === ' ') { settings.paused = !settings.paused; applyToggles(); }
    else if (/^[1-6]$/.test(k)) {
      const modes = [...document.querySelectorAll('[data-pane]')].map((b) => b.dataset.pane);
      if (modes[Number(k) - 1]) { settings.pane = modes[Number(k) - 1]; applyPaneMode(); }
    } else return;
    event.preventDefault();
  });
}

function applyTheme(name) {
  themeName = name === 'light' ? 'light' : 'dark';
  const theme = THEMES[themeName];
  document.documentElement.dataset.theme = themeName;
  if (!embedded) {
    try { localStorage.setItem('letoccflow-lab-theme', themeName); } catch (e) { /* private mode */ }
  }
  scene.background.set(theme.background);
  scene.fog.color.set(theme.background);
  common.uFogColor.value.set(theme.background);
  egoMaterial.color.set(theme.ego);
  paintFloor(theme);
  const toggle = $('theme-toggle');
  if (toggle) {
    setPressed(toggle, themeName === 'light');
    toggle.querySelector('span').textContent = themeName === 'light' ? 'Light' : 'Dark';
  }
  if (pane.ray) drawPlot(pane.ray);
}
$('theme-toggle')?.addEventListener('click', () => applyTheme(themeName === 'light' ? 'dark' : 'light'));

// The heading wheel beside the stage's legend, in the arrows' colours: up is
// down the street, right is the car's right.
function drawLegendWheel() {
  const canvas = $('legend-wheel');
  if (!canvas) return;
  const size = 44;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);
  const c = new THREE.Color(), r0 = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x - r0 + 0.5, dy = y - r0 + 0.5, r = Math.hypot(dx, dy) / r0;
    if (r > 1 || r < 0.4) continue;
    headingColor(-(dx / r0) * 10, -(dy / r0) * 10, c);
    const o = (y * size + x) * 4;
    const rgb = c.clone().convertLinearToSRGB();
    image.data[o] = rgb.r * 255; image.data[o + 1] = rgb.g * 255; image.data[o + 2] = rgb.b * 255;
    image.data[o + 3] = 255 * Math.min(1, (1 - r) * r0, (r - 0.4) * r0);
  }
  ctx.putImageData(image, 0, 0);
}

// Moving agents carry a tag with their speed (the lab only).
const tags = AGENTS.map(() => {
  if (!dom.tags || embedded) return null;
  const el = document.createElement('span');
  el.className = 'tag';
  el.hidden = true;
  dom.tags.append(el);
  return el;
});

// ── 7. Loop ─────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let elapsed = 0, lastLoop = 0, onScreen = true, touchCarry = 0;
const FADE_SECONDS = 0.18;
const currentT = () => elapsed % CYCLE;
const KEYFRAME = CAMERA.dt;   // Past frames (H) shows the two previous keyframes, 0.5 s apart

function poseAgent(mesh, s) {
  mesh.position.set(s.x, 0, s.z);
  mesh.rotation.y = (s.agent.axis === 'z' ? 0 : Math.PI / 2) + (s.facing < 0 ? Math.PI : 0);
  mesh.material.uniforms.uMoving.value = s.moving ? 1 : 0.5;
  mesh.material.uniforms.uVelocity.value.set(s.vx, s.vz);
}

function updateAgents(t) {
  const states = agentStates(t);
  const zc = egoZ(t);
  if (settings.surface === 'mesh') {
    states.forEach((s, i) => poseAgent(stage.agents[i], s));
    if (settings.history) {
      [1, 2].forEach((lag, n) => {
        agentStates(t - lag * KEYFRAME).forEach((s, i) => {
          const ghost = stage.ghosts[i][n];
          ghost.visible = s.moving;
          poseAgent(ghost, s);
        });
      });
    }
  } else {
    fillVoxels(stage.agentVoxels, [...voxelizeAgents(states)]);
    if (settings.history) {
      const past = [];
      for (const lag of [1, 2]) past.push(...voxelizeAgents(agentStates(t - lag * KEYFRAME).filter((a) => a.moving)));
      fillVoxels(stage.ghostVoxels, past);
    }
  }

  const color = new THREE.Color(), screen = new THREE.Vector3();
  states.forEach((s, i) => {
    const top = Math.max(...s.boxes.map((b) => b.cy + b.hy));
    const inside = Math.abs(s.z - zc) < VOLUME.half - 4;
    const speed = Math.hypot(s.vx, s.vz);
    const arrow = arrows[i];
    arrow.visible = settings.arrows && s.moving && inside;
    if (arrow.visible) {
      arrow.position.set(s.x, top + 0.5, s.z);
      arrow.setDirection(new THREE.Vector3(s.vx, 0, s.vz).normalize());
      arrow.setLength(Math.max(1.4, speed * 0.6), 1.0, 0.7);
      arrow.setColor(headingColor(s.vx, s.vz, color));
    }
    const tag = tags[i];
    if (!tag) return;
    screen.set(s.x, top + 0.9, s.z).project(camera);
    tag.hidden = !(s.moving && inside && screen.z < 1 && Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1);
    if (tag.hidden) return;
    tag.textContent = `${s.agent.name} · ${speed.toFixed(1)} m/s`;
    tag.style.setProperty('--c', `#${headingColor(s.vx, s.vz, color).getHexString(THREE.SRGBColorSpace)}`);
    tag.userData = { x: ((screen.x + 1) / 2) * view.width, y: ((1 - screen.y) / 2) * view.height, depth: screen.z };
  });
  placeTags();
}

// Tags nearest the camera keep their place; a farther one that would overlap
// steps up above it.
function placeTags() {
  const shown = tags.filter((tag) => tag && !tag.hidden).sort((a, b) => a.userData.depth - b.userData.depth);
  const placed = [];
  for (const tag of shown) {
    const w = tag.offsetWidth, h = tag.offsetHeight;
    let { x, y } = tag.userData;
    for (let pass = 0; pass <= placed.length; pass++) {
      const clash = placed.find((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 4 && Math.abs(p.y - y) < h + 3);
      if (!clash) break;
      y = clash.y - h - 3;
    }
    placed.push({ x, y, w });
    tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }
}

function followCar(t) {
  const zc = egoZ(t);
  common.uEgoZ.value = zc;
  ego.position.set(EGO.x, 0, zc);
  sensor.position.set(EGO.x, EGO.camHeight, zc);
  rayLine.position.copy(sensor.position);
  raySamples.position.copy(sensor.position);
  const tile = floor.userData.tile || 1;
  floor.position.set(0, floor.position.y, Math.round(zc / tile) * tile);
  // The camera keeps whatever orbit the visitor gave it.
  const dz = zc - lastEgoZ;
  camera.position.z += dz;
  controls.target.z += dz;
  lastEgoZ = zc;
}

// The loop ends by cutting back to its start behind a short fade; framed, the
// thumbnail changes view at each cut (occupancy, then flow).
function crossLoop(t) {
  const loop = Math.floor(elapsed / CYCLE);
  dom.wrapper.classList.toggle('is-switching', !reduceMotion && t > CYCLE - FADE_SECONDS);
  if (loop !== lastLoop) {
    lastLoop = loop;
    if (embedded && config.embedCycle) {
      settings.view = config.embedCycle[loop % config.embedCycle.length];
      applyView();
    }
  }
}

if (embedded && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; }, { rootMargin: '120px 0px' }).observe(renderer.domElement);
}

function frame() {
  requestAnimationFrame(frame);
  let dt = Math.min(clock.getDelta(), 0.1);
  if (!onScreen || !world.labels) return;
  if (touchEmbed) {
    touchCarry += dt;
    if (touchCarry < 0.9 / TOUCH_EMBED_FPS) return;
    dt = Math.min(touchCarry, 0.1);
    touchCarry = 0;
  }
  if (!settings.paused && !reduceMotion) elapsed += dt;
  const t = currentT();
  crossLoop(t);
  followCar(t);
  updateAgents(t);
  if (dom.phase) dom.phase.style.setProperty('--u', (t / CYCLE).toFixed(4));
  if (dom.clock) dom.clock.textContent = `t = ${t.toFixed(1).padStart(4, '0')} s`;
  // The pane is a CPU ray march (~40 ms), so it runs about five times a
  // second, or at once when a control changed it.
  const now = performance.now();
  if (pane.canvas && (pane.dirty || (!settings.paused && now > pane.due))) {
    pane.dirty = false;
    pane.due = now + 200;
    updatePane(t);
  }
  controls.update();
  fogToView();
  renderer.render(scene, camera);
}

async function build() {
  dom.wrapper.classList.add('is-loading');
  // Let the overlay paint before the street is built.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  world.labels = buildStatic();
  world.sdf = buildSDF(world.labels);

  // The smooth street: surface nets over the occupancy itself (inside −1,
  // outside +1), relaxed within each cell, padded by one sample so the grid's
  // sides close; below the grid is ground. The chamfer SDF made walls bulge.
  const { positions, indices } = surfaceNets((i, k, j) => {
    const ii = i - 1, kk = k - 1, jj = j - 1;
    if (kk < 0) return -1;
    if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ || kk >= NY) return 1;
    return world.labels[cellIndex(ii, kk, jj)] ? -1 : 1;
  }, NX + 2, NY + 2, NZ + 2, [X0 - VOX / 2, Y0 - VOX / 2, Z0 - VOX / 2], VOX, { relax: 3 });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  stage.mesh.geometry.dispose();
  stage.mesh.geometry = geometry;

  // The paper's grid: one instance per surface cell.
  const surface = surfaceCells(world.labels);
  stage.voxels = voxelMesh(surface.length);
  fillVoxels(stage.voxels, surface.map((index) => [index, null]));
  scene.add(stage.voxels);

  applyView();
  resize();
  frameStage(0);
  dom.wrapper.classList.remove('is-loading');
}

applyTheme(themeName);
applyView();
if (pane.canvas) applyPaneMode();
drawLegendWheel();

if (embedded) {
  const follow = () => applyTheme(window.pageTheme ? window.pageTheme() : 'light');
  try {
    new MutationObserver(follow).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) { /* not framed by the homepage */ }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', follow);
}

build().then(frame).catch((err) => {
  console.error('Failed to build the scene', err);
  const overlay = $('loading-overlay');
  if (overlay) overlay.textContent = 'Failed to build scene.';
});

// A handle for the console and for offline probes (AGENTS.md); the page never
// reads it.
window.occLab = {
  scene, camera, controls, settings, world, pane, view, stage,
  frameStage, applyTheme, applyView, get t() { return currentT(); },
  seek(t) { elapsed = t; pane.dirty = true; },
};
