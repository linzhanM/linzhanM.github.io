// ─────────────────────────────────────────────────────────────────────────────
// Interactive 3D viewer (Three.js) — drives #example-sidebar / #viewer-wrapper.
//
// Loads the rigs listed in examples.js, normalizes + grounds them (a port of the
// Blender render_mesh_skeleton_stage.py pipeline), lays them out on a stage, and
// accepts drag-and-drop of .glb / .gltf. The scene catalog is data-only in
// examples.js; everything below is the engine.
//
// Sections:
//   1. Imports & DOM refs
//   2. State (toolbar settings, active stage, tuning constants)
//   3. Scene setup (scene / camera / renderer / lights / controls / loaders)
//   4. Toolbar appliers (wireframe / lighting)
//   5. Model loading & material repair
//   6. Normalize & ground (Blender pipeline port)
//   7. Stage: framing + teardown
//   8. Layout helpers (row / stagger / behind / above / offsets)
//   9. Prompt labels (HTML pills tracking each model)
//  10. Load a stage / example / dropped files
//  11. UI wiring (toolbar, sidebar, drag & drop)
//  12. Render loop, resize, init
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Imports & DOM refs ────────────────────────────────────────────────────
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EXAMPLES as DEFAULT_CATALOG } from './examples.js?v=157';

const wrapper = document.getElementById('viewer-wrapper');
const overlay = document.getElementById('loading-overlay');
const sidebar = document.getElementById('example-sidebar');
const labelLayer = document.getElementById('viewer-labels');
const stageName = document.getElementById('stage-name');
// The project page's "Open full screen" link — absent in the lab, which is
// where it goes. loadStage keeps its hash on the stage currently on screen.
const expandLink = document.querySelector('.interactive-expand');
const LOADING_HTML = overlay.innerHTML;
const viewerConfig = window.UNIMATE_VIEWER_CONFIG || {};
const EXAMPLES = DEFAULT_CATALOG;
// The Categories heading (lab only) quotes how many stages the rail holds. The
// numeral in the markup is a first paint; the real value is written from the
// data, never by hand.
document.querySelectorAll('.category-heading strong').forEach((el) => {
  el.textContent = EXAMPLES.length;
});
const isFullscreenLab = viewerConfig.fullscreenLab === true;
const VIEWER_THEMES = {
  dark: {
    background: 0x151817,
    hemisphereGround: 0x4a4038,
    paper: { cell: '#151817', line: '#2e302c' },
    shadowOpacity: 0.46,
    metaColor: '#151817',
  },
  light: {
    background: 0xf0eee6,
    hemisphereGround: 0x9a9a9a,
    // The DIMO thumbnail's paper beside it (dimo/js/viewer.js THEMES.light).
    paper: { cell: '#F0EEE6', line: '#D3CCB9' },
    shadowOpacity: 0.25,
    metaColor: '#e8e9e3',
  },
};
// Framed and dark: the UniMate lab's own dark (unimate/interactive) — its
// #151817 sky, also the homepage's dark plate, and its checker floor in place
// of the graph paper, one square per paper cell. The DIMO thumbnail repeats
// these values.
if (viewerConfig.embedded) {
  Object.assign(VIEWER_THEMES.dark, {
    background: 0x151817,
    paper: { checker: ['#35312c', '#222321'], opacity: 0.88 },
    metaColor: '#151817',
  });
}
let viewerTheme = isFullscreenLab
  ? (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  : 'light';

// ── 2. State ─────────────────────────────────────────────────────────────────
// Toolbar state (persists across example switches).
const settings = {
  'show model': true,
  'show skeleton': true,
  'wireframe': false,
  'show prompts': true,
  // Lab only: pin every rig's prompt over its root joint (updateLabelsPinned)
  // instead of the one-at-a-time hover tooltip. The config sets the opening
  // state; the lab opens with it on.
  'pin prompts': viewerConfig.pinPrompts === true,
  'paused': false,
  'auto orbit': true,
  // OrbitControls counts this in units of 2π/60 rad/s (one unit = 6°/s), so
  // this is 8°/s, a revolution every 45 s. Fast enough to read as deliberate
  // within a second or two of landing (the lab is drag-to-orbit; this only says
  // so), slow enough that a walk cycle stays legible from one side and that the
  // hover tooltip, which re-picks only on pointermove, does not go stale under a
  // still cursor. It is a rate only because the render loop passes dt — see there.
  'orbit speed': 8 / 6,
};

// The active "stage" — parallel arrays, one entry per model in the window.
let pivots = [];       // THREE.Group wrapping each model (for ground/normalize/layout)
let models = [];
let mixers = [];       // one AnimationMixer per animated model
let skeletons = [];
let labels = [];       // { el, anchor } per PROMPTED model — sparse, see buildLabels
let grid = null;       // shared ground grid, sized to the whole stage
let shadowPlane = null; // transparent shadow-catcher over the floor (always on — no toggle)
let viewPointerDown = false; // prompts hide while the user drags/orbits the canvas
const activeViewPointers = new Set(); // keep multi-touch hidden until every finger lifts
let viewZooming = false; // and while wheel-zooming, which has no pointer to release
let hoveredPromptOrder = null; // full-screen lab: prompt under the pointer
let hoverPromptX = 0;
let hoverPromptY = 0;
// The lab's two prompt modes: the Text Prompts switch on pins every chip
// (updateLabelsPinned); off, one prompt follows the pointer. The project page
// has neither — it runs the anchored solver.
const hoverPromptsActive = () => viewerConfig.hoverPrompts === true && !settings['pin prompts'];

let loadToken = 0;     // guards against overlapping async loads
let activePad = 1.15;  // camera padding of the current example (so Reset view keeps it)
let activeCameraPadding = viewerConfig.cameraPadding || 1;
let activeMobileCameraPadding = viewerConfig.mobileCameraPadding || activeCameraPadding;
let activeShift = [0, 0, 0]; // whole-diorama pan held OUT of auto-framing — see applyStageShift
let activeFloor = 1;   // per-stage multiplier on the auto-sized paper floor
// Frame/floor from the models' ANIMATED envelope rather than the pose on screen
// at framing time. Off for the catalog (its stages are tuned against the
// instantaneous box), on for drop-ins — see loadFiles.
let activeFrameEnvelope = false;

// Tuning constants.
const TARGET_HEIGHT = 1.0;          // normalized height, in world units (Blender TARGET_HEIGHT)
const VERTS_PER_MESH = 1000;        // skinned-vertex budget per mesh per sampled frame
const MESH_FRAME_BUDGET = 48;       // frames sampled for the mesh bbox (height/centering)
// Air between a rig's crown and its pinned chip in the lab, in world units at
// stage scale 1 (updateLabelsPinned) — one distance for every rig on a stage,
// so a chicken's chip floats as far off its comb as the dragon's off its horns.
// As a fraction of the rig it went to nothing on the small ones.
const LIFT_AIR = 0.1;
const ROW_STEP_MULT = 1.15;         // horizontal spacing between models, in widths
const MIN_FRAME_WIDTH = 3.0;        // camera always frames >= this world-width, so a 2-model
                                    // group doesn't zoom in and read oversized next to a 9-model one

// ── 3. Scene setup ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(VIEWER_THEMES[viewerTheme].background);

const camera = new THREE.PerspectiveCamera(
  35, wrapper.clientWidth / wrapper.clientHeight, 0.01, 5000
);
camera.position.set(0, 1.4, 4);

// Framed on a touch screen (the homepage thumbnail on a phone), the stage is a
// picture, not an instrument, and draws lighter: nothing orbits (a swipe over
// the frame scrolls the page), it draws TOUCH_EMBED_FPS frames a second rather
// than the display's rate, and a 1.5 pixel ratio and a 1024 shadow map read as
// 2 and 2048 do at 350 CSS px — about a quarter of the pixels a second, and a
// quarter of the shadow memory.
const touchEmbed = viewerConfig.embedded && window.matchMedia('(pointer: coarse)').matches;
const TOUCH_EMBED_FPS = 30;

const renderer = new THREE.WebGLRenderer({ antialias: true });
// Capped at 2 as unimate/'s lab is (1.5 in touchEmbed); `maxPixelRatio` lifts
// the cap for unimate/tools/render-category.mjs, which lays this page out at a
// fraction of its output size so the skeleton hairlines keep a phone's weight
// in a 4K frame (its --lab homepage-unimate).
renderer.setPixelRatio(Math.min(window.devicePixelRatio, viewerConfig.maxPixelRatio || (touchEmbed ? 1.5 : 2)));
renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// No tone mapping, as in unimate/: ACES was tried (2026-09-12) and paled
// Spot's yellow and Baymax's red, the colours the rigs are known by.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrapper.appendChild(renderer.domElement);

// Lights. Each remembers its base intensity so a per-example multiplier can
// brighten/dim just one window (see applyLighting / EXAMPLES `lighting`).
// unimate/'s own three, at its values — direct light only. A studio
// environment (a painted equirect through PMREMGenerator, envMapIntensity
// 0.45 under a hemisphere at 0.65) with a clearcoat polish on every material
// was built for the glossy shells on 2026-09-12 and taken out the same day at
// the owner's request: the reflections read as too bright a stage beside
// unimate/'s matte one. Match that lab, not the teaser render.
const hemiLight = new THREE.HemisphereLight(0xffffff, VIEWER_THEMES[viewerTheme].hemisphereGround, 2.2);
scene.add(hemiLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
keyLight.position.set(4, 8, 6);
scene.add(keyLight);
// The key light casts the ground shadows. Its ortho shadow frustum is fitted to
// the stage in frameStage(); bias/normalBias tame skinned-mesh shadow acne.
keyLight.castShadow = true;
keyLight.shadow.mapSize.setScalar(touchEmbed ? 1024 : 2048);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.02;
scene.add(keyLight.target);
const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
fillLight.position.set(-5, 3, -4);
scene.add(fillLight);

const LIGHTS = [hemiLight, keyLight, fillLight];
LIGHTS.forEach((l) => { l.userData.baseIntensity = l.intensity; });

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
// Framed on the homepage (interactive.js `embedded`): drag still orbits, but the
// wheel is left to the page — with enableZoom off OrbitControls never
// preventDefaults the wheel, so it scroll-chains out of the frame instead of
// zooming a thumbnail. On a touch screen nothing orbits: the controls are off
// and the canvas gives back the touch-action OrbitControls set to none, so a
// swipe or a pinch over the frame moves the page as anywhere else.
if (viewerConfig.embedded) {
  controls.enableZoom = false;
  controls.enablePan = false;
  if (touchEmbed) {
    controls.enabled = false;
    renderer.domElement.style.touchAction = 'auto';
  }
}
if (viewerConfig.autoOrbitControls) {
  controls.autoRotate = settings['auto orbit'];
  controls.autoRotateSpeed = settings['orbit speed'];
}

// This lab's rigs in resources/glbs/ are meshopt-compressed like unimate/'s
// (pipeline in unimate/README.md; since 2026-09-12, uncompressed before), and
// meshopt geometry needs this decoder registered or the .glb fails to parse.
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const clock = new THREE.Clock();

// ── 4. Toolbar appliers ──────────────────────────────────────────────────────
function applyWireframe() {
  for (const model of models) model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const mat of mats) if (mat) mat.wireframe = settings['wireframe'];
  });
}

// Scale every light by `mult` off its base (mult = 1 restores the default look).
function applyLighting(mult = 1) {
  for (const l of LIGHTS) l.intensity = l.userData.baseIntensity * mult;
}

// ── 5. Model loading & material repair ───────────────────────────────────────
function loadModel(url) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (res) => resolve({ model: res.scene, animations: res.animations }), undefined, reject);
  });
}

// Shadows on, culling off, every map tagged sRGB (as unimate/ does it).
function fixMaterials(model) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    // Skinned meshes deform well outside their bind-pose bounding sphere;
    // without this they get frustum-culled and vanish ("missing geometry")
    // at some camera angles / animation frames.
    o.frustumCulled = false;
    o.castShadow = true;
    o.receiveShadow = true;   // onto the ground catcher, and onto each other
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      m.needsUpdate = true;
    }
  });
}

// Per-model PBR tweak (opt-in via a file's `material` in examples.js). Some rigs
// (mixamo-backflip) ship high-roughness materials that read dark and matte under the
// direct lights. Lower roughness sharpens their speculars; an emissive lift
// brightens the diffuse without touching global lighting or other models. Two
// flavours of lift:
//   • default (textured rigs): through the model's own map, so detail shows.
//   • `emissive: 0xRRGGBB` (near-black rigs like the eagles): a FLAT colour,
//     since a map-driven lift of a black texture stays black.
function applyMaterialOverride(model, mat) {
  if (!mat) return;
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (mat.colorScale !== undefined && m.color) m.color.multiplyScalar(mat.colorScale);
      if (mat.roughness !== undefined && 'roughness' in m) m.roughness = mat.roughness;
      if (mat.metalness !== undefined && 'metalness' in m) m.metalness = mat.metalness;
      if (mat.emissiveIntensity !== undefined && m.emissive) {
        if (mat.emissive !== undefined) {
          m.emissive.setHex(mat.emissive);
        } else if (m.map) {
          m.emissiveMap = m.map;
          m.emissive.setRGB(1, 1, 1);
        } else {
          m.emissive.setRGB(1, 1, 1);
        }
        m.emissiveIntensity = mat.emissiveIntensity;
      }
      m.needsUpdate = true;
    }
  });
}

// ── 6. Normalize & ground ────────────────────────────────────────────────────
// Park an empty Object3D in the PIVOT's local frame: the pivot's normalize scale
// and ground/layout translation carry it into world space for free, so the label
// anchor tracks the model wherever layout puts it. An empty contributes nothing
// to Box3.expandByObject, so frameStage is unaffected.
function setLabelAnchor(pivot, x, y, z) {
  let anchor = pivot.userData.labelAnchor;
  if (!anchor) {
    anchor = new THREE.Object3D();
    pivot.add(anchor);
    pivot.userData.labelAnchor = anchor;
  }
  anchor.position.set(x, y, z);
  anchor.updateMatrixWorld(true);
}

// Port of render_mesh_skeleton_stage.py's normalize + ground steps (glTF is
// Y-up where the Blender script is Z-up, so "ground" here is min-Y):
//   • normalize : scale so the MESH's tallest per-frame height == TARGET_HEIGHT (step 4)
//   • center    : x/z centred on the MESH bounding box over all frames (step 5)
//   • ground    : lowest JOINT across all frames -> y = 0, skipping the
//                 armature-origin root joints (head_local.length < 1e-3 guard)
// groundToMesh grounds the lowest MESH vertex instead, for rigs (gyarados) whose
// spine joints sit well above the belly and would float above the grid. sizeBy
// 'maxdim' scales by the largest per-frame bbox dimension rather than height:
// pose-stable for elongated creatures (eagles, sharks) whose height swings
// enough per clip to make one character a different size in every clip.
function groundAndNormalize(pivot, model, mixer, clip, userScale = 1, groundToMesh = false, sizeBy = 'height', groundFrame = null) {
  pivot.scale.setScalar(1);
  pivot.position.set(0, 0, 0);
  pivot.updateMatrixWorld(true);

  const bones = [];
  const skinned = [];
  model.traverse((o) => {
    if (o.isBone) bones.push(o);
    else if (o.isSkinnedMesh) skinned.push(o);
  });
  if (!bones.length && !skinned.length) {
    // Nothing rigged to measure (a static drop-in). The pivot is still identity,
    // so the plain bbox is already in its local frame.
    const b = new THREE.Box3().setFromObject(model);
    if (b.isEmpty()) return new THREE.Vector3(1, 1, 1);
    const c = b.getCenter(new THREE.Vector3());
    const bs = b.getSize(new THREE.Vector3());
    setLabelAnchor(pivot, c.x, c.y, c.z);
    pivot.userData.localBox = b.clone();
    pivot.userData.localBoxFull = b.clone();
    pivot.userData.rootJoint = null;
    // Normalize + ground it anyway, on that one box: otherwise the model arrives in
    // whatever unit it was authored in (a centimetre export is 100× the stage) and
    // sits wherever its origin puts it. bs.y <= 0 is a flat model (a plane, a
    // decal), and dividing by that height blows it up to the size of the sky, so
    // fall back to the largest dimension.
    const norm = (sizeBy === 'maxdim' || bs.y <= 1e-6) ? Math.max(bs.x, bs.y, bs.z) : bs.y;
    const ss = (TARGET_HEIGHT / Math.max(norm, 1e-6)) * userScale;
    pivot.scale.setScalar(ss);
    pivot.position.set(-ss * c.x, -ss * b.min.y, -ss * c.z);
    pivot.updateMatrixWorld(true);
    return bs.multiplyScalar(ss);   // normalized footprint, as the rigged path returns
  }

  // Real joints = drop the armature-origin root (≈ Blender's head_local.length < 1e-3).
  const isOriginRoot = (b) => !(b.parent && b.parent.isBone) && b.position.length() < 1e-3;
  const realJoints = bones.filter((b) => !isOriginRoot(b));
  const joints = realJoints.length ? realJoints : bones;
  // The skeleton's root: the bone with no bone above it — the tree's root node,
  // NOT the first real joint (an armature-origin root is skipped for grounding
  // and normalizing above, but it is still where the tree starts, and the lab's
  // pinned prompts hang from it, live — updateLabelsPinned). A file with several
  // bone trees (mesh-per-part exports) takes the one with the most joints under
  // it. The project page never reads this.
  const treeRoots = bones.filter((b) => !(b.parent && b.parent.isBone));
  if (treeRoots.length > 1) {
    const under = new Map(treeRoots.map((r) => [r, 0]));
    for (const b of bones) {
      let r = b;
      while (r.parent && r.parent.isBone) r = r.parent;
      under.set(r, (under.get(r) || 0) + 1);
    }
    treeRoots.sort((a, b) => under.get(b) - under.get(a));
  }
  pivot.userData.rootJoint = treeRoots[0] || null;

  const gMin = new THREE.Vector3(Infinity, Infinity, Infinity);   // mesh bbox (all frames)
  const gMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let jointMinY = Infinity;                                       // lowest joint (all frames)
  let maxFrameHeight = 0;                                         // tallest single-frame mesh height
  let maxFrameDim = 0;                                            // largest single-frame bbox dimension
  const frameBounds = [];                                         // per-frame extremes, for the typical envelope
  const rootGaps = [];                                            // per-frame (mesh top − root joint), for the lab's chip lift
  const v = new THREE.Vector3();
  let meshOK = skinned.length > 0 && typeof skinned[0].getVertexPosition === 'function';

  const sampleJoints = () => {
    for (const b of joints) { v.setFromMatrixPosition(b.matrixWorld); if (v.y < jointMinY) jointMinY = v.y; }
  };
  const sampleMesh = () => {
    let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity, fMaxY = -Infinity, fMinZ = Infinity, fMaxZ = -Infinity;
    try {
      for (const sm of skinned) {
        const count = sm.geometry.attributes.position.count;
        const st = Math.max(1, Math.floor(count / VERTS_PER_MESH));
        for (let i = 0; i < count; i += st) {
          sm.getVertexPosition(i, v).applyMatrix4(sm.matrixWorld);
          gMin.min(v); gMax.max(v);
          if (v.x < fMinX) fMinX = v.x; if (v.x > fMaxX) fMaxX = v.x;
          if (v.y < fMinY) fMinY = v.y; if (v.y > fMaxY) fMaxY = v.y;
          if (v.z < fMinZ) fMinZ = v.z; if (v.z > fMaxZ) fMaxZ = v.z;
        }
      }
    } catch (e) { meshOK = false; return; }
    if (fMaxY > fMinY) maxFrameHeight = Math.max(maxFrameHeight, fMaxY - fMinY);
    maxFrameDim = Math.max(maxFrameDim, fMaxX - fMinX, fMaxY - fMinY, fMaxZ - fMinZ);
    // The lab's chip rides the ROOT, so what it must clear is the mesh top
    // RELATIVE to the root, frame by frame — a rearing quadruped lifts its root
    // with its head, and an absolute crown would carry the chip up twice.
    // Measured in the same pass, at the same frames.
    if (pivot.userData.rootJoint && fMaxY > fMinY) {
      rootGaps.push(fMaxY - v.setFromMatrixPosition(pivot.userData.rootJoint.matrixWorld).y);
    }
    if (fMaxX > fMinX) frameBounds.push([fMinX, fMaxX, fMinY, fMaxY, fMinZ, fMaxZ]);
  };

  if (mixer && clip && clip.duration > 0) {
    const samples = Math.min(600, Math.max(2, Math.ceil(clip.duration * 30)));
    const meshEvery = Math.max(1, Math.floor(samples / MESH_FRAME_BUDGET));
    for (let i = 0; i < samples; i++) {
      mixer.setTime((i / (samples - 1)) * clip.duration);
      pivot.updateMatrixWorld(true);
      sampleJoints();
      if (meshOK && (i % meshEvery === 0)) sampleMesh();
    }
    mixer.setTime(0);
    pivot.updateMatrixWorld(true);
  } else {
    pivot.updateMatrixWorld(true);
    sampleJoints();
    if (meshOK) sampleMesh();
  }

  // Fallback: if the mesh couldn't be measured, normalize/center on the joints instead.
  if (!meshOK || maxFrameHeight <= 1e-6) {
    gMin.set(Infinity, Infinity, Infinity);
    gMax.set(-Infinity, -Infinity, -Infinity);
    for (const b of joints) { v.setFromMatrixPosition(b.matrixWorld); gMin.min(v); gMax.max(v); }
    maxFrameHeight = Math.max(gMax.y - gMin.y, 1e-6);
  }
  if (jointMinY === Infinity) jointMinY = gMin.y;

  // Normalize by height (default) or by the largest per-frame dimension
  // ('maxdim'), times the per-example scale. Quadrupeds are short but long, so
  // unit-height normalization reads oversized next to bipeds; userScale < 1
  // brings them back in line.
  const normBy = (sizeBy === 'maxdim' && maxFrameDim > 1e-6) ? maxFrameDim : maxFrameHeight;
  const s = (TARGET_HEIGHT / normBy) * userScale;
  // For equalizeRigs: the measure this rig was sized by, a POSE-INVARIANT size
  // for it, and the scale asked for — all in the file's own units. The size is
  // the mesh at its bind pose: the skinned geometry's own bounding box, before
  // any bone moves it, so two clips of one character agree on it while their
  // tallest frames do not. The mesh, not the skeleton — EVE's three exports
  // carry identical bones under meshes of three sizes, so a bone-length total
  // called them equal while the eye did not. Bones are the fallback for a rig
  // with no skinned mesh.
  const rest = new THREE.Box3();
  for (const sm of skinned) {
    if (!sm.geometry.boundingBox) sm.geometry.computeBoundingBox();
    rest.union(sm.geometry.boundingBox.clone().applyMatrix4(sm.matrixWorld));
  }
  let restSize = 0;
  if (!rest.isEmpty()) {
    const d = rest.getSize(new THREE.Vector3());
    restSize = sizeBy === 'maxdim' ? Math.max(d.x, d.y, d.z) : d.y;
  }
  if (!(restSize > 1e-6)) {
    for (const b of bones) if (b.parent && b.parent.isBone) restSize += b.position.length();
  }
  pivot.userData.sizeNorm = normBy;
  pivot.userData.restSize = restSize;
  pivot.userData.userScale = userScale;
  const cx = (gMin.x + gMax.x) / 2;
  const cz = (gMin.z + gMax.z) / 2;

  // Ground reference: by default the lowest point across ALL frames, which keeps
  // the lowest foot planted through a walk cycle. But a limb or tail swinging
  // BELOW the feet mid-clip (the rearing stego-attack) over-lifts the body and
  // floats the feet; `groundFrame` (0..1) grounds on that SINGLE frame — the
  // neutral stance — instead, so the feet stay planted and the tail may dip.
  let groundY = (groundToMesh && meshOK) ? gMin.y : jointMinY;
  if (groundFrame != null && mixer && clip && clip.duration > 0) {
    mixer.setTime(THREE.MathUtils.clamp(groundFrame, 0, 1) * clip.duration);
    pivot.updateMatrixWorld(true);
    let fy = Infinity;
    if (groundToMesh && meshOK) {
      try {
        for (const sm of skinned) {
          const count = sm.geometry.attributes.position.count;
          const st = Math.max(1, Math.floor(count / VERTS_PER_MESH));
          for (let i = 0; i < count; i += st) {
            sm.getVertexPosition(i, v).applyMatrix4(sm.matrixWorld);
            if (v.y < fy) fy = v.y;
          }
        }
      } catch (e) { fy = Infinity; }
    }
    if (fy === Infinity) {
      for (const b of joints) { v.setFromMatrixPosition(b.matrixWorld); if (v.y < fy) fy = v.y; }
    }
    if (fy !== Infinity) groundY = fy;
    mixer.setTime(0);
    pivot.updateMatrixWorld(true);
  }

  pivot.scale.setScalar(s);
  pivot.position.set(-s * cx, -s * groundY, -s * cz);
  pivot.updateMatrixWorld(true);

  // localBox: the model's extent in the pivot's frame, which updateLabels
  // projects each frame to decide how close a chip may sit. The TYPICAL envelope,
  // not the maximum — per-axis 15th/85th percentiles over the sampled frames —
  // because the extremes belong to one instant each (a wing at the top of its
  // beat, a tail at full stretch), and clearing them would hold every chip a
  // wingspan from a rig that is nowhere near that big most of the time.
  const axis = (n, p) => {
    if (!frameBounds.length) return p < 0.5 ? gMin.getComponent(n >> 1) : gMax.getComponent(n >> 1);
    const col = frameBounds.map((f) => f[n]).sort((a, b) => a - b);
    return col[Math.round((col.length - 1) * p)];
  };
  pivot.userData.localBox = new THREE.Box3(
    new THREE.Vector3(axis(0, 0.15), axis(2, 0.15), axis(4, 0.15)),
    new THREE.Vector3(axis(1, 0.85), axis(3, 0.85), axis(5, 0.85))
  );
  // localBoxFull: the FULL envelope, for a different question — what must never
  // be covered. A wing at full stretch is still drawn, and scoring coverage
  // against the tight box would let chips settle straight onto it.
  pivot.userData.localBoxFull = new THREE.Box3(gMin.clone(), gMax.clone());

  // The label anchor sits at the CENTRE of the envelope, never an edge: an edge
  // point is usually empty air (the box top floats above a dragon mid-downbeat,
  // the side is out at the tip of a tail), and a mark hanging in space says
  // nothing about which rig it means. The centre is inside every rig's silhouette
  // here, and static, so the mark never twitches with the clip.
  setLabelAnchor(pivot, cx, (gMin.y + gMax.y) / 2, cz);

  // How far above the root joint the lab's pinned chip sits, in WORLD units: the
  // TYPICAL root-to-mesh-top gap over the clip — the 85th percentile of rootGaps,
  // the same cut localBox takes — at stage scale; the air above it is added per
  // stage (stageLiftAir). Not the maximum: on a bird that is one wingtip at the
  // top of one beat, and it held the eagle's chip a body-length over its head
  // for the rest of the clip. A sustained pose (a quadruped rearing for half its
  // clip) still counts in full. Root-relative because the chip rides the root,
  // so each rig sits at its own distance: just clear of what it usually is, with
  // a wingtip allowed to sweep past for an instant. A world offset, not pixels,
  // so the chip keeps its place through zoom and orbit. When the mesh could not
  // be sampled, fall back to the joint envelope's top over its centre.
  let gap = (gMax.y - gMin.y) / 2;
  if (rootGaps.length) {
    rootGaps.sort((a, b) => a - b);
    gap = rootGaps[Math.round((rootGaps.length - 1) * 0.85)];
  }
  pivot.userData.labelLift = gap * s;

  // Normalized footprint, used to space models out in a row.
  return new THREE.Vector3(
    (gMax.x - gMin.x) * s, (gMax.y - gMin.y) * s, (gMax.z - gMin.z) * s
  );
}

// Which character a file is: the catalog names every rig <character>-<action>,
// so the stem before the first dash is the character, and a stage is ONE
// character when every file shares it (g1-pick_up, g1-jump, g1-wave). A
// drop-in carries its file name for the same test.
const rigFamily = (spec) =>
  (spec.name || spec.url).split('/').pop().replace(/\.(glb|gltf)$/i, '').split('-')[0].toLowerCase();
const oneCharacter = (specs) => specs.length > 1 && new Set(specs.map(rigFamily)).size === 1;

// A stage whose files are one character in several clips — detected from the
// file names above, or forced either way with `sameRig` in examples.js.
// groundAndNormalize sizes every rig by the tallest frame of its own clip, so
// the clip that raises an arm comes out smaller than the one that does not —
// the G1 waving stood 14% short of the G1 picking up, and a hand-set per-file
// `scale` chased it. Here the clips are sized alike by their BIND-POSE mesh
// instead (restSize): the reference is the clip whose tallest frame is nearest
// its rest size (the plainest pose, so it keeps the size the height rule gave
// it), and every other clip is scaled so its rest size matches. The pivot's
// position, the layout footprint and the lab's chip lift all scale with it —
// each is linear in the pivot's scale.
function equalizeRigs(list, sizes) {
  let refRatio = Infinity;
  for (const pv of list) {
    const u = pv.userData;
    if (!(u.restSize > 0) || !(u.sizeNorm > 0)) continue;
    refRatio = Math.min(refRatio, u.sizeNorm / u.restSize);
  }
  if (!Number.isFinite(refRatio)) return;
  list.forEach((pv, i) => {
    const u = pv.userData;
    if (!(u.restSize > 0)) return;
    const target = (TARGET_HEIGHT * (u.userScale || 1)) / (refRatio * u.restSize);
    const ratio = target / pv.scale.x;
    if (Math.abs(ratio - 1) < 1e-4) return;
    pv.scale.multiplyScalar(ratio);
    pv.position.multiplyScalar(ratio);
    if (sizes[i]) sizes[i].multiplyScalar(ratio);
    if (u.labelLift) u.labelLift *= ratio;
    pv.updateMatrixWorld(true);
  });
}

// ── 7. Stage: framing + teardown ─────────────────────────────────────────────
// Shared floor: graph paper, as the paper teaser's stage draws it
// (render_teaser_unimate.py). Each cell is the background's own tone with a
// hairline along its edges, mip-mapped so the lines survive the thumbnail's size,
// and a radial fade dissolves the paper into the background instead of ending in
// a slab edge. The teaser's cell is 0.75 m under figures about 1.8 m tall.
const FLOOR_CELL = 0.42 * TARGET_HEIGHT;   // world units per grid cell
const FLOOR_LINE = 0.03;                   // line width as a share of a cell
const paperCanvas = document.createElement('canvas');
paperCanvas.width = paperCanvas.height = 256;
const paperTex = new THREE.CanvasTexture(paperCanvas);
paperTex.wrapS = paperTex.wrapT = THREE.RepeatWrapping;
paperTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
paperTex.colorSpace = THREE.SRGBColorSpace;
const fadeCanvas = document.createElement('canvas');
fadeCanvas.width = fadeCanvas.height = 256;
{
  const ctx = fadeCanvas.getContext('2d'), n = fadeCanvas.width;
  const g = ctx.createRadialGradient(n / 2, n / 2, n * 0.2, n / 2, n / 2, n * 0.48);
  g.addColorStop(0, '#fff');
  g.addColorStop(1, '#000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
}
const fadeTex = new THREE.CanvasTexture(fadeCanvas);

// `paper` is graph paper ({ cell, line }, one cell per tile) or a checker
// ({ checker: [base, alternate] }, a 2 × 2 tile of one-cell squares);
// `opacity` dims either over the sky.
let floorSize = 0;   // the last floor's side, so a theme change can re-tile it
function paperTiles(theme = viewerTheme) {
  return VIEWER_THEMES[theme].paper.checker ? 2 : 1;   // cells per texture tile
}
function setPaperRepeat() {
  if (floorSize) paperTex.repeat.setScalar(floorSize / (FLOOR_CELL * paperTiles()));
}
function paintPaper(theme) {
  const paper = VIEWER_THEMES[theme].paper;
  const ctx = paperCanvas.getContext('2d'), n = paperCanvas.width;
  if (paper.checker) {
    const [base, alternate] = paper.checker, h = n / 2;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = alternate;
    ctx.fillRect(0, 0, h, h); ctx.fillRect(h, h, h, h);
  } else {
    const half = Math.max(1, Math.round((n * FLOOR_LINE) / 2));   // half a line on each edge meets its neighbour's
    ctx.fillStyle = paper.cell;
    ctx.fillRect(0, 0, n, n);
    ctx.fillStyle = paper.line;
    ctx.fillRect(0, 0, n, half); ctx.fillRect(0, n - half, n, half);
    ctx.fillRect(0, 0, half, n); ctx.fillRect(n - half, 0, half, n);
  }
  paperTex.needsUpdate = true;
  setPaperRepeat();
  if (grid) grid.material.opacity = paper.opacity ?? 1;
}

function applyViewerTheme(theme) {
  viewerTheme = theme === 'light' ? 'light' : 'dark';
  const palette = VIEWER_THEMES[viewerTheme];
  if (isFullscreenLab) document.documentElement.dataset.theme = viewerTheme;
  scene.background.setHex(palette.background);
  hemiLight.groundColor.setHex(palette.hemisphereGround);
  paintPaper(viewerTheme);
  if (shadowPlane) shadowPlane.material.opacity = palette.shadowOpacity;

  const metaTheme = isFullscreenLab ? document.querySelector('meta[name="theme-color"]') : null;
  if (metaTheme) metaTheme.content = palette.metaColor;
  const themeToggle = document.querySelector('[data-theme-toggle]');
  if (themeToggle) {
    const nextTheme = viewerTheme === 'dark' ? 'light' : 'dark';
    themeToggle.setAttribute('aria-pressed', String(viewerTheme === 'light'));
    themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} palette`);
    const themeName = themeToggle.querySelector('.theme-name');
    if (themeName) themeName.textContent = viewerTheme === 'light' ? 'Light' : 'Dark';
  }

}

applyViewerTheme(viewerTheme);

// Framed: follow the framing page's html[data-theme] (same-origin), and the
// system query, which pageTheme falls back to without a parent.
if (viewerConfig.embedded) {
  const follow = () => applyViewerTheme(window.pageTheme ? window.pageTheme() : 'light');
  try {
    new MutationObserver(follow).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  } catch (e) { /* not framed by the homepage */ }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', follow);
}

// Frame the whole stage: fit the camera to the union of all pivots, drop a paper
// floor. pad > 1 zooms out without moving the models — for a tightly spaced row
// (the two quadrupeds) that still reads too big.
function frameStage(pad = 1.0, orbitAngleDegrees = viewerConfig.initialOrbitAngle || 0) {
  const box = new THREE.Box3();
  // expandByObject measures the pose on screen at this instant — the whole clip for
  // the catalog's in-place loops, but one body's width of a clip that TRAVELS: the
  // floor is cut to that width, the camera zooms to it, and the character walks off
  // both. Under activeFrameEnvelope, union in the clip's full extent, which
  // groundAndNormalize already measured (localBoxFull, pivot-local). Union, not
  // replace: when the mesh can't be sampled localBoxFull falls back to the joints,
  // which sit inside the silhouette (a head joint is below the scalp).
  const envelope = new THREE.Box3();
  for (const pv of pivots) {
    pv.updateWorldMatrix(false, false);   // positions are set post-render; matrixWorld is stale
    box.expandByObject(pv);
    const full = activeFrameEnvelope ? pv.userData.localBoxFull : null;
    if (full && !full.isEmpty()) box.union(envelope.copy(full).applyMatrix4(pv.matrixWorld));
  }
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());

  // Aspect-aware fit: solve the distance that just contains the stage width
  // (horizontal FOV) and the one for its height (vertical FOV), take the larger.
  // Fitting the raw max dimension with the vertical FOV alone over-pulls for a
  // wide row and shrinks it.
  const vFov = camera.fov * (Math.PI / 180);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distV = (size.y / 2) / Math.tan(vFov / 2);
  const distH = (Math.max(size.x, MIN_FRAME_WIDTH) / 2) / Math.tan(hFov / 2);
  let dist = Math.max(distV, distH, size.z);
  // The lab's scene picker floats over the canvas; extra padding keeps the
  // leftmost character from sitting under it.
  const responsiveCameraPadding = phoneLayout.matches ? activeMobileCameraPadding : activeCameraPadding;
  dist *= pad * (isFullscreenLab ? responsiveCameraPadding : 1);

  // applyStageShift translated the objects by activeShift, dragging the box centre
  // with them. Subtract it back out so camera, floor and shadows stay locked on
  // the natural centre: the objects slide off-centre within the frame, the
  // viewpoint never pans.
  const tx = center.x - activeShift[0];
  const ty = center.y - activeShift[1];
  const tz = center.z - activeShift[2];
  // Aim at the stage's own centre on every page and width. Clearing the lab's
  // chrome is a padding question — cameraPadding frames symmetrically, an aim
  // point off the middle does not.
  controls.target.set(tx, ty, tz);
  // Lift the camera above the target so it looks slightly DOWN at the stage
  // instead of dead level.
  const elevation = isFullscreenLab ? viewerConfig.cameraElevation : 0.28;
  const initialOrbitAngle = THREE.MathUtils.degToRad(orbitAngleDegrees);
  camera.position.set(
    tx + Math.sin(initialOrbitAngle) * dist,
    ty + size.y * 0.12 + dist * elevation,
    tz + Math.cos(initialOrbitAngle) * dist,
  );
  camera.near = dist / 100;
  camera.far = dist * 100;
  camera.updateProjectionMatrix();
  controls.update();

  // (Re)build the paper floor sized to the stage — at least the framed width, so
  // it still fills the view when the camera zooms out for a small group.
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  // The 2·shiftMag term lets the still-centred floor reach under a shifted group.
  // activeFloor lets a stage rein that in: on a deep stageShift (Locomotion,
  // −2.5) it inflates the floor until the walkers read lost on it.
  const shiftMag = Math.hypot(activeShift[0], activeShift[2]);
  const gridSize = (Math.max(size.x, size.z, MIN_FRAME_WIDTH, 1) + 2 * shiftMag) * 1.6 * activeFloor;
  floorSize = gridSize;
  setPaperRepeat();   // cells keep their size as the floor grows
  grid = new THREE.Mesh(
    new THREE.PlaneGeometry(gridSize, gridSize),
    // Unlit and untoned, so the paper matches the background exactly and ignores
    // the per-window lighting multiplier; the alpha map fades it out.
    new THREE.MeshBasicMaterial({
      map: paperTex,
      alphaMap: fadeTex,
      transparent: true,
      opacity: VIEWER_THEMES[viewerTheme].paper.opacity ?? 1,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(tx, 0, tz); // the floor is a FIXED datum at y = 0; every model is grounded to it
  grid.renderOrder = -2;        // coplanar transparent planes: paper first, shadow on top
  scene.add(grid);

  // Shadow catcher just over the floor: ShadowMaterial renders ONLY where a shadow
  // falls, so the paper shows through elsewhere.
  if (shadowPlane) { scene.remove(shadowPlane); shadowPlane.geometry.dispose(); shadowPlane.material.dispose(); }
  shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(gridSize, gridSize),
    new THREE.ShadowMaterial({ opacity: VIEWER_THEMES[viewerTheme].shadowOpacity })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(tx, 0.001, tz); // a hair above the floor — no z-fight
  shadowPlane.renderOrder = -1;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  // Fit the key light's ortho shadow frustum to the footprint so shadows stay
  // crisp — a wider frustum over the same map blurs and blockifies them.
  const extent = Math.max(size.x, size.y, size.z, MIN_FRAME_WIDTH) + shiftMag;
  keyLight.target.position.set(tx, 0, tz);
  keyLight.target.updateMatrixWorld();
  const sc = keyLight.shadow.camera;
  sc.left = -extent; sc.right = extent; sc.top = extent; sc.bottom = -extent;
  sc.near = 0.5;
  sc.far = keyLight.position.length() + Math.max(size.x, size.y, size.z) + 20;
  sc.updateProjectionMatrix();
}

function disposeStage() {
  for (const mx of mixers) mx.stopAllAction();
  for (const sk of skeletons) { scene.remove(sk); sk.dispose?.(); }
  for (const pv of pivots) {
    scene.remove(pv);
    pv.traverse((c) => {
      if (c.isMesh) {
        c.geometry?.dispose();
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        mats.forEach((m) => m?.dispose());
      }
    });
  }
  labelLayer.replaceChildren();
  pivots = []; models = []; mixers = []; skeletons = []; labels = [];
  hoveredPromptOrder = null;
}

// ── 8. Layout helpers ────────────────────────────────────────────────────────
// Each helper mutates pivots[].position in place. loadStage runs them in this
// order — row → stagger → behind → above → offsets → fileOffsets → stageShift —
// so later ones build on earlier ones (`above` snaps onto a `behind` model,
// `offset` nudges the final result).

// Spread each `row` group along X (centred on the origin), then push row N back
// along −Z so rows read as a front-to-back diorama. `behind`/`above` models are
// excluded: they anchor to another model later and must not shift a row's centring.
function layoutRows(specs, sizes, spacing, evenGaps, rowDepth = 2.6, rowSpacing = null, rowOrder = null) {
  const members = pivots.map((_, i) => i).filter((i) => !specs[i].behind && !specs[i].above);

  // Row 0 is the front.
  const byRow = new Map();
  for (const i of members) {
    const r = specs[i].row || 0;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(i);
  }

  for (const [r, rowIdx] of byRow) {
    // `rowOrder` re-sorts a row left→right by file index. Placement, not content,
    // so it stays out of the catalog's file order: a page that flattens the ranks
    // may want different rigs on the flanks. Files it omits follow the ones it
    // names, in catalog order.
    if (rowOrder) rowIdx.sort((a, b) => orderRank(rowOrder, a) - orderRank(rowOrder, b));
    // `rowSpacing[r]` overrides the stage `spacing` for this row only.
    const sp = (rowSpacing && rowSpacing[r] != null) ? rowSpacing[r] : spacing;
    placeAlongX(rowIdx, sizes, sp, evenGaps);
    if (r) rowIdx.forEach((i) => { pivots[i].position.z += -r * rowDepth; pivots[i].updateMatrixWorld(true); });
  }
}

// Rank within `rowOrder`; anything it doesn't name sorts after everything it does.
function orderRank(rowOrder, i) {
  const at = rowOrder.indexOf(i);
  return at === -1 ? rowOrder.length + i : at;
}

// Spread one row's members along X, centred on the origin.
function placeAlongX(rowIdx, sizes, spacing, evenGaps) {
  const sp = spacing || ROW_STEP_MULT;
  if (!rowIdx.length) return;

  if (evenGaps) {
    // Even *visual* gaps: edge-to-edge with a constant gap, so a wide model
    // (gyarados) doesn't crowd its neighbour while a narrow one leaves a hole.
    // Gap = widest footprint * (spacing - 1).
    const widths = rowIdx.map((i) => Math.max(0.3, sizes[i].x));
    const gap = Math.max(...widths) * (sp - 1);
    const centers = [];
    let acc = 0;
    for (let k = 0; k < widths.length; k++) {
      if (k > 0) acc += widths[k - 1] / 2 + gap + widths[k] / 2;
      centers.push(acc);
    }
    // Centre on the span's midpoint so the row straddles the origin for any count.
    const mid = (centers[0] + centers[centers.length - 1]) / 2;
    rowIdx.forEach((i, k) => { pivots[i].position.x += centers[k] - mid; pivots[i].updateMatrixWorld(true); });
  } else {
    // Default: pivot centres evenly spaced by the widest footprint.
    const stepX = Math.max(0.5, ...rowIdx.map((i) => sizes[i].x)) * sp;
    const totalX = (rowIdx.length - 1) * stepX;
    rowIdx.forEach((i, k) => {
      pivots[i].position.x += -totalX / 2 + k * stepX;
      pivots[i].updateMatrixWorld(true);
    });
  }
}

// Push alternating models back/forward along Z so the row zig-zags instead of
// sitting on one line. `stagger` is the peak offset in normalized units; even
// indices go back, odd forward.
function applyStagger(stagger) {
  if (!stagger) return;
  pivots.forEach((pv, i) => {
    pv.position.z += ((i % 2) * 2 - 1) * (stagger * 0.5);
    pv.updateMatrixWorld(true);
  });
}

// `behind: [index, depth]` — take that model's X and sit `depth` behind it along −Z.
function placeBehind(specs) {
  pivots.forEach((pv, i) => {
    const b = specs[i].behind;
    const target = b && pivots[b[0]];
    if (!target) return;
    pv.position.x = target.position.x;
    pv.position.z = target.position.z - (b[1] ?? 2.5);
    pv.updateMatrixWorld(true);
  });
}

// `above: [index, height]` — take that model's X/Z and hover `height` units over
// it. Targets may themselves be `above` models (bird → dragon → leopard), so
// resolve in dependency order: a model is placed only once its target is final.
function placeAbove(specs) {
  const placed = new Set();
  for (let pass = 0; pass < pivots.length; pass++) {
    let progressed = false;
    pivots.forEach((pv, i) => {
      const a = specs[i].above;
      if (!a || placed.has(i)) return;
      const ti = a[0];
      if (specs[ti] && specs[ti].above && !placed.has(ti)) return; // target not placed yet
      const target = pivots[ti];
      if (target) {
        pv.position.x = target.position.x;
        pv.position.z = target.position.z;
        pv.position.y += a[1] ?? 1.0;
        pv.updateMatrixWorld(true);
      }
      placed.add(i);
      progressed = true;
    });
    if (!progressed) break;
  }
}

// Stage-level twin of a file's `offset`: { index: [x, y, z] }, added on top of the
// catalog's own nudge rather than replacing it, so a page can move one rig without
// forking the file entry.
function applyFileOffsets(fileOffsets) {
  if (!fileOffsets) return;
  for (const [i, off] of Object.entries(fileOffsets)) {
    const pv = pivots[i];
    if (!pv || !off) continue;
    pv.position.x += off[0] || 0;
    pv.position.y += off[1] || 0;
    pv.position.z += off[2] || 0;
    pv.updateMatrixWorld(true);
  }
}

// Per-file nudge (normalized units, [x, y, z]).
function applyOffsets(specs) {
  pivots.forEach((pv, i) => {
    const off = specs[i].offset;
    if (!off) return;
    pv.position.x += off[0] || 0;
    pv.position.y += off[1] || 0;
    pv.position.z += off[2] || 0;
    pv.updateMatrixWorld(true);
  });
}

// Translate EVERY model by `shift` (normalized units). frameStage subtracts it
// back out of its aim, so the group slides across a stationary floor rather than
// the camera panning — [-1, 0, 0] moves the whole group left within the frame.
function applyStageShift(shift) {
  if (!shift || (!shift[0] && !shift[1] && !shift[2])) return;
  pivots.forEach((pv) => {
    pv.position.x += shift[0] || 0;
    pv.position.y += shift[1] || 0;
    pv.position.z += shift[2] || 0;
    pv.updateMatrixWorld(true);
  });
}

// ── 9. Prompt labels ─────────────────────────────────────────────────────────
// Each model's prompt rides beside it as an HTML chip in #viewer-labels,
// re-positioned every frame from its anchor's projected screen position. HTML
// rather than a sprite: the type stays crisp at any zoom, inherits the page's
// font, and wraps for free. The layer is click-through, so chips never steal a
// drag from OrbitControls.
//
// A chip is two elements: the text, and a `.viewer-pin` mark on the model. The
// line between them is the chip's ::after, whose length and angle this file
// writes as custom properties. That leader is load-bearing: chips dodge each
// other, so without it a lifted chip reads as belonging to whatever it ended up over.
const labelNdc = new THREE.Vector3();

// Prompts are content, not engine config, so they live in resources/prompts.json,
// keyed by FILENAME so a glb reused across stages says the same thing everywhere.
// Fetched once; a failure is non-fatal — the viewer runs without chips. loadStage
// awaits this, so a stage never renders before its text is in.
const PROMPTS = new Map();
// The ?v= matters as much as on the imports: Pages caches the JSON, and a new
// rig's chip would stay missing for returning visitors. Bump it whenever
// prompts.json changes.
const promptsReady = fetch('resources/prompts.json?v=33')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((data) => {
    // '_'-prefixed keys document the file; they aren't models.
    for (const [file, text] of Object.entries(data)) {
      if (!file.startsWith('_')) PROMPTS.set(file, text);
    }
  })
  .catch((err) => console.warn('Prompt labels unavailable:', err));

// A spec's own `prompt` wins (an empty string means "no label"); otherwise the
// shared text for that filename. A dropped file's blob: URL matches nothing, so
// it gets no chip — as intended.
function promptFor(spec) {
  if (spec.prompt != null) return spec.prompt;
  return PROMPTS.get(spec.url.split('/').pop()) || '';
}

// Rebuild the chips for the stage just loaded; a model with no prompt gets no
// entry. Every chip carries its prompt in full, subject included — naming the
// object is worth more than the width it costs, and updateLabels pays for that
// width with slot choice and the collision pass.
function buildLabels(specs) {
  labelLayer.replaceChildren();
  labels = [];

  specs.forEach((s, i) => {
    const text = promptFor(s);
    const anchor = pivots[i] && pivots[i].userData.labelAnchor;
    if (!text || !anchor) return;
    const el = document.createElement('div');
    el.className = 'viewer-label';
    el.textContent = text;
    const pin = document.createElement('div');
    pin.className = 'viewer-pin';
    labelLayer.append(el, pin);
    // `slot` persists between frames — see SLOT_HYSTERESIS.
    labels.push({
      el, pin, anchor, pivot: pivots[i],
      order: i,
      slot: s.labelSlot || 'above',
      lockSlot: s.lockLabelSlot || false,
      offset: s.labelOffset || [0, 0],
      pinOffset: s.labelPinOffset || [0, 0],
      liftScale: s.liftScale || 1,   // lab only — see updateLabelsPinned
      sx: null, sy: null, tx: null, ty: null,
      candidateX: null, candidateY: null, candidateFrames: 0,
      w: 0, h: 0,
    });
  });
  measureLabels();
  applyLabels();
}

// Cache each chip's box once: reading offsetWidth between transform writes in the
// per-frame loop would force a synchronous reflow every frame. The text is fixed,
// so the box changes only with the chip's max-width breakpoint or the font — both
// re-measure below. Anything else that changes a chip's size must call this too.
function measureLabels() {
  for (const l of labels) {
    l.w = l.el.offsetWidth;
    l.h = l.el.offsetHeight;
  }
}
// Roboto Mono arrives after first paint and is wider than the fallback.
document.fonts?.ready.then(measureLabels);

function applyLabels() {
  const layerVisible = settings['show prompts'] && !viewPointerDown && !viewZooming;
  labelLayer.style.display = layerVisible ? '' : 'none';
  if (hoverPromptsActive()) {
    for (const label of labels) {
      const visible = layerVisible && label.order === hoveredPromptOrder;
      label.el.style.display = visible ? '' : 'none';
      label.pin.style.display = visible ? '' : 'none';
    }
  }
}

// Lab: switch between the hover tooltip and pinned chips. The wrapper class is
// what interactive.css reads to restyle the chips (tooltip card vs anchored chip
// with leader and pin), so the boxes change size and are re-measured.
function applyPromptMode() {
  wrapper.classList.toggle('is-pinned-prompts', settings['pin prompts'] === true);
  hoveredPromptOrder = null;
  renderer.domElement.style.cursor = '';
  measureLabels();
  applyLabels();
}

// Lab: show only the prompt of the rig under the pointer. Walking up from the hit
// mesh resolves any child to its rig root. Picks only on pointermove, so under
// auto orbit the prompt goes stale until the pointer moves again (known gap).
// Idle while prompts are pinned — the pick is the hover mode's alone.
if (viewerConfig.hoverPrompts) {
  const hoverRaycaster = new THREE.Raycaster();
  const hoverPointer = new THREE.Vector2();

  const setHoveredPrompt = (order) => {
    if (hoveredPromptOrder === order) return;
    hoveredPromptOrder = order;
    renderer.domElement.style.cursor = order == null ? '' : 'pointer';
    applyLabels();
  };

  renderer.domElement.addEventListener('pointermove', (event) => {
    if (viewPointerDown || event.pointerType === 'touch' || !hoverPromptsActive()) {
      setHoveredPrompt(null);
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    hoverPromptX = event.clientX - rect.left;
    hoverPromptY = event.clientY - rect.top;
    hoverPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    hoverPointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    hoverRaycaster.setFromCamera(hoverPointer, camera);

    const hit = hoverRaycaster.intersectObjects(models, true)[0];
    let node = hit && hit.object;
    let order = null;
    while (node && order == null) {
      const index = models.indexOf(node);
      if (index !== -1) order = index;
      node = node.parent;
    }
    setHoveredPrompt(order);
  });

  renderer.domElement.addEventListener('pointerdown', () => setHoveredPrompt(null));
  renderer.domElement.addEventListener('pointerleave', () => setHoveredPrompt(null));
}

// Chips obscure the models while orbiting, so hide them from pointer-down through
// release. Release is heard on window: a drag ending off the canvas must not
// leave the layer stuck invisible.
const finishViewDrag = (event) => {
  activeViewPointers.delete(event.pointerId);
  if (activeViewPointers.size) return;
  if (!viewPointerDown) return;
  viewPointerDown = false;
  applyLabels();
};
renderer.domElement.addEventListener('pointerdown', (event) => {
  activeViewPointers.add(event.pointerId);
  viewPointerDown = true;
  applyLabels();
});
window.addEventListener('pointerup', finishViewDrag);
window.addEventListener('pointercancel', finishViewDrag);
window.addEventListener('blur', () => {
  activeViewPointers.clear();
  viewPointerDown = false;
  clearTimeout(zoomRestTimer);
  viewZooming = false;
  applyLabels();
});

// Wheel zoom has no pointer to release: hide on the first notch, restore a beat
// after the last. ZOOM_REST_MS outlasts the damped glide (dampingFactor 0.08), so
// chips reappear against a camera that has stopped rather than re-solving through
// the tail of the zoom. Pinch-zoom needs nothing: two fingers down is a pointer drag.
const ZOOM_REST_MS = 320;
let zoomRestTimer = 0;
renderer.domElement.addEventListener('wheel', () => {
  if (!controls.enableZoom) return;
  if (!viewZooming) {
    viewZooming = true;
    applyLabels();
  }
  clearTimeout(zoomRestTimer);
  zoomRestTimer = setTimeout(() => {
    viewZooming = false;
    applyLabels();
  }, ZOOM_REST_MS);
}, { passive: true });

const GAP = 12;      // px of air between a chip's edge and the rig's silhouette
const PIN_RADIUS = 2.5; // .viewer-pin's outer radius, incl. its halo (style.css §8)
const LEADER_COST = 0.5; // chip-areas charged per 100px of leader when scoring slots
const MARGIN_REACH = 40; // px a chip's outer edge may pass the outermost rig. The
                         // margins relieve a jam; they are not for chips to occupy —
                         // let them run to the canvas edge and the picture reads far
                         // wider than the group is.
const MARGIN_BONUS = 0.16; // chip-areas refunded for sitting clear of the whole group,
                           // scaled by crowding (see `spread`). Small on purpose: enough
                           // to break a jam in the middle, not enough to pull chips out
                           // to the canvas edge.
// Where the mark sits: this far from the rig's centre toward its chip, as a
// fraction of the distance to the box edge. Well short of 1 — the centre alone
// leaves the leader crossing half a body, but a box edge (a corner especially) is
// mostly empty air for anything that flaps, and a mark out there floats beside
// the rig instead of sitting on it.
const MARK_INSET = 0.4;
const PILL_PAD = 4;  // px of clearance from the canvas edges and from other chips
// Depth grading. A chip this much farther from the camera than the nearest one is
// fully receded — as a FRACTION of that distance, not an absolute: a side-by-side
// row varies by a few percent and must stay uniform, while a second row sits ~30%
// back and should visibly drop behind. This is what keeps the 9-chip Creatures
// stage and the two-row Armored Robot stage from reading as one flat wall.
const DEPTH_SPAN = 0.35;
const DEPTH_FADE = 0.45;   // opacity given up at full recession
const DEPTH_SHRINK = 0.12; // scale given up at full recession

// Below the phone breakpoint, overlay UI scales from the desktop canvas width:
// the 960px column less the sidebar (165 + 22), the 14px gap and the 3px viewer
// border is 756px. From that exact baseline, prompts and Controls are true
// geometric reductions of the desktop composition, not similar mobile variants.
const DESKTOP_VIEWER_WIDTH = 756;
const phoneLayout = window.matchMedia('(max-width: 720px)');
const promptViewportScale = (width) =>
  phoneLayout.matches ? Math.min(1, width / DESKTOP_VIEWER_WIDTH) : 1;

const MAX_LIFT = 115; // px a chip may be pushed off its model to dodge another. Enough
                      // for the Creatures stage's worst case — the chicken under the
                      // hovering bird, both chips wanting the same patch of sky — and
                      // short enough that a chip still reads as that model's.

// Slots are re-scored every frame (see updateLabels). The slot a chip holds keeps
// it unless another beats it by this fraction of the chip's area, so an orbit
// through a near-tie doesn't make chips jitter.
const SLOT_HYSTERESIS = 0.3;

// Chips resting within this many px of each other snap to a shared baseline. Rigs
// differ in height, so left alone every chip sits at its own level and a row reads
// as scattered from half the angles you can orbit to. Small on purpose: it tidies
// chips already nearly aligned and never drags one away from its model.
const BASELINE_SNAP = 18;

// Chips ease toward their target rather than being re-placed outright: the scene
// is live, and without this a slot flip or a resolved collision teleports the chip
// mid-orbit. ~90ms — short enough to stay glued to the rig, long enough to absorb
// the pop.
const SETTLE_TAU = 0.09;
const SETTLE_SNAP = 220;  // px — a jump this large is a new stage or a re-entry, not
                          // a nudge, so take it instantly instead of sliding across.
const DEPTH_ORDER_EPSILON = 0.04; // near-coplanar chips keep catalog order — see the band sort
const TARGET_SWITCH_DISTANCE = 8; // larger target jumps are usually a solver branch switch
const TARGET_CONFIRM_RADIUS = 6;   // consecutive proposals count as the same new position
const TARGET_CONFIRM_FRAMES = 3;   // ~50ms at 60fps: invisible, but kills A/B oscillation
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Two passes per frame. Pass 1 projects every rig to a screen box and picks each
// chip's slot; pass 2 walks them near→far, pushes each clear of the chips already
// placed, and draws its leader back to the mark. Near→far: the model closest to
// the camera keeps the spot it wants and the ones behind give way — the same read
// as the depth stacking.
const visible = [];
const modelBoxes = [];
const labelWorld = new THREE.Vector3();
const boxCorner = new THREE.Vector3();

// Once its slot is known a chip escapes ALONG the axis pointing away from its
// model ('y' for above/below, 'x' for a side slot) and slides ACROSS the other.
// These read/write whichever coordinate that is, so the escape is written once.
const alongOf = (p, axis) => (axis === 'y' ? p.cy : p.x);
const setAlong = (p, axis, v) => { if (axis === 'y') p.cy = v; else p.x = v; };
const halfOf = (p, axis) => (axis === 'y' ? p.halfH : p.halfW);

// The first already-placed chip this one overlaps, or null. Only nearer chips can
// push it, so the search stops at its own index.
function firstHit(p, upto) {
  for (let j = 0; j < upto; j++) {
    const q = visible[j];
    if (Math.abs(q.x - p.x) < q.halfW + p.halfW + PILL_PAD &&
        Math.abs(q.cy - p.cy) < q.halfH + p.halfH + PILL_PAD) return q;
  }
  return null;
}

// A pivot's on-screen box, from the 8 corners of a box groundAndNormalize stashed.
// Eight projections per rig per frame, where Box3.setFromObject would re-walk the
// geometry.
function screenBox(pivot, w, h, which = 'localBox') {
  const box = pivot && pivot.userData[which];
  if (!box) return null;
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (let i = 0; i < 8; i++) {
    boxCorner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    );
    pivot.localToWorld(boxCorner).project(camera);
    if (boxCorner.z > 1) return null;               // straddles the camera plane
    const sx = (boxCorner.x * 0.5 + 0.5) * w;
    const sy = (-boxCorner.y * 0.5 + 0.5) * h;
    if (sx < left) left = sx;
    if (sx > right) right = sx;
    if (sy < top) top = sy;
    if (sy > bottom) bottom = sy;
  }
  return { left, right, top, bottom };
}

// Area of a chip centred at (cx, cy) that lands on a box.
function coverage(cx, cy, halfW, halfH, box) {
  const ox = Math.min(cx + halfW, box.right) - Math.max(cx - halfW, box.left);
  const oy = Math.min(cy + halfH, box.bottom) - Math.max(cy - halfH, box.top);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

function coveredArea(cx, cy, halfW, halfH) {
  let total = 0;
  for (const b of modelBoxes) total += coverage(cx, cy, halfW, halfH, b);
  return total;
}

// The lab's pinned prompts: a nameplate, not a solved layout. Each chip stands
// straight above its rig's ROOT JOINT at a fixed world height (labelLift), the
// pin sits on the joint itself and the leader runs vertically between them —
// every frame, wherever the joint has walked to, with no collision pass, no
// slot choice, no easing and no depth grading. Two chips may overlap; that is
// the trade for a mark that is always exactly where the skeleton is. The lift
// is projected as a world point so the plate reads as part of the scene: it
// grows on zoom and shrinks with distance, like the rig under it.
const liftWorld = new THREE.Vector3();
let stageLiftAir = LIFT_AIR;   // LIFT_AIR at the current stage's scale; set by loadStage
let stageLiftScale = 1;        // the stage's `liftScale` (examples.js); set by loadStage
function updateLabelsPinned(w, h, viewportScale) {
  for (const l of labels) {
    const u = l.pivot.userData;
    (u.rootJoint || l.anchor).getWorldPosition(labelWorld);
    labelNdc.copy(labelWorld).project(camera);
    liftWorld.copy(labelWorld);
    liftWorld.y += (u.labelLift || 0) * stageLiftScale * l.liftScale + stageLiftAir;
    liftWorld.project(camera);
    if (labelNdc.z > 1 || liftWorld.z > 1) {
      l.el.style.display = 'none';
      l.pin.style.display = 'none';
      continue;
    }
    l.el.style.display = '';
    l.pin.style.display = '';
    l.pin.style.visibility = '';
    const px = (labelNdc.x * 0.5 + 0.5) * w;
    const py = (-labelNdc.y * 0.5 + 0.5) * h;
    // Straight above means the joint's own x: the lifted point's x drifts a few
    // px with perspective, and a leader that leans reads as pointing elsewhere.
    const top = (-liftWorld.y * 0.5 + 0.5) * h;
    const scale = viewportScale;
    const halfH = l.h * scale / 2;
    const cy = top - halfH;   // the chip's bottom edge rests on the lifted point
    l.el.style.opacity = '1';
    l.el.style.transform =
      `translate3d(${px.toFixed(1)}px, ${cy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
    // Leader: from the chip's bottom edge down to the pin's rim. The CSS anchors
    // it at the chip's centre as a child scaled with it, hence the divisions.
    const len = Math.max(0, py - cy - halfH - PIN_RADIUS);
    l.el.style.setProperty('--leader-x', '0px');
    l.el.style.setProperty('--leader-y', `${(l.h / 2).toFixed(1)}px`);
    l.el.style.setProperty('--leader', len > 5 ? `${(len / scale).toFixed(1)}px` : '0px');
    l.el.style.setProperty('--leader-angle', '0rad');
    l.pin.style.opacity = '1';
    l.pin.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
  }
}

function updateLabels(dt) {
  if (!labels.length || !settings['show prompts']) return;
  const w = wrapper.clientWidth;
  const h = wrapper.clientHeight;
  const viewportScale = promptViewportScale(w);

  // The lab's hover mode shows one prompt as a tooltip beside the cursor — flipped
  // to the other side near an edge, clamped to the canvas — and returns here.
  // Don't add hover behaviour past this branch.
  if (hoverPromptsActive()) {
    const active = labels.find((label) => label.order === hoveredPromptOrder);
    for (const label of labels) {
      label.el.style.display = label === active ? '' : 'none';
      label.pin.style.display = 'none';
    }
    if (!active) return;

    const gap = 18;
    const tooltipW = active.w || active.el.offsetWidth;
    const tooltipH = active.h || active.el.offsetHeight;
    let x = hoverPromptX + gap;
    let y = hoverPromptY - tooltipH / 2;
    if (x + tooltipW > w - 10) x = hoverPromptX - gap - tooltipW;
    x = THREE.MathUtils.clamp(x, 10, Math.max(10, w - tooltipW - 10));
    y = THREE.MathUtils.clamp(y, 10, Math.max(10, h - tooltipH - 10));
    active.el.style.opacity = '1';
    active.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    return;
  }

  // The lab's other mode — Text Prompts on — has its own placement and returns
  // here too, so the anchored solver below is the project page's alone and never
  // runs in the lab.
  if (isFullscreenLab) {
    updateLabelsPinned(w, h, viewportScale);
    return;
  }

  // Every rig on the stage, chips or not — an unlabelled model must not be covered
  // by someone else's chip either.
  modelBoxes.length = 0;
  let stageLeft = Infinity;
  let stageRight = -Infinity;
  for (const pv of pivots) {
    const b = screenBox(pv, w, h, 'localBoxFull');   // everything that is drawn
    if (b) {
      modelBoxes.push(b);
      stageLeft = Math.min(stageLeft, b.left);
      stageRight = Math.max(stageRight, b.right);
    }
  }

  // How hard this stage is. Four rigs have room for every chip above its own
  // model; nine do not, and packing them into one middle band is what makes a
  // stage look crowded. The busier it gets, the more willing chips are to take
  // the clear margins down either flank — and the less each px of leader costs,
  // since reaching that space is the point.
  const spread = Math.min(1, Math.max(0, (labels.length - 4) / 5));

  // Horizontal bounds for a chip of half-width `hw`: inside the canvas, and no
  // more than MARGIN_REACH past the group.
  const spanX = (v, hw) => {
    const lo = Math.max(hw + PILL_PAD, Math.min(stageLeft - MARGIN_REACH + hw, w / 2));
    const hi = Math.min(w - hw - PILL_PAD, Math.max(stageRight + MARGIN_REACH - hw, w / 2));
    return Math.min(Math.max(v, Math.min(lo, hi)), Math.max(lo, hi));
  };
  const canvasX = (v, hw) =>
    THREE.MathUtils.clamp(v, hw + PILL_PAD, Math.max(hw + PILL_PAD, w - hw - PILL_PAD));

  visible.length = 0;
  let nearest = Infinity;
  for (const l of labels) {
    l.anchor.getWorldPosition(labelWorld);
    const dist = camera.position.distanceTo(labelWorld);
    labelNdc.copy(labelWorld).project(camera);
    // Behind the camera (z > 1) or well off the canvas: hide it. Parked on the
    // edge it would point at nothing.
    if (labelNdc.z > 1 || Math.abs(labelNdc.x) > 1.05 || Math.abs(labelNdc.y) > 1.15) {
      l.el.style.display = 'none';
      l.pin.style.display = 'none';
      l.sx = null;   // re-entering the frame should place it, not slide it in
      continue;
    }
    l.el.style.display = '';
    l.pin.style.display = '';
    // The anchor's screen point — the centre of the rig's envelope.
    const ax = (labelNdc.x * 0.5 + 0.5) * w;
    const ay = (-labelNdc.y * 0.5 + 0.5) * h;
    // l.w/l.h are the unscaled layout box; place with the visual box so phone
    // chips don't reserve desktop-sized gaps.
    const halfW = l.w * viewportScale / 2;
    const halfH = l.h * viewportScale / 2;
    // Keep the whole chip inside the frame: a model near an edge would otherwise
    // lose half its text to the layer's clip. A nudged label beats a cropped one,
    // and the leader still says whose it is.
    const x = THREE.MathUtils.clamp(ax, halfW + PILL_PAD, Math.max(halfW + PILL_PAD, w - halfW - PILL_PAD));

    // Eight candidate slots: the four sides and four diagonals off the corners.
    // Each is scored by how much MODEL it would cover and the cheapest wins — on a
    // diorama that sends the front row's chips down onto the empty floor and
    // leaves the back row's in the sky, and puts an edge rig's chip out in the
    // margin instead of over its neighbours. The diagonals are for rigs boxed in
    // on every side: the chicken between the monster, the stegosaurus and the
    // whale has no clear side, and without a corner its chip sits on a neighbour.
    const own = screenBox(l.pivot, w, h) || { left: ax - 1, right: ax + 1, top: ay - 1, bottom: ay + 1 };
    const ownX = (own.left + own.right) / 2;
    const ownY = (own.top + own.bottom) / 2;
    // Every slot clears `own`, the typical envelope (localBox); coverage is charged
    // against the full one (coveredArea). Whichever slot wins, the leader runs back
    // toward the one anchor (ax, ay), so a rig has one mark and neither end
    // twitches with the animation.
    const diag = GAP * 0.7;
    const slots = {
      above: { x: ax, cy: own.top - GAP - halfH, axis: 'y', sign: -1 },
      below: { x: ownX, cy: own.bottom + GAP + halfH, axis: 'y', sign: 1 },
      left: { x: own.left - GAP - halfW, cy: ownY, axis: 'x', sign: -1 },
      right: { x: own.right + GAP + halfW, cy: ownY, axis: 'x', sign: 1 },
      aboveLeft: { x: own.left - diag - halfW, cy: own.top - diag - halfH, axis: 'y', sign: -1 },
      aboveRight: { x: own.right + diag + halfW, cy: own.top - diag - halfH, axis: 'y', sign: -1 },
      belowLeft: { x: own.left - diag - halfW, cy: own.bottom + diag + halfH, axis: 'y', sign: 1 },
      belowRight: { x: own.right + diag + halfW, cy: own.bottom + diag + halfH, axis: 'y', sign: 1 },
    };

    // Preferences, in chip-areas. Above is the convention and pays nothing; below
    // a little; a side or corner more; and one pointing back INTO the group most —
    // the value of leaving the rig's column is the margin it reaches, so only outward.
    const area = halfW * 2 * halfH * 2;
    const bias = {
      above: 0, below: 0.02, left: 0.06, right: 0.06,
      aboveLeft: 0.09, aboveRight: 0.09, belowLeft: 0.09, belowRight: 0.09,
    };
    const inward = ownX < w / 2 ? 'right' : 'left';
    for (const name of Object.keys(bias)) {
      if (name.toLowerCase().includes(inward)) bias[name] += 0.5;
    }

    let best = l.slot;
    let bestCost = Infinity;
    const candidateSlots = l.lockSlot ? [l.slot] : Object.keys(slots);
    for (const name of candidateSlots) {
      const s = slots[name];
      const sx = spanX(s.x, halfW);
      const sy = THREE.MathUtils.clamp(s.cy, halfH + PILL_PAD, Math.max(halfH + PILL_PAD, h - halfH - PILL_PAD));
      // Distance is part of the cost. Without it the solver buys a clear patch of
      // floor with a leader half the frame long, and a chip tethered that far
      // stops reading as anyone's. Eased off on a crowded stage, where the nearest
      // space isn't free.
      const reach = Math.hypot(sx - ax, sy - ay) / 100 * LEADER_COST * (1 - 0.25 * spread);
      // Out in the side margin, clear of every rig: a discount once the stage is
      // busy, nothing on a stage with room anyway.
      const inMargin = sx + halfW < stageLeft || sx - halfW > stageRight;
      const margin = inMargin ? MARGIN_BONUS * spread : 0;
      const cost = coveredArea(sx, sy, halfW, halfH)
        + (bias[name] * (1 - 0.5 * spread) + reach - margin) * area;
      const stickiness = name === l.slot ? SLOT_HYSTERESIS * area : 0;
      if (cost - stickiness < bestCost) { bestCost = cost - stickiness; best = name; }
    }
    l.slot = best;
    const chosen = slots[best];
    chosen.x += l.offset[0];
    chosen.cy += l.offset[1];

    visible.push({
      label: l, el: l.el, pin: l.pin, halfW, halfH, depth: labelNdc.z, dist,
      // A locked chip may sit outside the group margin (the putter prompt sits
      // beneath the Controls panel).
      x: l.lockSlot ? canvasX(chosen.x, halfW) : spanX(chosen.x, halfW),
      cy: chosen.cy,
      ax, ay, box: own,
      axis: chosen.axis, sign: chosen.sign,
    });
    visible[visible.length - 1].rest = chosen.axis === 'y' ? chosen.cy : visible[visible.length - 1].x;
    if (dist < nearest) nearest = dist;
  }

  // Snap near-equal chips in the same slot to a shared baseline (BASELINE_SNAP):
  // horizontal for above/below, vertical for side slots. BEFORE the collision
  // pass, so anything the snap pushes into a neighbour still gets separated;
  // snapping afterwards would undo that.
  for (const key of ['y-1', 'y1', 'x-1', 'x1']) {
    const axis = key[0];
    const band = visible.filter((p) => axis + p.sign === key)
      .sort((a, b) => alongOf(a, axis) - alongOf(b, axis));
    for (let i = 0; i < band.length;) {
      let j = i + 1;
      while (j < band.length && alongOf(band[j], axis) - alongOf(band[i], axis) < BASELINE_SNAP) j++;
      if (j - i > 1) {
        const line = alongOf(band[Math.floor((i + j - 1) / 2)], axis);  // cluster median
        for (let k = i; k < j; k++) { setAlong(band[k], axis, line); band[k].rest = line; }
      }
      i = j;
    }
  }

  // Side-by-side rigs are effectively at one depth. Sorted by their tiny depth
  // difference, collision ownership swaps every frame around a tie and sends both
  // chips searching in opposite directions. So: near-coplanar bands
  // (DEPTH_ORDER_EPSILON), catalog order within each; real front/back rows stay
  // ordered by distance.
  visible.sort((a, b) => a.dist - b.dist);
  for (let start = 0; start < visible.length;) {
    let end = start + 1;
    const bandNear = visible[start].dist;
    while (end < visible.length &&
           (visible[end].dist - bandNear) / Math.max(1e-6, bandNear) <= DEPTH_ORDER_EPSILON) {
      end++;
    }
    visible.splice(
      start,
      end - start,
      ...visible.slice(start, end).sort((a, b) => a.label.order - b.label.order)
    );
    start = end;
  }
  for (let i = 0; i < visible.length; i++) {
    const p = visible[i];
    // Only nearer (already-placed) chips can push this one; re-check after each
    // move, since clearing one chip can slide it into another.
    for (let pass = 0; pass < visible.length; pass++) {
      const hit = firstHit(p, i);
      if (!hit) break;
      // Escape, in order of preference. Each step is taken only if it ACTUALLY
      // clears the chip in the way — a move clamped short of clearing leaves the
      // overlap in place and the loop spinning on it, which is how a chip pinned
      // against the canvas edge used to stay stuck under another.
      const A = p.axis;                       // away from the model
      const B = A === 'y' ? 'x' : 'y';        // across it
      const limA = A === 'y' ? h : w;
      const limB = B === 'y' ? h : w;
      const stepA = halfOf(hit, A) + halfOf(p, A) + PILL_PAD;
      const stepB = halfOf(hit, B) + halfOf(p, B) + PILL_PAD;
      const nudged = alongOf(hit, A) + p.sign * stepA;
      const edge = p.sign < 0 ? halfOf(p, A) + PILL_PAD : limA - halfOf(p, A) - PILL_PAD;
      const capped = p.sign < 0
        ? Math.max(p.rest - MAX_LIFT, edge)
        : Math.min(p.rest + MAX_LIFT, edge);
      const side = alongOf(p, B) >= alongOf(hit, B) ? 1 : -1;
      const slid = B === 'x'
        ? spanX(alongOf(hit, B) + side * stepB, p.halfW)
        : THREE.MathUtils.clamp(alongOf(hit, B) + side * stepB,
            halfOf(p, B) + PILL_PAD, Math.max(halfOf(p, B) + PILL_PAD, limB - halfOf(p, B) - PILL_PAD));

      if (p.sign < 0 ? nudged >= capped : nudged <= capped) {
        // 1. Further out along its own axis, within the travel cap. A chip that
        //    chose "below" is never pushed back up over the rigs it just cleared.
        setAlong(p, A, nudged);
      } else if (Math.abs(slid - alongOf(hit, B)) >= stepB - 0.5) {
        // 2. Out of room along the axis but not across it: slide past sideways.
        setAlong(p, B, slid);
      } else if (p.sign < 0 ? nudged >= edge : nudged <= edge) {
        // 3. Neither fits inside the cap. Overrun it rather than overlap — a far
        //    chip still reads via its leader; two chips on top of each other read
        //    as nothing.
        setAlong(p, A, nudged);
      } else {
        // 4. That side of the canvas is full: cross to the far side of the chip in
        //    the way. Only reached at steep angles, where the rigs bunch into the
        //    middle and every band runs out at once.
        const crossed = alongOf(hit, A) - p.sign * stepA;
        const far = p.sign < 0 ? limA - halfOf(p, A) - PILL_PAD : halfOf(p, A) + PILL_PAD;
        if (p.sign < 0 ? crossed <= far : crossed >= far) setAlong(p, A, crossed);
        else break;  // genuinely nowhere left to go
      }
    }
    // Last resort. The chain above can ping-pong — past one chip, into the next,
    // back — and run out of passes still overlapping. Step out from the rest
    // position in whole-chip increments and take the first clear spot; the canvas
    // is finite and the step a full chip, so this terminates.
    if (firstHit(p, i)) {
      const A = p.axis;
      const lim = A === 'y' ? h : w;
      const step = 2 * halfOf(p, A) + PILL_PAD;
      const home = alongOf(p, A);
      let landed = false;
      for (let n = 1; n <= 8 && !landed; n++) {
        for (const s of [p.sign, -p.sign]) {
          const v = p.rest + s * n * step;
          if (v < halfOf(p, A) + PILL_PAD || v > lim - halfOf(p, A) - PILL_PAD) continue;
          setAlong(p, A, v);
          if (!firstHit(p, i)) { landed = true; break; }
        }
      }
      if (!landed) setAlong(p, A, home);   // nowhere clear; keep the best it had
    }

    // Keep it on the canvas. Don't re-apply the travel cap here — step 3 gave it
    // up deliberately, and re-clamping would restore the overlap.
    p.cy = THREE.MathUtils.clamp(p.cy, p.halfH + PILL_PAD, Math.max(p.halfH + PILL_PAD, h - p.halfH - PILL_PAD));
    p.x = p.label.lockSlot ? canvasX(p.x, p.halfW) : spanX(p.x, p.halfW);

    // A crowded layout can have two equally valid escape routes; don't let an
    // A/B/A/B sequence show. Small tracking motion is accepted at once; a large
    // branch switch must propose the same destination for three consecutive
    // frames. A genuinely better spot moves after ~50ms; an unstable one never does.
    const lab = p.label;
    if (lab.tx == null) {
      lab.tx = p.x; lab.ty = p.cy;
    } else if (Math.hypot(p.x - lab.tx, p.cy - lab.ty) <= TARGET_SWITCH_DISTANCE) {
      lab.tx = p.x; lab.ty = p.cy;
      lab.candidateFrames = 0;
    } else {
      const sameCandidate = lab.candidateX != null &&
        Math.hypot(p.x - lab.candidateX, p.cy - lab.candidateY) <= TARGET_CONFIRM_RADIUS;
      if (sameCandidate) {
        lab.candidateFrames++;
      } else {
        lab.candidateX = p.x;
        lab.candidateY = p.cy;
        lab.candidateFrames = 1;
      }
      if (lab.candidateFrames >= TARGET_CONFIRM_FRAMES) {
        lab.tx = p.x; lab.ty = p.cy;
        lab.candidateFrames = 0;
      }
    }
    p.x = lab.tx;
    p.cy = lab.ty;

    // Ease onto the target (SETTLE_TAU). Everything above is where the chip
    // BELONGS; this is where it is drawn on the way there.
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt / SETTLE_TAU);
    if (lab.sx == null || Math.hypot(p.x - lab.sx, p.cy - lab.sy) > SETTLE_SNAP) {
      lab.sx = p.x; lab.sy = p.cy;
    } else {
      lab.sx += (p.x - lab.sx) * k;
      lab.sy += (p.cy - lab.sy) * k;
    }

    // Recession: 0 at the nearest chip, 1 once DEPTH_SPAN farther away. The
    // collision pass ran on UNSCALED boxes, so a shrunken chip only ever clears
    // its neighbours by more than asked.
    const t = Math.min(1, Math.max(0, (p.dist / nearest - 1) / DEPTH_SPAN));
    const scale = viewportScale * (1 - DEPTH_SHRINK * t);
    p.el.style.opacity = p.pin.style.opacity = (1 - DEPTH_FADE * t).toFixed(3);
    p.el.style.transform =
      `translate3d(${lab.sx.toFixed(1)}px, ${lab.sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;

    // The leader runs from the chip's border to the mark. It starts where the ray
    // to the mark exits the chip's box, so it works from any edge — a chip below
    // its model draws up from its top, one beside it sideways — and never from
    // under the opaque fill. Offsets and length are divided by `scale` because CSS
    // anchors the line at the chip's centre, as a child scaled with it.
    //
    // The mark: from the rig's centre toward the chip, MARK_INSET of the way to
    // the box edge.
    let markX = p.ax, markY = p.ay;
    const outX = lab.sx - p.ax;
    const outY = lab.sy - p.ay;
    if (p.box && (outX || outY)) {
      const tx = outX > 0 ? (p.box.right - p.ax) / outX : outX < 0 ? (p.box.left - p.ax) / outX : Infinity;
      const ty = outY > 0 ? (p.box.bottom - p.ay) / outY : outY < 0 ? (p.box.top - p.ay) / outY : Infinity;
      const t = Math.max(0, Math.min(1, Math.min(tx, ty))) * MARK_INSET;
      markX = p.ax + outX * t;
      markY = p.ay + outY * t;
    }
    markX += p.label.pinOffset[0];
    markY += p.label.pinOffset[1];

    // From the SETTLED position, not the target — otherwise the line detaches from
    // its chip for the length of every transition.
    const dx = markX - lab.sx;
    const dy = markY - lab.sy;
    const dist2 = Math.hypot(dx, dy);
    // A chip over its own model's edge has nothing to span: the mark would sit on
    // its text. Drop both — the chip is already touching the rig it names.
    const onTop = Math.abs(dx) < p.halfW * scale + 2 && Math.abs(dy) < p.halfH * scale + 2;
    p.pin.style.visibility = onTop ? 'hidden' : '';
    const exit = dist2 > 0.001
      ? Math.min(p.halfW * scale / Math.abs(dx || 1e-6), p.halfH * scale / Math.abs(dy || 1e-6))
      : 0;
    // Stop at the mark's edge: the ring is hollow, and a leader run to its centre
    // draws straight through it.
    const len = Math.max(0, dist2 * (1 - exit) - PIN_RADIUS);
    p.el.style.setProperty('--leader-x', `${(dx * exit / scale).toFixed(1)}px`);
    p.el.style.setProperty('--leader-y', `${(dy * exit / scale).toFixed(1)}px`);
    p.el.style.setProperty('--leader', len > 5 && !onTop ? `${(len / scale).toFixed(1)}px` : '0px');
    p.el.style.setProperty('--leader-angle', `${Math.atan2(-dx, dy).toFixed(3)}rad`);
    p.pin.style.transform = `translate3d(${markX.toFixed(1)}px, ${markY.toFixed(1)}px, 0) translate(-50%, -50%)`;

    // Whatever overlap survives, the nearer chip wins. The sort index gives every
    // chip a distinct rank where depth alone ties (NDC z bunches near 1) and would
    // leave the winner to DOM order.
    const rank = String(visible.length - i);
    p.el.style.zIndex = rank;
    p.pin.style.zIndex = rank;
  }
}

// ── 10. Load a stage / example / dropped files ───────────────────────────────
// Expand a catalog entry's `files` into normalized specs, then load it.
function loadExample(index) {
  const shared = EXAMPLES[index];
  currentStageIndex = index;
  // Lab only: keep the address bar on the stage on screen (see Deep links).
  // replaceState, not location.hash — no history entry per click, no scroll.
  if (isFullscreenLab) history.replaceState(null, '', '#' + stageSlug(shared.label));
  const ex = { ...shared };
  const specs = ex.files.map((f) => {
    const o = typeof f === 'string' ? { url: f } : f;
    return {
      url: o.url,
      material: o.material || null,
      groundToMesh: !!o.groundToMesh,
      groundFrame: (o.groundFrame ?? null),
      rotate: o.rotate || null,
      offset: o.offset || null,
      behind: o.behind || null,
      above: o.above || null,
      scale: o.scale || null,
      // `singleRow` flattens the ranks here rather than editing the shared files' `row`.
      row: ex.singleRow ? 0 : (o.row || 0),
      prompt: (o.prompt ?? null),   // ?? not ||: '' is a real value ("no label")
      labelSlot: o.labelSlot || null,
      lockLabelSlot: o.lockLabelSlot || false,
      labelOffset: o.labelOffset || null,
      labelPinOffset: o.labelPinOffset || null,
      liftScale: o.liftScale || null,
    };
  });
  return loadStage(specs, index, {
    scale: ex.scale, spacing: ex.spacing, rowSpacing: ex.rowSpacing, pad: ex.pad, lighting: ex.lighting,
    evenGaps: ex.evenGaps, sizeBy: ex.sizeBy, stagger: ex.stagger, rowDepth: ex.rowDepth, rowOrder: ex.rowOrder, fileOffsets: ex.fileOffsets,
    stageShift: ex.stageShift, floor: ex.floor, liftScale: ex.liftScale, sameRig: ex.sameRig, frameEnvelope: ex.frameEnvelope,
    cameraPadding: viewerConfig.cameraPaddingByCategory?.[ex.label],
    mobileCameraPadding: viewerConfig.mobileCameraPaddingByCategory?.[ex.label],
  });
}

// activeIndex: the sidebar row to highlight, or null for a drop-in. opts: the
// stage's layout options (vocabulary in examples.js), plus `cameraPadding` /
// `mobileCameraPadding` (this stage's cameraPaddingByCategory entries, falling
// back to the page-wide values), `label` (a drop-in names itself) and
// `frameEnvelope` (frame/floor the whole clip, not the pose on screen).
async function loadStage(specs, activeIndex, opts = {}) {
  const token = ++loadToken;
  overlay.innerHTML = LOADING_HTML;
  overlay.style.display = 'flex';
  // A drop-in has no sidebar row (activeIndex null), so every row goes off.
  [...sidebar.children].forEach((b, i) => {
    const on = i === activeIndex;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // "Open full screen" hands the visitor's place to the lab on the slug the lab
  // writes to its own address bar, so the pages agree by LABEL and neither depends
  // on the other's indices. The markup ships bare interactive.html: the JS-off
  // fallback, and where a drop-in sends you, having no stage for the lab to open on.
  if (expandLink) {
    const slug = activeIndex == null ? '' : '#' + stageSlug(EXAMPLES[activeIndex].label);
    expandLink.href = 'interactive.html' + slug;
  }
  if (stageName) {
    // A drop-in names itself (opts.label); 'Imported model' if it has no name.
    const heading = (activeIndex == null) ? (opts.label || 'Imported model') : EXAMPLES[activeIndex].label;
    stageName.textContent = heading;
    // A file name is the one label long enough to ellipsize in the 216px status
    // line (the catalog's longest fits), so only a drop-in needs the full text on
    // hover — and a previous drop's tooltip must not outlive it.
    if (activeIndex == null) stageName.title = heading;
    else stageName.removeAttribute('title');
  }

  try {
    const [loaded] = await Promise.all([
      Promise.all(specs.map((s) => loadModel(s.url))),
      promptsReady,   // settles once and never rejects, so only the first stage waits
    ]);
    if (token !== loadToken) return; // a newer click superseded this load

    disposeStage();

    // Per model: repair materials, wrap in a pivot, animate, normalize + ground.
    const sizes = [];
    for (let li = 0; li < loaded.length; li++) {
      const { model, animations } = loaded[li];
      fixMaterials(model);
      applyMaterialOverride(model, specs[li].material);
      model.visible = settings['show model'];

      // The pivot takes the ground + normalize transform; the model's own is untouched.
      const pivot = new THREE.Group();
      pivot.add(model);
      scene.add(pivot);

      // Per-file reorientation (degrees, [x, y, z]) BEFORE grounding, so the model
      // is re-centred and re-grounded in its new orientation.
      const rot = specs[li].rotate;
      if (rot) {
        const d = Math.PI / 180;
        model.rotation.set((rot[0] || 0) * d, (rot[1] || 0) * d, (rot[2] || 0) * d);
      }

      const clip = (animations && animations.length) ? animations[0] : null;
      let mixer = null;
      if (clip) {
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(clip).play();
        mixers.push(mixer);
      }

      // Unit mesh-height, lowest joint on y = 0 (the Blender port).
      const userScale = (opts.scale || 1) * (specs[li].scale || 1);
      sizes.push(groundAndNormalize(pivot, model, mixer, clip, userScale, specs[li].groundToMesh, opts.sizeBy, specs[li].groundFrame) || new THREE.Vector3(1, 1, 1));

      const skeleton = new THREE.SkeletonHelper(model);
      skeleton.visible = settings['show skeleton'];
      // The helper is transparent with depthTest off — "always visible" by design.
      // But the floor is transparent too, and the transparent pass sorts by
      // distance: a far rig's skeleton draws BEFORE the floor, which paints over it
      // and leaves a ghost. renderOrder puts every helper after the floor and
      // shadow plane, where depthTest:false already means it wins.
      skeleton.renderOrder = 2;
      scene.add(skeleton);

      pivots.push(pivot);
      models.push(model);
      skeletons.push(skeleton);
    }

    // One character in several clips: size them alike before the layout reads
    // their footprints. A stage that mixes characters keeps the per-clip height
    // rule — their rest sizes are not comparable.
    if (opts.sameRig ?? oneCharacter(specs)) equalizeRigs(pivots, sizes);

    // Position the stage (order matters — see the Layout helpers header).
    activeShift = opts.stageShift || [0, 0, 0];
    layoutRows(specs, sizes, opts.spacing, opts.evenGaps, opts.rowDepth, opts.rowSpacing, opts.rowOrder);
    applyStagger(opts.stagger);
    placeBehind(specs);
    placeAbove(specs);
    applyOffsets(specs);
    applyFileOffsets(opts.fileOffsets);
    applyStageShift(activeShift);

    applyWireframe();
    applyLighting(opts.lighting || 1);
    buildLabels(specs); // anchors ride the pivots, so this may run before or after layout
    activeCameraPadding = opts.cameraPadding ?? viewerConfig.cameraPadding ?? 1;
    activeMobileCameraPadding = opts.mobileCameraPadding ?? viewerConfig.mobileCameraPadding ?? activeCameraPadding;
    activePad = opts.pad || 1.0;
    activeFloor = opts.floor || 1;
    activeFrameEnvelope = !!opts.frameEnvelope;
    stageLiftAir = LIFT_AIR * TARGET_HEIGHT * (opts.scale || 1);
    stageLiftScale = opts.liftScale || 1;
    const openingAngle = settings['auto orbit'] ? (viewerConfig.initialOrbitAngle || 0) : 0;
    frameStage(activePad, openingAngle);
    overlay.style.display = 'none';
  } catch (err) {
    if (token !== loadToken) return;
    console.error('Failed to load stage', err);
    overlay.textContent = 'Failed to load model.';
  }
}

function loadFiles(fileList) {
  const files = [...fileList].filter((f) => /\.(glb|gltf)$/i.test(f.name));
  if (!files.length) return;
  // groundToMesh on every drop-in. The catalog grounds on the lowest JOINT, which
  // holds because its rigs have foot joints at the sole (the few that don't carry
  // the flag). A visitor's rig is unknown — a belly-slung spine, a fish, a mech
  // with joints inside the shell all hover — and the lowest MESH vertex is the one
  // rule that grounds any of them without knowing the skeleton.
  const specs = files.map((f) => ({ url: URL.createObjectURL(f), name: f.name, groundToMesh: true }));
  // Named after the file: the status line is the only thing saying what is loaded,
  // and two drops in a row are otherwise indistinguishable. The stem is verbatim —
  // prettifying `wall_e-greet` gets it wrong more often than not.
  const label = files.length === 1
    ? files[0].name.replace(/\.(glb|gltf)$/i, '')
    : `${files.length} imported models`;
  // frameEnvelope: a visitor's clip may travel where the catalog's loop in place,
  // so the floor has to cover the path, not the opening pose.
  loadStage(specs, null, { label, frameEnvelope: true });
}

// ── 11. UI wiring ────────────────────────────────────────────────────────────
// The lab drives its settings from a keyboard-first dock.
const dockControls = [...wrapper.querySelectorAll('[data-setting]')];
const embedControls = [...document.querySelectorAll('.embed-control-bar [data-setting]')];
const dockActions = [...wrapper.querySelectorAll('[data-action]')];
const themeToggle = wrapper.querySelector('[data-theme-toggle]');

function setDisplaySetting(key, value, buttons) {
    settings[key] = value;
    if (key === 'show model') models.forEach((model) => { model.visible = value; });
    if (key === 'show skeleton') skeletons.forEach((skeleton) => { skeleton.visible = value; });
    if (key === 'wireframe') applyWireframe();
    if (key === 'pin prompts') applyPromptMode();
    if (key === 'auto orbit') controls.autoRotate = value;

    for (const button of buttons) {
      if (button.dataset.setting !== key) continue;
      button.classList.toggle('is-active', value);
      button.setAttribute('aria-pressed', String(value));
    }
}

for (const button of embedControls) {
  button.addEventListener('click', () => {
    const key = button.dataset.setting;
    if (!key) return;
    setDisplaySetting(key, !settings[key], embedControls);
    if (key === 'paused') {
      const label = button.querySelector('[data-playback-label]');
      if (label) label.textContent = settings.paused ? 'Play' : 'Pause';
    }
  });
}

if (isFullscreenLab) {
  function setDockSetting(key, value) {
    setDisplaySetting(key, value, dockControls);
  }
  // The Text Prompts switch opens in the state the config asked for; the
  // markup's is-active is only a first paint.
  setDockSetting('pin prompts', settings['pin prompts']);

  for (const button of dockControls) {
    button.addEventListener('click', () => {
      const key = button.dataset.setting;
      if (key) setDockSetting(key, !settings[key]);
    });
  }

  // Reset restores the stage as it loaded: every clip to its first frame AND the
  // camera to its framing. Pause is left alone on purpose — paused, reset shows
  // the opening pose; playing, the motion starts over.
  const resetStage = () => {
    for (const m of mixers) m.setTime(0);
    frameStage(activePad, 0);
  };

  for (const button of dockActions) {
    button.addEventListener('click', () => {
      if (button.dataset.action === 'reset') resetStage();
    });
  }

  themeToggle?.addEventListener('click', () => {
    applyViewerTheme(viewerTheme === 'dark' ? 'light' : 'dark');
  });

  const dockKeys = new Map([
    ['KeyM', 'show model'],
    ['KeyK', 'show skeleton'],
    ['KeyW', 'wireframe'],
    ['KeyP', 'pin prompts'],
    ['Space', 'paused'],
    ['KeyO', 'auto orbit'],
  ]);

  window.addEventListener('keydown', (event) => {
    if (viewerConfig.embedded) return; // no dock to reflect a toggle
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (event.code === 'KeyR') {
      resetStage();
      return;
    }
    const key = dockKeys.get(event.code);
    if (!key) return;
    event.preventDefault();
    setDockSetting(key, !settings[key]);
  });
}

// Sidebar: one row per stage — its name, plus how many rigs stand on it. The
// count is read off `files`, so it cannot fall out of step. The numeral is
// aria-hidden and the button carries the fact in words (aria-label + title): a
// bare number read out after a name is ambiguous where the column of them is not.
EXAMPLES.forEach((ex, i) => {
  const btn = document.createElement('button');
  btn.className = 'example-item';
  btn.type = 'button';

  const name = document.createElement('span');
  name.className = 'example-name';
  name.textContent = ex.label;

  const count = document.createElement('span');
  count.className = 'example-count';
  count.textContent = ex.files.length;
  count.setAttribute('aria-hidden', 'true');

  btn.append(name, count);
  const words = `${ex.label} — ${ex.files.length} character${ex.files.length === 1 ? '' : 's'}`;
  btn.setAttribute('aria-label', words);
  btn.title = words;
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', () => loadExample(i));
  sidebar.appendChild(btn);
});

// Drag & drop .glb / .gltf onto the viewer.
const dropHint = document.getElementById('drop-hint');
let dragDepth = 0;
const showDrop = (on) => { dropHint.style.display = on ? 'flex' : 'none'; };
wrapper.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) showDrop(true); });
wrapper.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
wrapper.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; showDrop(false); } });
wrapper.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0; showDrop(false);
  loadFiles(e.dataTransfer.files);
});

// ── 12. Render loop, resize, init ────────────────────────────────────────────
// One measured delta drives everything — mixers, auto orbit, label easing — so
// a faster display renders the same motion more smoothly, not a faster motion.
//
// The cap: rAF stops while the tab is hidden, so the first frame back carries the
// whole absence — uncapped, a rig teleports through its clip and the camera spins
// several revolutions at once. 1/20 s is longer than any real frame, so it only
// fires on a stall.
const MAX_FRAME_DELTA = 1 / 20;
// Framed on the homepage, render only while the frame is on screen: the visitor
// reads the rest of the page below, and a same-origin iframe's rAF is not
// throttled for being scrolled away. The implicit root of an observer inside an
// iframe is the top-level viewport, so this sees the frame's own visibility.
let embedOnScreen = true;
if (viewerConfig.embedded && 'IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => { embedOnScreen = entry.isIntersecting; },
    { rootMargin: '120px 0px' }).observe(renderer.domElement);
}
// On a touch screen the loop draws at most TOUCH_EMBED_FPS: a skipped frame's
// time is carried into the next drawn one, so the motion keeps its speed and
// only its steps get coarser. 0.9, because two 60 Hz frames can sum to a hair
// under 1/30 s and would otherwise wait for a third.
let touchCarry = 0;
(function animate() {
  requestAnimationFrame(animate);
  let dt = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
  if (!embedOnScreen) return; // the clock was read, so nothing accumulates
  if (touchEmbed) {
    touchCarry += dt;
    if (touchCarry < 0.9 / TOUCH_EMBED_FPS) return;
    dt = Math.min(touchCarry, MAX_FRAME_DELTA);
    touchCarry = 0;
  }
  const playbackDelta = settings['paused'] ? 0 : dt;
  for (const m of mixers) m.update(playbackDelta);
  // Pass the delta: OrbitControls' no-argument branch advances a fixed step per
  // FRAME, which ran the sweep twice as fast at 120 Hz as at 60 and slowed it
  // under load. With a delta it is a rate — see 'orbit speed'. dt, not
  // playbackDelta: Pause holds the motion and lets the camera keep moving around it.
  controls.update(dt);
  renderer.render(scene, camera);
  updateLabels(dt); // after render, so the camera matrices the chips project through are final
})();

let previousViewerWidth = wrapper.clientWidth;
window.addEventListener('resize', () => {
  const w = wrapper.clientWidth, h = wrapper.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  measureLabels(); // the chips' max-width is breakpoint-dependent, so their boxes move
  // A width change is a breakpoint or an orientation change: re-fit the stage.
  // A height-only change is usually Safari's address bar and must not reset a
  // view the visitor has already orbited.
  if (Math.abs(w - previousViewerWidth) > 1 && pivots.length) frameStage(activePad);
  previousViewerWidth = w;
});

// ── Deep links (lab only) ────────────────────────────────────────────────────
// interactive.html#unitree-g1-robot opens straight onto that stage: the slug is
// the label lowercased with runs of non-alphanumerics collapsed to "-", so every
// stage has a stable, guessable address. loadExample writes the current slug
// back to the bar; hashchange lets a pasted or edited URL retarget an open lab.
// The embedded page ignores all of this — its hash is the document's TOC anchors.
let currentStageIndex = -1;
const stageSlug = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function stageFromHash() {
  if (!isFullscreenLab) return 0;
  const slug = decodeURIComponent(location.hash.slice(1)).toLowerCase();
  const i = EXAMPLES.findIndex((ex) => stageSlug(ex.label) === slug);
  return i >= 0 ? i : 0;
}

if (isFullscreenLab) {
  window.addEventListener('hashchange', () => {
    const i = stageFromHash();
    if (i !== currentStageIndex) loadExample(i);
  });
}

loadExample(stageFromHash());
