// ─────────────────────────────────────────────────────────────────────────────
// Interactive 3D viewer (Three.js) — drives #example-sidebar / #viewer-wrapper.
//
// Loads the rigs listed in examples.js, normalizes + grounds them (a port of the
// Blender render_mesh_skeleton_stage.py pipeline), lays them out on a stage, and
// accepts drag-and-drop of .fbx / .glb / .gltf. The scene catalog is data-only in
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
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EXAMPLES as DEFAULT_CATALOG } from './examples.js?v=86';

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
// One catalog for both pages (examples.js); entries differ only in viewer
// config. Hidden stages (Showcase) are filtered per the shared presets.
const hiddenCategories = new Set(viewerConfig.hiddenCategories || []);
const EXAMPLES = DEFAULT_CATALOG.filter(({ label }) => !hiddenCategories.has(label));
// The Categories heading quotes how many stages the rail below it holds. Only
// the lab carries one (interactive.html; the embedded rail has no heading), and
// the number in that markup is a first paint — it is written from the data here
// rather than maintained by hand.
document.querySelectorAll('.category-heading strong').forEach((el) => {
  el.textContent = EXAMPLES.length;
});
const isFullscreenLab = viewerConfig.fullscreenLab === true;
const VIEWER_THEMES = {
  dark: {
    background: 0x151817,
    hemisphereGround: 0x4a4038,
    checker: ['#35312c', '#222321'],
    floorOpacity: 0.88,
    shadowOpacity: 0.46,
    metaColor: '#151817',
  },
  light: {
    background: 0xf0eee6,
    hemisphereGround: 0x9a9a9a,
    checker: ['#e7e1d3', '#d0c9b5'],
    floorOpacity: 0.6,
    shadowOpacity: 0.25,
    metaColor: '#e8e9e3',
  },
};
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
  'paused': false,
  'auto orbit': true,
  // Now that the sweep runs on the clock rather than on frames (see the render
  // loop), this is a real rate — OrbitControls counts it in units of 2π/60 rad/s,
  // so one unit is 6°/s. Written as the figure that was actually chosen: 8°/s,
  // a revolution every 45 s. Fast enough to read as deliberate within a second
  // or two of landing (which is the whole job — the lab is drag-to-orbit, this
  // only says so), slow enough that a walk cycle stays legible from one side and
  // that the hover tooltip, which re-picks only on pointermove, does not go
  // stale under a still cursor.
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

let loadToken = 0;     // guards against overlapping async loads
let activePad = 1.15;  // camera padding of the current example (so Reset view keeps it)
let activeCameraPadding = viewerConfig.cameraPadding || 1;
let activeMobileCameraPadding = viewerConfig.mobileCameraPadding || activeCameraPadding;
let activeShift = [0, 0, 0]; // whole-diorama pan held OUT of auto-framing (e.g. [-1,0,0] slides left)
let activeFloor = 1;   // per-stage multiplier on the auto-sized checker floor
// Frame/floor from the models' ANIMATED envelope instead of the pose on screen at
// the moment of framing. Off for the catalog (whose 15 stages are tuned against
// the instantaneous box), on for drop-ins — see loadFiles.
let activeFrameEnvelope = false;

// Tuning constants.
const TARGET_HEIGHT = 1.0;          // normalized height, in world units (Blender TARGET_HEIGHT)
const VERTS_PER_MESH = 1000;        // skinned-vertex budget per mesh per sampled frame
const MESH_FRAME_BUDGET = 48;       // frames sampled for the mesh bbox (height/centering)
const ROW_STEP_MULT = 1.15;         // horizontal spacing between models, in widths
const MIN_FRAME_WIDTH = 3.0;        // camera always frames >= this world-width, so a small
                                    // group (2 models) doesn't zoom in and look oversized —
                                    // per-model on-screen size stays consistent across counts

// ── 3. Scene setup ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(VIEWER_THEMES[viewerTheme].background);

const camera = new THREE.PerspectiveCamera(
  35, wrapper.clientWidth / wrapper.clientHeight, 0.01, 5000
);
camera.position.set(0, 1.4, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
wrapper.appendChild(renderer.domElement);

// Lights. Each remembers its base intensity so a per-example multiplier can
// brighten/dim just one window (see applyLighting / EXAMPLES `lighting`).
const hemiLight = new THREE.HemisphereLight(0xffffff, VIEWER_THEMES[viewerTheme].hemisphereGround, 2.2);
scene.add(hemiLight);
const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
keyLight.position.set(4, 8, 6);
scene.add(keyLight);
// The key light casts the ground shadows. Its ortho shadow frustum is fitted to
// the stage in frameStage(); bias/normalBias tame skinned-mesh shadow acne.
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
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
if (viewerConfig.autoOrbitControls) {
  controls.autoRotate = settings['auto orbit'];
  controls.autoRotateSpeed = settings['orbit speed'];
}

// The rigs in resources/glbs/ are meshopt-compressed (EXT_meshopt_compression)
// with WebP textures, which is what takes the set from 671 MB to 50 MB. WebP is
// native to GLTFLoader, but meshopt geometry needs this decoder registered or
// every .glb fails to parse. The uncompressed originals are kept out of the
// deploy — see unimate/README.md.
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const fbxLoader = new FBXLoader();
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
const isFbxPath = (p) => /\.fbx$/i.test(p);

function loadModel(url, isFbx) {
  return new Promise((resolve, reject) => {
    const onLoad = (res) => resolve(
      isFbx ? { model: res, animations: res.animations, isFbx: true }
            : { model: res.scene, animations: res.animations, isFbx: false }
    );
    (isFbx ? fbxLoader : gltfLoader).load(url, onLoad, undefined, reject);
  });
}

// FBX import quirks: TransparencyFactor often lands as opacity 0 on opaque
// materials (mesh "disappears"); a black diffuse color multiplied with an
// embedded texture renders flat; and FBX often references EXTERNAL textures
// (a sibling .fbm folder) that aren't shipped, so those maps never get image
// data. Repair opacity, defer the map/color decisions until textures have had
// a chance to load, and tag maps as sRGB.
function fixMaterials(model, isFbx) {
  const mapped = [];
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
      if (isFbx) {
        if (m.opacity === 0 || (m.transparent && m.opacity < 0.05)) { m.opacity = 1; m.transparent = false; }
        m.side = THREE.DoubleSide;
        if (m.map) {
          // FBX diffuse is often pure black, relying entirely on the texture.
          // Until that texture decodes the surface samples BLACK (a visible
          // flash). Park a neutral grey placeholder now; the resolver lifts it
          // to white once the map is in so the texture's true colors show.
          if (m.color && m.color.r === 0 && m.color.g === 0 && m.color.b === 0) {
            m.color.setRGB(0.55, 0.55, 0.55);
            m.__liftWhite = true;
          }
          mapped.push(m);
        }
      }
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      m.needsUpdate = true;
    }
  });

  // Resolve diffuse maps by their actual load state, not a guessed delay that
  // could drop a slow-decoding embedded texture. A map that loaded keeps its
  // texture (and a black base color lifts to white so it shows through); one
  // that definitively failed — a missing external .fbm texture — is dropped so
  // the surface shows a clean base color instead of an empty sample.
  // Stragglers are dropped after a generous timeout.
  if (mapped.length) {
    const start = performance.now();
    const tick = () => {
      let pending = false;
      for (const m of mapped) {
        if (m.__mapResolved || !m.map) continue;
        const img = m.map.image;
        const loaded = img && img.width > 0 && img.height > 0;
        const failed = img && img.complete && img.naturalWidth === 0;
        if (loaded) {
          if (m.__liftWhite) m.color.setRGB(1, 1, 1); // show the texture's true colors
          m.__mapResolved = true; m.needsUpdate = true;
        } else if (failed || performance.now() - start > 8000) {
          m.map = null;
          if (m.__liftWhite) m.color.setRGB(0.8, 0.8, 0.8); // keep a clean neutral, not grey-black
          m.__mapResolved = true; m.needsUpdate = true;
        } else {
          pending = true;
        }
      }
      if (pending) requestAnimationFrame(tick);
    };
    tick();
  }
}

// Per-model PBR tweak (opt-in via an EXAMPLES file's `material`). Some rigs —
// mixamo-flip — ship high-roughness standard materials that read dark and matte
// under the scene's direct lights. Lowering roughness sharpens their speculars,
// and an emissive lift brightens the dark diffuse without touching global
// lighting or other models. Emissive comes in two flavors:
//   • default (textured rigs): lift via the model's own map, so detail shows.
//   • `emissive: 0xRRGGBB` (near-black rigs like the eagles): a FLAT emissive
//     color, since a map-driven lift of a black texture would stay black.
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
          m.emissive.setHex(mat.emissive);       // flat lift, independent of the (dark) map
        } else if (m.map) {
          m.emissiveMap = m.map;                 // texture-driven lift, preserves detail
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
// Park an empty Object3D on the model, in the PIVOT's local frame: the pivot's
// normalize scale + ground/layout translation carry it into world space for
// free, so the label's mark tracks the model wherever layout puts it. (An empty
// contributes nothing to Box3.expandByObject, so frameStage is unaffected.)
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
//   • center    : x/z centered on the MESH bounding box over all frames (step 5)
//   • ground    : lowest JOINT across all frames -> y = 0, skipping the
//                 armature-origin root joints (head_local.length < 1e-3 guard)
// groundToMesh grounds the lowest MESH vertex instead — for rigs (gyarados)
//   whose spine joints sit well above the belly, which joint-grounding leaves
//   floating above the grid. sizeBy 'maxdim' scales by the largest per-frame
//   bbox dimension rather than height: pose-stable for elongated creatures
//   (eagles, sharks) whose height swings enough per clip to make one character
//   a different size in every clip.
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
    // Nothing rigged to measure (a static drop-in): the pivot is still identity here,
    // so the plain bbox is already in its local frame.
    const b = new THREE.Box3().setFromObject(model);
    if (b.isEmpty()) return new THREE.Vector3(1, 1, 1);
    const c = b.getCenter(new THREE.Vector3());
    const bs = b.getSize(new THREE.Vector3());
    setLabelAnchor(pivot, c.x, c.y, c.z);
    pivot.userData.localBox = b.clone();
    pivot.userData.localBoxFull = b.clone();
    // Normalize + ground it anyway, on that one box: without it the model arrives in
    // whatever unit it was authored in — a centimetre export is 100× the stage — and
    // sits wherever its origin puts it. bs.y <= 0 is a flat model (a plane, a decal),
    // and dividing by that height blows it up to the size of the sky, so fall back to
    // the largest dimension as the rigged path does when the mesh can't be measured.
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

  const gMin = new THREE.Vector3(Infinity, Infinity, Infinity);   // mesh bbox (all frames)
  const gMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let jointMinY = Infinity;                                       // lowest joint (all frames)
  let maxFrameHeight = 0;                                         // tallest single-frame mesh height
  let maxFrameDim = 0;                                            // largest single-frame bbox dimension
  const frameBounds = [];                                         // per-frame extremes, for the typical envelope
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

  // Normalize by height (default) or by the largest per-frame dimension ('maxdim',
  // for pose-stable sizing of elongated creatures), times an optional per-example
  // scale. Quadrupeds are short but long, so unit-height normalization makes them
  // read oversized next to bipeds; userScale < 1 brings them back in line.
  const normBy = (sizeBy === 'maxdim' && maxFrameDim > 1e-6) ? maxFrameDim : maxFrameHeight;
  const s = (TARGET_HEIGHT / normBy) * userScale;
  const cx = (gMin.x + gMax.x) / 2;
  const cz = (gMin.z + gMax.z) / 2;

  // Ground reference: by default the lowest point across ALL frames — keeps the
  // lowest foot planted through a walk cycle. But when a limb/tail swings BELOW the
  // feet mid-clip (e.g. the rearing stego-attack), that over-lifts the body and
  // floats the feet. `groundFrame` (normalized 0..1) instead grounds on a SINGLE
  // frame — the neutral stance — so the feet stay planted and the tail may dip.
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

  // The model's extent in the pivot's own frame — the box updateLabels projects
  // each frame to decide where a chip may go. The TYPICAL envelope, not the
  // maximum: per-axis percentiles over the sampled frames, because the extremes
  // belong to one instant each (a wing at the top of its beat, a tail at full
  // stretch) and clearing them holds every chip a wingspan from a rig that is
  // nowhere near that big most of the time. At the 85th percentile the chips sit
  // against the silhouette you actually see.
  const axis = (n, p) => {
    if (!frameBounds.length) return p < 0.5 ? gMin.getComponent(n >> 1) : gMax.getComponent(n >> 1);
    const col = frameBounds.map((f) => f[n]).sort((a, b) => a - b);
    return col[Math.round((col.length - 1) * p)];
  };
  pivot.userData.localBox = new THREE.Box3(
    new THREE.Vector3(axis(0, 0.15), axis(2, 0.15), axis(4, 0.15)),
    new THREE.Vector3(axis(1, 0.85), axis(3, 0.85), axis(5, 0.85))
  );
  // And the FULL envelope alongside it. The two are used for different questions:
  // the typical box decides how close a chip may sit (short leaders), the full one
  // is what must never be covered — a wing at full stretch is still drawn, and
  // scoring coverage against the tight box would let chips settle straight onto it.
  pivot.userData.localBoxFull = new THREE.Box3(gMin.clone(), gMax.clone());

  // The label's mark goes at the CENTRE of the mesh's envelope, never an edge:
  // an edge point is usually empty air — the box top floats above a dragon
  // mid-downbeat, the box side is out at the tip of a tail — and a mark hanging
  // in space says nothing about which rig it means. The centre is inside every
  // rig's silhouette here, and static, so the mark never twitches with the clip.
  setLabelAnchor(pivot, cx, (gMin.y + gMax.y) / 2, cz);

  // Normalized footprint, used to space models out in a row.
  return new THREE.Vector3(
    (gMax.x - gMin.x) * s, (gMax.y - gMin.y) * s, (gMax.z - gMin.z) * s
  );
}

// ── 7. Stage: framing + teardown ─────────────────────────────────────────────
// Shared checkerboard floor texture. The dark and light themes supply their own
// two-tone palettes; repeat is set per rebuild to size the squares.
const checkerCanvas = document.createElement('canvas');
checkerCanvas.width = checkerCanvas.height = 2;
const checkerContext = checkerCanvas.getContext('2d');
const checkerTex = new THREE.CanvasTexture(checkerCanvas);
checkerTex.magFilter = checkerTex.minFilter = THREE.NearestFilter;
checkerTex.wrapS = checkerTex.wrapT = THREE.RepeatWrapping;
checkerTex.colorSpace = THREE.SRGBColorSpace;

function paintChecker(theme) {
  const [base, alternate] = VIEWER_THEMES[theme].checker;
  checkerContext.fillStyle = base;
  checkerContext.fillRect(0, 0, 2, 2);
  checkerContext.fillStyle = alternate;
  checkerContext.fillRect(0, 0, 1, 1);
  checkerContext.fillRect(1, 1, 1, 1);
  checkerTex.needsUpdate = true;
}

function setFloorRepeat(squares = 24) {
  checkerTex.repeat.set(squares / 2, squares / 2);
}

function applyViewerTheme(theme) {
  viewerTheme = theme === 'light' ? 'light' : 'dark';
  const palette = VIEWER_THEMES[viewerTheme];
  if (isFullscreenLab) document.documentElement.dataset.theme = viewerTheme;
  scene.background.setHex(palette.background);
  hemiLight.groundColor.setHex(palette.hemisphereGround);
  paintChecker(viewerTheme);
  setFloorRepeat();
  if (grid) grid.material.opacity = palette.floorOpacity;
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

// Frame the whole stage: fit the camera to the union of all pivots, drop a checker floor.
// pad > 1 zooms the camera further out (extra margin) without moving the models —
// useful when a tightly-spaced row (e.g. the two quadrupeds) still reads too big.
function frameStage(pad = 1.0, orbitAngleDegrees = viewerConfig.initialOrbitAngle || 0) {
  const box = new THREE.Box3();
  // expandByObject measures the pose on screen at this instant, which is the whole
  // clip for the catalog's in-place loops but one body's width of a clip that TRAVELS
  // — the floor gets cut to that width and the camera zooms to it, and the character
  // walks off both. Under activeFrameEnvelope, union in the whole clip's extent,
  // which groundAndNormalize already measured (localBoxFull, in pivot-local units).
  // Union, not replace: when the mesh can't be sampled localBoxFull falls back to the
  // joints, which sit inside the silhouette (a head joint is below the scalp).
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

  // Aspect-aware fit: separately solve the distance that just contains the
  // stage width (using the horizontal FOV) and its height (vertical FOV),
  // then take the larger. Fitting the raw max dimension with only the
  // vertical FOV over-pulls for a wide row of models, shrinking them.
  const vFov = camera.fov * (Math.PI / 180);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const distV = (size.y / 2) / Math.tan(vFov / 2);
  const distH = (Math.max(size.x, MIN_FRAME_WIDTH) / 2) / Math.tan(hFov / 2);
  let dist = Math.max(distV, distH, size.z);
  // The standalone lab places its scene picker over the canvas. Give that view
  // a little more breathing room so the leftmost character never sits under it.
  const responsiveCameraPadding = phoneLayout.matches ? activeMobileCameraPadding : activeCameraPadding;
  dist *= pad * (isFullscreenLab ? responsiveCameraPadding : 1); // padding

  // The objects were physically translated by activeShift (applyStageShift), which
  // dragged the box center with them. Subtract it back out so the camera, floor, and
  // shadows stay locked on the natural (un-shifted) ground center — the objects slide
  // off-center within the frame, but the viewpoint never pans.
  const tx = center.x - activeShift[0];
  const ty = center.y - activeShift[1];
  const tz = center.z - activeShift[2];
  // Aim at the stage's own centre on every page and every width. The lab's
  // chrome floats over the canvas, but clearing it is a padding question —
  // cameraPadding frames symmetrically, an aim point off the middle does not.
  controls.target.set(tx, ty, tz);
  // Lift the camera above the target (~+0.28·dist) so it looks slightly DOWN at the
  // stage instead of dead level — a gentle high-angle view.
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

  // (Re)build a checkerboard floor sized to the stage (but at least the framed width,
  // so it still fills the view when the camera zooms out for a small group).
  if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
  // Objects sit `shiftMag` off the floor center, so pad the floor/shadow so it still
  // reaches under them.
  const shiftMag = Math.hypot(activeShift[0], activeShift[2]);
  // activeFloor lets a stage rein this in: the 2·shiftMag term covers a shifted
  // group from the still-centred floor, but on a deep stageShift (the
  // Locomotion stage, −2.5) it inflates the floor until the walkers read lost on it.
  const gridSize = (Math.max(size.x, size.z, MIN_FRAME_WIDTH, 1) + 2 * shiftMag) * 1.6 * activeFloor;
  const squares = 24;                          // squares across the whole floor
  setFloorRepeat(squares);
  grid = new THREE.Mesh(
    new THREE.PlaneGeometry(gridSize, gridSize),
    // Unlit (like the old line grid) so the floor tone stays constant regardless of
    // the per-window lighting multiplier.
    new THREE.MeshBasicMaterial({
      map: checkerTex,
      transparent: true,
      opacity: VIEWER_THEMES[viewerTheme].floorOpacity,
      side: THREE.DoubleSide,
    })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(tx, 0, tz); // floor is a FIXED datum at world y = 0; each model is grounded to it
  scene.add(grid);

  // Transparent shadow catcher laid just over the checker floor: ShadowMaterial
  // renders ONLY where a shadow falls, so the checker tone shows through elsewhere.
  if (shadowPlane) { scene.remove(shadowPlane); shadowPlane.geometry.dispose(); shadowPlane.material.dispose(); }
  shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(gridSize, gridSize),
    new THREE.ShadowMaterial({ opacity: VIEWER_THEMES[viewerTheme].shadowOpacity })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(tx, 0.001, tz); // hair above the fixed floor (no z-fight)
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  // Fit the key light's ortho shadow frustum to the stage: aim it at the ground
  // center and size the frustum to the footprint so shadows stay crisp. A wider
  // frustum over the same map would blur/blockify them.
  const extent = Math.max(size.x, size.y, size.z, MIN_FRAME_WIDTH) + shiftMag;
  keyLight.target.position.set(tx, 0, tz); // aim at the fixed floor (y = 0)
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
// Each helper mutates pivots[].position in place. They run in this order:
//   row → stagger → behind → above → offsets → fileOffsets
// so later helpers can build on earlier ones (e.g. `above` snaps onto a `behind`
// model, and `offset` nudges the final result).

// Position each model's `row` group along X (centered on the origin), then push
// row N back along −Z so multiple rows read as a front-to-back diorama. Models with
// `behind`/`above` are excluded — they anchor to another model later, so they must
// not shift a row's centering.
function layoutRows(specs, sizes, spacing, evenGaps, rowDepth = 2.6, rowSpacing = null, rowOrder = null) {
  const members = pivots.map((_, i) => i).filter((i) => !specs[i].behind && !specs[i].above);

  // Group members by their row index (default 0 = front).
  const byRow = new Map();
  for (const i of members) {
    const r = specs[i].row || 0;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(i);
  }

  for (const [r, rowIdx] of byRow) {
    // `rowOrder` re-sorts a row left→right by file index — placement, not
    // content, so it stays out of the catalog's file order: a page that flattens
    // the ranks may want different rigs on the flanks. Files it omits keep their
    // catalog order, after the ones it names.
    if (rowOrder) rowIdx.sort((a, b) => orderRank(rowOrder, a) - orderRank(rowOrder, b));
    // `rowSpacing[r]` (if given) overrides the stage `spacing` for this row only,
    // so rows with different member counts/widths can be spaced independently.
    const sp = (rowSpacing && rowSpacing[r] != null) ? rowSpacing[r] : spacing;
    placeAlongX(rowIdx, sizes, sp, evenGaps);
    if (r) rowIdx.forEach((i) => { pivots[i].position.z += -r * rowDepth; pivots[i].updateMatrixWorld(true); });
  }
}

// Position within `rowOrder`; anything it doesn't name sorts after everything it does.
function orderRank(rowOrder, i) {
  const at = rowOrder.indexOf(i);
  return at === -1 ? rowOrder.length + i : at;
}

// Spread one row's members along X, centered on the origin.
function placeAlongX(rowIdx, sizes, spacing, evenGaps) {
  const sp = spacing || ROW_STEP_MULT;
  if (!rowIdx.length) return;

  if (evenGaps) {
    // Even *visual* gaps: place each model edge-to-edge with a constant gap, so a
    // wide model (e.g. gyarados) doesn't crowd its neighbor while a narrow one leaves
    // a big hole. Gap = widest footprint * (spacing - 1).
    const widths = rowIdx.map((i) => Math.max(0.3, sizes[i].x));
    const gap = Math.max(...widths) * (sp - 1);
    const centers = [];
    let acc = 0;
    for (let k = 0; k < widths.length; k++) {
      if (k > 0) acc += widths[k - 1] / 2 + gap + widths[k] / 2;
      centers.push(acc);
    }
    // Center on the row's span midpoint so the whole row straddles the origin
    // (symmetric for any count — a 2-model row isn't anchored on its first member).
    const mid = (centers[0] + centers[centers.length - 1]) / 2;
    rowIdx.forEach((i, k) => { pivots[i].position.x += centers[k] - mid; pivots[i].updateMatrixWorld(true); });
  } else {
    // Uniform center spacing (default): pivot centers evenly spaced by the widest footprint.
    const stepX = Math.max(0.5, ...rowIdx.map((i) => sizes[i].x)) * sp;
    const totalX = (rowIdx.length - 1) * stepX;
    rowIdx.forEach((i, k) => {
      pivots[i].position.x += -totalX / 2 + k * stepX;
      pivots[i].updateMatrixWorld(true);
    });
  }
}

// Depth stagger: push alternating models forward/back along Z so the row zig-zags
// instead of sitting on one straight line (stagger = peak depth offset in normalized
// units; even indices back, odd indices forward).
function applyStagger(stagger) {
  if (!stagger) return;
  pivots.forEach((pv, i) => {
    pv.position.z += ((i % 2) * 2 - 1) * (stagger * 0.5);
    pv.updateMatrixWorld(true);
  });
}

// `behind: [index, depth]` — snap this model's X to that row member's X and push it
// back `depth` along −Z (away from the camera).
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

// `above: [index, height]` — snap this model's X/Z onto the target and lift it
// `height` normalized units into the air (flyers hovering over a creature). Targets
// may themselves be `above` models (chains, e.g. bird → dragon → leopard), so
// resolve in dependency order: only place a model once its target is final.
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

// `fileOffsets` is the stage-level twin of a file's `offset`: { index: [x, y, z] },
// added on top of the catalog's own nudge rather than replacing it, so a page can
// move one rig without forking the file entry. Same normalized units.
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

// Per-file position nudge (normalized units, [x, y, z]), applied last.
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

// Whole-stage shift: physically translate EVERY model by `shift` (normalized units).
// frameStage() keeps the camera + floor locked on the un-shifted (natural) center, so
// this slides the objects across a stationary, centered floor rather than panning the
// camera. [-1, 0, 0] moves the whole group left within the frame.
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
// Each model's text prompt rides above it as an HTML chip in #viewer-labels,
// re-positioned every frame from the projected screen position of its anchor.
// HTML rather than a sprite/canvas texture: the type stays crisp at any zoom,
// inherits the page's font, and wraps for free. The layer is click-through, so
// chips never steal a drag from OrbitControls.
//
// A chip is two elements: the text itself, and a `.viewer-pin` dot on the model's
// crown. The line between them is the chip's ::after, whose length and angle this
// file writes as custom properties — that leader is what keeps a chip legible as
// its own once the de-collision pass below has lifted it off its model.
const labelNdc = new THREE.Vector3();

// The prompt text is content, not engine config, so it lives in its own file:
// resources/prompts.json, one line per model keyed by FILENAME (so a glb reused across
// stages says the same thing everywhere). Fetched once; a failure is non-fatal —
// the viewer just runs without chips. loadStage awaits this promise, so a stage
// can never render before its text is in.
const PROMPTS = new Map();
// The ?v= matters here as much as on the imports: Pages caches the JSON, and a
// new rig's chip would otherwise stay missing for returning visitors. Bump it
// whenever prompts.json changes.
const promptsReady = fetch('resources/prompts.json?v=20')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((data) => {
    // '_comment' documents the file for whoever edits it; it isn't a model.
    for (const [file, text] of Object.entries(data)) {
      if (!file.startsWith('_')) PROMPTS.set(file, text);
    }
  })
  .catch((err) => console.warn('Prompt labels unavailable:', err));

// A spec's own `prompt` wins (including an empty string, which means "no label");
// otherwise fall back to the shared text for that filename. Dropped files carry a
// blob: URL, which matches nothing — so they get no pill, as intended.
function promptFor(spec) {
  if (spec.prompt != null) return spec.prompt;
  return PROMPTS.get(spec.url.split('/').pop()) || '';
}

// Rebuild the chips for the stage just loaded. A model with no prompt gets no
// entry. Every chip carries its prompt in full, subject included — naming the
// object is worth more than the width it costs, and that width is paid for by
// the slot choice and the collision pass in updateLabels instead.
function buildLabels(specs) {
  labelLayer.replaceChildren();
  labels = [];

  specs.forEach((s, i) => {
    const text = promptFor(s);
    const anchor = pivots[i] && pivots[i].userData.labelAnchor;
    if (!text || !anchor) return;
    const el = document.createElement('div');
    el.className = 'viewer-label';
    el.textContent = text;   // the prompt in full, subject and all
    const pin = document.createElement('div');
    pin.className = 'viewer-pin';
    labelLayer.append(el, pin);
    // `slot` persists between frames so an orbit that makes above/below briefly
    // tie doesn't flip the chip back and forth; see SLOT_HYSTERESIS.
    labels.push({
      el, pin, anchor, pivot: pivots[i],
      order: i,
      slot: s.labelSlot || 'above',
      lockSlot: s.lockLabelSlot || false,
      offset: s.labelOffset || [0, 0],
      pinOffset: s.labelPinOffset || [0, 0],
      sx: null, sy: null, tx: null, ty: null,
      candidateX: null, candidateY: null, candidateFrames: 0,
      w: 0, h: 0,
    });
  });
  measureLabels();
  applyLabels();
}

// Cache each chip's box once, so the per-frame loop can clamp it inside the canvas
// without reading offsetWidth — a read between transform writes would force a
// synchronous reflow every frame. The text is fixed, so the box only changes when
// the chip's max-width breakpoint or the font does; both are re-measured below.
function measureLabels() {
  for (const l of labels) {
    l.w = l.el.offsetWidth;
    l.h = l.el.offsetHeight;
  }
  measureGui();
}

// The toolbar is opaque and sits above the label layer, so a chip that lands under
// it loses its text. Measure it (in wrapper coordinates) and treat its column as
// out of bounds — chips slide left of it instead of vanishing behind it.
let guiBox = null;
function measureGui() {
  const g = gui.domElement.getBoundingClientRect();
  const wr = wrapper.getBoundingClientRect();
  if (!g.width || !g.height) {
    guiBox = null;
    return;
  }
  guiBox = {
    left: g.left - wr.left, right: g.right - wr.left,
    top: g.top - wr.top, bottom: g.bottom - wr.top,
  };
}
// Roboto Mono arrives after first paint and is wider than the fallback.
document.fonts?.ready.then(measureLabels);

function applyLabels() {
  const layerVisible = settings['show prompts'] && !viewPointerDown && !viewZooming;
  labelLayer.style.display = layerVisible ? '' : 'none';
  if (viewerConfig.hoverPrompts) {
    for (const label of labels) {
      const visible = layerVisible && label.order === hoveredPromptOrder;
      label.el.style.display = visible ? '' : 'none';
      label.pin.style.display = visible ? '' : 'none';
    }
  }
}

// In the standalone lab, reveal only the prompt belonging to the mesh under
// the mouse. Walking up from the hit mesh resolves every child to its rig root.
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
    if (viewPointerDown || event.pointerType === 'touch') {
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

// Prompt annotations are useful at rest but obscure the models while orbiting.
// Hide them from pointer-down through release; listen for release on window so
// dragging beyond the canvas cannot leave the layer stuck invisible.
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

// Wheel zoom has no pointer to release, so hide on the first notch and restore a
// beat after the last one. ZOOM_REST_MS outlasts the controls' damped glide
// (dampingFactor 0.08), so the chips reappear against a camera that has stopped
// rather than re-solving their layout through the tail of the zoom. Pinch-zoom
// needs nothing here: two fingers down is already a pointer drag.
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
const PIN_RADIUS = 2.5; // .viewer-pin's outer radius, incl. its halo (css §8)
const LEADER_COST = 0.5; // chip-areas charged per 100px of leader when scoring slots
const MARGIN_REACH = 40; // px a chip's outer edge may pass the outermost rig on the
                         // stage. The margins are for relieving a jam, not for the
                         // labels to occupy: let chips run to the canvas edge and the
                         // picture reads far wider than the group actually is.
const MARGIN_BONUS = 0.16; // chip-areas refunded for sitting clear of the whole group,
                           // scaled by how crowded the stage is (see `spread`). Small on
                           // purpose: enough to break a jam in the middle, not enough to
                           // pull chips out to the canvas edge and widen the whole picture
// How far from a rig's centre toward its chip the mark sits, as a fraction of the
// distance to the silhouette's edge. Well short of 1: the box spans the whole clip,
// so its edge is empty air for anything that flaps, and a mark out there floats
// beside the rig instead of sitting on it.
const MARK_INSET = 0.4;
const PILL_PAD = 4;  // px of clearance from the canvas edges and from other chips
// Depth grading. A chip this much farther from the camera than the nearest one —
// as a FRACTION of that distance, not an absolute — is fully receded. Relative
// because a row standing side by side varies in distance by a few percent and must
// stay uniform, while a second row sits ~30% back and should visibly drop behind
// it. It is what keeps the 9-chip Creatures stage and the two-row Armored Robot
// stage from reading as one flat wall of equal-weight labels.
const DEPTH_SPAN = 0.35;
const DEPTH_FADE = 0.45;   // opacity given up at full recession
const DEPTH_SHRINK = 0.12; // scale given up at full recession

// Below the phone layout breakpoint, scale overlay UI from the viewer's tuned
// desktop width: the 960px content column less the sidebar (165px + 22px), the
// 14px flex gap and the 3px viewer border leaves a 756px canvas. Scaling from
// that exact baseline makes prompts and Controls true geometric reductions of
// the desktop composition rather than similar mobile variants.
const DESKTOP_VIEWER_WIDTH = 756;
const phoneLayout = window.matchMedia('(max-width: 720px)');
const promptViewportScale = (width) =>
  phoneLayout.matches ? Math.min(1, width / DESKTOP_VIEWER_WIDTH) : 1;

// Controls use the same geometric reduction as the prompt chips, but need a
// readability floor: the paper embed starts from a compact 160px desktop panel,
// while the fullscreen lab starts from 210px. Separate floors make both land at
// a comparable visual density on a phone instead of making the embed microscopic
// or letting the lab dominate the stage.
const controlViewportScale = (width) => {
  if (!phoneLayout.matches) return 1;
  const minimum = viewerConfig.mobileControlScaleMin ?? (isFullscreenLab ? 0.54 : 0.62);
  return Math.max(minimum, Math.min(1, width / DESKTOP_VIEWER_WIDTH));
};

const MAX_LIFT = 115; // px a pill may be pushed up off its model to dodge another.
                      // Enough for the Creatures stage’s worst case — the chicken standing under
                      // the hovering bird, whose pills want the same patch of sky —
                      // and short enough that a pill still reads as that model's.

// A chip may sit above its model or below it. Above is the default, but on a
// two-row stage the front row's heads are exactly where the back row's bodies are,
// so a chip that insists on "above" lands on someone else's rig. Each frame both
// slots are scored by how much MODEL they would cover, and the cheaper one wins —
// which on a diorama sends the front row's chips down onto the empty floor and
// leaves the back row's in the empty sky.
const SLOT_HYSTERESIS = 0.3; // the other slot must beat the current one by this
                             // fraction of the chip's area before it flips, so an
                             // orbit through a near-tie doesn't make chips jitter.

// Chips whose resting heights land within this many px of each other snap to a
// shared baseline. Rigs differ in height, so left alone every chip sits at its own
// level and a row reads as scattered from half the angles you can orbit to. Small
// on purpose: it tidies chips already nearly aligned and never drags one away from
// the model it labels.
const BASELINE_SNAP = 18;

// Chips ease toward their target rather than being re-placed outright. The scene is
// live, so its annotations should read as attached to it — without this, a slot flip
// or a resolved collision teleports the chip mid-orbit. Short enough (~90ms) to stay
// glued to the rig, long enough to absorb the pop.
const SETTLE_TAU = 0.09;
const SETTLE_SNAP = 220;  // px — a jump this large is a new stage or a re-entry, not
                          // a nudge, so take it instantly instead of sliding across.
const DEPTH_ORDER_EPSILON = 0.04; // near-coplanar labels keep catalog order instead
                                  // of swapping collision priority on sub-pixel depth noise
const TARGET_SWITCH_DISTANCE = 8; // larger target jumps are usually a solver branch switch
const TARGET_CONFIRM_RADIUS = 6;   // consecutive proposals count as the same new position
const TARGET_CONFIRM_FRAMES = 3;   // ~50ms at 60fps: invisible, but kills A/B oscillation
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Two passes per frame. Pass 1 projects every rig to a screen box and picks each
// chip's slot; pass 2 walks them near→far, pushes each clear of the chips already
// placed, and draws its leader back to the pin. Near→far means the model closest
// to the camera keeps the spot it wants and the ones behind give way — the same
// read as the depth stacking.
const visible = [];
const modelBoxes = [];
const labelWorld = new THREE.Vector3();
const boxCorner = new THREE.Vector3();

// A chip's placement is one-dimensional once its slot is known: it escapes ALONG the
// axis that points away from its model ('y' for above/below, 'x' for a side slot) and
// slides ACROSS the other. These read/write whichever coordinate that is, so the
// escape below is written once instead of twice.
const alongOf = (p, axis) => (axis === 'y' ? p.cy : p.x);
const setAlong = (p, axis, v) => { if (axis === 'y') p.cy = v; else p.x = v; };
const halfOf = (p, axis) => (axis === 'y' ? p.halfH : p.halfW);

// The first already-placed chip this one lands on, or null. Only chips nearer the
// camera can push it, so the search stops at its own index.
function firstHit(p, upto) {
  for (let j = 0; j < upto; j++) {
    const q = visible[j];
    if (Math.abs(q.x - p.x) < q.halfW + p.halfW + PILL_PAD &&
        Math.abs(q.cy - p.cy) < q.halfH + p.halfH + PILL_PAD) return q;
  }
  return null;
}

// A pivot's on-screen bounding box, from the 8 corners of the local box stashed by
// groundAndNormalize. Cheap enough per frame (8 projections per rig) and exact,
// where Box3.setFromObject would re-walk the geometry.
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

// The toolbar counts as an obstacle here too, and a costly one. Without it a chip
// whose model sits under the panel still picks "above", collides, and gets shoved
// sideways by the dodge below — landing a long diagonal leader away from the rig it
// labels. Scored, that chip simply goes below its model instead, where it is near.
const GUI_COST = 1.5;

function coveredArea(cx, cy, halfW, halfH) {
  let total = 0;
  for (const b of modelBoxes) total += coverage(cx, cy, halfW, halfH, b);
  if (guiBox) total += GUI_COST * coverage(cx, cy, halfW, halfH, guiBox);
  return total;
}

function updateLabels(dt) {
  if (!labels.length || !settings['show prompts']) return;
  const w = wrapper.clientWidth;
  const h = wrapper.clientHeight;
  const viewportScale = promptViewportScale(w);

  // The full-screen lab uses a pointer-following tooltip, deliberately separate
  // from the anchored annotation solver used by the paper page. Keep it beside
  // the cursor, flip it to the other side near an edge, and clamp it to the canvas.
  if (viewerConfig.hoverPrompts) {
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

  // Where every rig on the stage is, chips or not — a labelled model must not be
  // covered by someone else's chip either.
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

  // How hard this stage is. A four-rig row has room for everyone above their own
  // model; nine rigs do not, and packing them into the same middle band is what
  // makes a stage look crowded. The busier it gets the more willing chips are to
  // leave the group and take the clear margins down either flank — and the less
  // each px of leader costs, since reaching that space is the whole point.
  const spread = Math.min(1, Math.max(0, (labels.length - 4) / 5));

  // Horizontal bounds for a chip of half-width `hw`: inside the canvas, and no more
  // than MARGIN_REACH past the group it belongs to.
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
    // Behind the camera (z > 1) or well off the canvas: hide it. Parking it on the
    // edge instead would leave a pill pointing at nothing.
    if (labelNdc.z > 1 || Math.abs(labelNdc.x) > 1.05 || Math.abs(labelNdc.y) > 1.15) {
      l.el.style.display = 'none';
      l.pin.style.display = 'none';
      l.sx = null;   // re-entering the frame should place it, not slide it in
      continue;
    }
    l.el.style.display = '';
    l.pin.style.display = '';
    // The anchor's own screen point — the top-center of the rig.
    const ax = (labelNdc.x * 0.5 + 0.5) * w;
    const ay = (-labelNdc.y * 0.5 + 0.5) * h;
    // l.w/l.h are the desktop chip's unscaled layout box. Placement uses its
    // responsive visual box so mobile labels do not reserve desktop-sized gaps.
    const halfW = l.w * viewportScale / 2;
    const halfH = l.h * viewportScale / 2;
    // Keep the whole chip inside the frame. A model near an edge would otherwise
    // center its chip over the border and lose half the text to the layer's clip —
    // a nudged-but-readable label beats a cropped one, and the leader still says
    // which model it belongs to.
    const x = THREE.MathUtils.clamp(ax, halfW + PILL_PAD, Math.max(halfW + PILL_PAD, w - halfW - PILL_PAD));

    // Candidate placements around the rig: the four sides, plus four diagonals off
    // the corners. Each is scored by how much MODEL it would cover and the cheapest
    // wins, so a rig standing at the edge of the group puts its chip out into the
    // empty margin beside it instead of over its neighbours. The diagonals are for
    // rigs boxed in on every side — the chicken standing between the monster, the
    // stegosaurus and the whale has no clear side at all, and without a corner to
    // reach for its chip has to sit on one of its neighbours.
    const own = screenBox(l.pivot, w, h) || { left: ax - 1, right: ax + 1, top: ay - 1, bottom: ay + 1 };
    const ownX = (own.left + own.right) / 2;
    const ownY = (own.top + own.bottom) / 2;
    // Every slot clears `own`, which spans every frame of the clip, so a wing at the
    // top of its beat never reaches a chip. Wherever the chip lands its leader ends
    // on the SAME mark — the anchor at (ax, ay), the model's centre — so one rig has
    // one mark, the chip's own edge decides where the line leaves from, and neither
    // end twitches along with the animation.
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
    // costs a little; a side or corner slot costs more still, and one pointing back
    // INTO the group costs most — the whole value of leaving the rig's own column is
    // the empty margin it reaches, so it is only worth doing outward.
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
      // Distance is part of the cost, not just coverage. Without it the solver will
      // happily buy a clear patch of floor with a leader half the frame long, and a
      // label tethered that far away stops reading as belonging to anything. This is
      // the term that keeps chips tucked against their own rig — eased off on a
      // crowded stage, where the nearest space simply isn't free.
      const reach = Math.hypot(sx - ax, sy - ay) / 100 * LEADER_COST * (1 - 0.25 * spread);
      // Clear of every rig on the stage, out in the side margin: worth a discount
      // once the stage is busy, and worth nothing on a stage that has room anyway.
      const inMargin = sx + halfW < stageLeft || sx - halfW > stageRight;
      const margin = inMargin ? MARGIN_BONUS * spread : 0;
      const cost = coveredArea(sx, sy, halfW, halfH)
        + (bias[name] * (1 - 0.5 * spread) + reach - margin) * area;
      // The chip keeps the slot it already holds unless another beats it clearly,
      // so an orbit through a near-tie doesn't make chips hop around the model.
      const stickiness = name === l.slot ? SLOT_HYSTERESIS * area : 0;
      if (cost - stickiness < bestCost) { bestCost = cost - stickiness; best = name; }
    }
    l.slot = best;
    const chosen = slots[best];
    chosen.x += l.offset[0];
    chosen.cy += l.offset[1];

    visible.push({
      label: l, el: l.el, pin: l.pin, halfW, halfH, depth: labelNdc.z, dist,
      // A deliberately locked annotation may occupy clear canvas outside the
      // model-group margin (the putter prompt sits beneath the Controls panel).
      x: l.lockSlot ? canvasX(chosen.x, halfW) : spanX(chosen.x, halfW),
      cy: chosen.cy,
      ax, ay, box: own,
      axis: chosen.axis, sign: chosen.sign,
    });
    visible[visible.length - 1].rest = chosen.axis === 'y' ? chosen.cy : visible[visible.length - 1].x;
    if (dist < nearest) nearest = dist;
  }

  // Share a baseline between chips in the same slot that already sit within a few px
  // of each other — a row of rigs of different heights otherwise gives every chip its
  // own level, which reads as scattered from half the angles you can orbit to. Chips
  // above/below align on a horizontal line; chips beside a rig align on a vertical
  // one. Done BEFORE the collision pass, so anything the snap pushes into a neighbour
  // still gets separated below; snapping afterwards would undo that.
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

  // Side-by-side rigs are effectively at the same depth. Sorting those by their
  // tiny projected-depth difference lets collision ownership swap every frame
  // around a tie, which sends both chips searching in opposite directions. Form
  // deterministic near-coplanar bands, then use catalog order within each band;
  // real front/back rows remain ordered by distance.
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
    // Only the already-placed (nearer) pills can push this one; re-check after each
    // lift, since clearing one pill can slide it into another.
    for (let pass = 0; pass < visible.length; pass++) {
      // The toolbar is an obstacle too, but an unliftable one — it owns the top-right
      // corner, so pills slide clear to its left instead of rising over it. Checked
      // inside the loop because a lift can carry a pill back up into its band.
      if (guiBox && p.cy - p.halfH < guiBox.bottom && p.x + p.halfW > guiBox.left - PILL_PAD) {
        p.x = spanX(guiBox.left - PILL_PAD - p.halfW, p.halfW);
      }
      const hit = firstHit(p, i);
      if (!hit) break;
      // Escape, in order of preference, along this chip's own axis. Each step is
      // taken only if it can ACTUALLY clear the chip in the way — a move that gets
      // clamped short of clearing leaves the overlap in place and the loop spinning
      // on it, which is how a chip pinned against the canvas edge used to stay stuck
      // underneath another one.
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
        // 1. Further out along its own axis, within the travel cap — the quiet
        //    default. A chip that chose "below" is never pushed back up over the
        //    rigs it just cleared.
        setAlong(p, A, nudged);
      } else if (Math.abs(slid - alongOf(hit, B)) >= stepB - 0.5) {
        // 2. Out of room along the axis, but the band is narrower than the canvas
        //    across it: slide past sideways instead.
        setAlong(p, B, slid);
      } else if (p.sign < 0 ? nudged >= edge : nudged <= edge) {
        // 3. Neither fits inside the cap. Overrun the cap rather than overlap — a
        //    chip further from its model still reads via its leader; two chips on
        //    top of each other read as nothing.
        setAlong(p, A, nudged);
      } else {
        // 4. That whole side of the canvas is full: cross to the far side of the chip
        //    in the way. Only reached at steep angles, where the rigs bunch into the
        //    middle of the frame and every band runs out at once.
        const crossed = alongOf(hit, A) - p.sign * stepA;
        const far = p.sign < 0 ? limA - halfOf(p, A) - PILL_PAD : halfOf(p, A) + PILL_PAD;
        if (p.sign < 0 ? crossed <= far : crossed >= far) setAlong(p, A, crossed);
        else break;  // genuinely nowhere left to go
      }
    }
    // Last resort. The chain above can ping-pong — cleared past one chip, into the
    // next, back again — and run out of passes still overlapping. Step outward from
    // the rest position in whole-chip increments and take the first clear slot; the
    // canvas is finite and the step is a full chip, so this always terminates.
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

    // Keep it on the canvas. The travel cap is applied above, where it can be given
    // up deliberately; re-applying it here would undo step 3 and restore the overlap.
    p.cy = THREE.MathUtils.clamp(p.cy, p.halfH + PILL_PAD, Math.max(p.halfH + PILL_PAD, h - p.halfH - PILL_PAD));
    p.x = p.label.lockSlot ? canvasX(p.x, p.halfW) : spanX(p.x, p.halfW);

    // A crowded layout can have two equally valid escape routes. Do not let an
    // A/B/A/B sequence become visible: small tracking motion is accepted at once,
    // while a large branch switch must propose the same destination for three
    // consecutive frames. A genuinely better slot therefore moves after ~50ms;
    // an unstable alternative never takes control.
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

    // Ease onto the target. Everything above computed where the chip BELONGS; this
    // is where it is drawn on the way there, so a slot flip or a resolved collision
    // glides instead of teleporting mid-orbit.
    const k = reduceMotion ? 1 : 1 - Math.exp(-dt / SETTLE_TAU);
    if (lab.sx == null || Math.hypot(p.x - lab.sx, p.cy - lab.sy) > SETTLE_SNAP) {
      lab.sx = p.x; lab.sy = p.cy;
    } else {
      lab.sx += (p.x - lab.sx) * k;
      lab.sy += (p.cy - lab.sy) * k;
    }

    // Recession, 0 at the nearest chip and 1 once DEPTH_SPAN farther away. The
    // collision pass above ran on the UNSCALED boxes, so a shrunken chip only ever
    // clears its neighbours by more than asked — never less.
    const t = Math.min(1, Math.max(0, (p.dist / nearest - 1) / DEPTH_SPAN));
    const scale = viewportScale * (1 - DEPTH_SHRINK * t);
    p.el.style.opacity = p.pin.style.opacity = (1 - DEPTH_FADE * t).toFixed(3);
    p.el.style.transform =
      `translate3d(${lab.sx.toFixed(1)}px, ${lab.sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;

    // The leader: from the chip's border to the pin. Start where the ray to the pin
    // exits the chip's box, so it works from any edge — a chip below its model draws
    // upward from its top, one beside it draws sideways — and never from under the
    // opaque fill. The offsets and the length are divided by `scale` because CSS
    // anchors the line at the chip's centre, as a child scaled with it.
    //
    // The mark sits on the rig, on the side facing its chip: travel from the centre
    // toward the chip and stop MARK_INSET of the way out. The centre alone leaves
    // the leader crossing half a body, and a box edge — a corner especially — is
    // mostly empty air, so a mark out there floats beside the rig.
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

    // Drawn from the SETTLED position, not the target — otherwise the line detaches
    // from its own chip for the length of every transition.
    const dx = markX - lab.sx;
    const dy = markY - lab.sy;
    const dist2 = Math.hypot(dx, dy);
    // A chip that ended up over its own model's edge has nothing to span: the joint
    // would sit on its own text and the bone would have no length. Drop both — the
    // chip is already touching the rig it names.
    const onTop = Math.abs(dx) < p.halfW * scale + 2 && Math.abs(dy) < p.halfH * scale + 2;
    p.pin.style.visibility = onTop ? 'hidden' : '';
    const exit = dist2 > 0.001
      ? Math.min(p.halfW * scale / Math.abs(dx || 1e-6), p.halfH * scale / Math.abs(dy || 1e-6))
      : 0;
    // Stop at the mark's edge, not its centre: the ring is hollow, so a leader run
    // to the middle of it draws a line straight through the circle.
    const len = Math.max(0, dist2 * (1 - exit) - PIN_RADIUS);
    p.el.style.setProperty('--leader-x', `${(dx * exit / scale).toFixed(1)}px`);
    p.el.style.setProperty('--leader-y', `${(dy * exit / scale).toFixed(1)}px`);
    p.el.style.setProperty('--leader', len > 5 && !onTop ? `${(len / scale).toFixed(1)}px` : '0px');
    p.el.style.setProperty('--leader-angle', `${Math.atan2(-dx, dy).toFixed(3)}rad`);
    p.pin.style.transform = `translate3d(${markX.toFixed(1)}px, ${markY.toFixed(1)}px, 0) translate(-50%, -50%)`;

    // Whatever overlap survives the cap, resolve it toward the camera: the sort index
    // gives every chip a distinct rank, where depth alone ties in a crowded stage
    // (NDC z is bunched near 1) and leaves the winner to DOM order.
    const rank = String(visible.length - i);
    p.el.style.zIndex = rank;
    p.pin.style.zIndex = rank;
  }
}

// ── 10. Load a stage / example / dropped files ───────────────────────────────
// Expand an EXAMPLES entry's `files` into normalized specs, then load it.
function loadExample(index) {
  const shared = EXAMPLES[index];
  currentStageIndex = index;
  // Keep the address bar a shareable link to what is on screen (lab only —
  // the embedded page's hash belongs to the document's own anchors).
  // replaceState, not location.hash: no history entry per click, no scroll.
  if (isFullscreenLab) history.replaceState(null, '', '#' + stageSlug(shared.label));
  // Per-page presentation: stage-tuning.js may override this stage's layout
  // options for the current page. The catalog itself (files) never differs.
  const ex = { ...shared, ...(viewerConfig.stageTuning?.[shared.label] || {}) };
  const specs = ex.files.map((f) => {
    const o = typeof f === 'string' ? { url: f } : f;
    return {
      url: o.url,
      isFbx: isFbxPath(o.url),
      material: o.material || null,
      groundToMesh: !!o.groundToMesh,
      groundFrame: (o.groundFrame ?? null),
      rotate: o.rotate || null,
      offset: o.offset || null,
      behind: o.behind || null,
      above: o.above || null,
      scale: o.scale || null,
      // `singleRow` is a stage-level flag, so it flattens the ranks here rather
      // than editing the catalog's per-file `row` — the files stay shared.
      row: ex.singleRow ? 0 : (o.row || 0),
      prompt: (o.prompt ?? null),   // ?? not || : '' is a real value here ("no label")
      labelSlot: o.labelSlot || null,
      lockLabelSlot: o.lockLabelSlot || false,
      labelOffset: o.labelOffset || null,
      labelPinOffset: o.labelPinOffset || null,
    };
  });
  return loadStage(specs, index, {
    scale: ex.scale, spacing: ex.spacing, rowSpacing: ex.rowSpacing, pad: ex.pad, lighting: ex.lighting,
    evenGaps: ex.evenGaps, sizeBy: ex.sizeBy, stagger: ex.stagger, rowDepth: ex.rowDepth, rowOrder: ex.rowOrder, fileOffsets: ex.fileOffsets,
    stageShift: ex.stageShift, floor: ex.floor,
    cameraPadding: viewerConfig.cameraPaddingByCategory?.[ex.label],
    mobileCameraPadding: viewerConfig.mobileCameraPaddingByCategory?.[ex.label],
  });
}

// specs: [{ url, isFbx, material, ... }].  activeIndex: sidebar item to highlight, or null.
// opts: { scale, spacing, rowSpacing, rowOrder, pad, lighting, evenGaps, sizeBy, stagger,
//         rowDepth, fileOffsets, stageShift, floor } — see examples.js.
//       plus `cameraPadding` / `mobileCameraPadding`, this stage's entries in the
//       page's cameraPaddingByCategory (they fall back to the page-wide values),
//       `label` (used only when activeIndex is null — a drop-in names itself)
//       and `frameEnvelope` (frame/floor the whole clip, not the pose on screen).
async function loadStage(specs, activeIndex, opts = {}) {
  const token = ++loadToken;
  overlay.innerHTML = LOADING_HTML;
  overlay.style.display = 'flex';
  // A dropped file has no sidebar row, so activeIndex is null and every row goes off.
  [...sidebar.children].forEach((b, i) => {
    const on = i === activeIndex;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // "Open full screen" hands the visitor's place over to the lab on the same
  // slug the lab writes to its own address bar, so the two pages agree by LABEL
  // and neither depends on the other's catalog indices. The markup ships the
  // bare interactive.html: both the JS-off fallback and where a drop-in sends
  // you, having no stage for the lab to open on.
  if (expandLink) {
    const slug = activeIndex == null ? '' : '#' + stageSlug(EXAMPLES[activeIndex].label);
    expandLink.href = 'interactive.html' + slug;
  }
  if (stageName) {
    // A drop-in has no catalog row to read a label off, so it names itself after the
    // file (opts.label); 'Imported model' is the fallback for a load with no name.
    const heading = (activeIndex == null) ? (opts.label || 'Imported model') : EXAMPLES[activeIndex].label;
    stageName.textContent = heading;
    // A file name is the one label long enough to ellipsize in the 216px status line
    // — the catalog's longest fits — so only a drop-in needs the full text on hover,
    // and a previous drop's tooltip must not outlive it.
    if (activeIndex == null) stageName.title = heading;
    else stageName.removeAttribute('title');
  }

  try {
    const [loaded] = await Promise.all([
      Promise.all(specs.map((s) => loadModel(s.url, s.isFbx))),
      promptsReady,   // settles once (and never rejects), so this only ever waits on the first stage
    ]);
    if (token !== loadToken) return; // a newer click superseded this load

    disposeStage();

    // Build each model: repair materials, wrap in a pivot, animate, normalize + ground.
    const sizes = [];
    for (let li = 0; li < loaded.length; li++) {
      const { model, animations, isFbx } = loaded[li];
      fixMaterials(model, isFbx);
      applyMaterialOverride(model, specs[li].material);
      model.visible = settings['show model'];

      // Wrap in a pivot so we can ground + normalize without touching the model's transform.
      const pivot = new THREE.Group();
      pivot.add(model);
      scene.add(pivot);

      // Per-file reorientation (degrees, [x, y, z]) applied BEFORE grounding, so the
      // model is re-centered/re-grounded in its new orientation — e.g. tilt + a yaw
      // turn to show a model's motion from a more revealing angle.
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

      // Normalize to unit mesh-height + ground the lowest joint to y = 0 (Blender port).
      const userScale = (opts.scale || 1) * (specs[li].scale || 1);
      sizes.push(groundAndNormalize(pivot, model, mixer, clip, userScale, specs[li].groundToMesh, opts.sizeBy, specs[li].groundFrame) || new THREE.Vector3(1, 1, 1));

      const skeleton = new THREE.SkeletonHelper(model);
      skeleton.visible = settings['show skeleton'];
      // The helper's material is transparent with depthTest off — "always visible"
      // by design. But the checker floor is transparent too, and the transparent
      // pass sorts by distance: a far rig's skeleton draws BEFORE the floor, which
      // then paints over it and leaves a ghost. renderOrder puts every helper after
      // the floor and shadow plane, where depthTest:false already means it wins.
      skeleton.renderOrder = 2;
      scene.add(skeleton);

      pivots.push(pivot);
      models.push(model);
      skeletons.push(skeleton);
    }

    // Position the stage: rows → stagger → behind → above → offsets → fileOffsets → whole-stage shift.
    activeShift = opts.stageShift || [0, 0, 0];
    layoutRows(specs, sizes, opts.spacing, opts.evenGaps, opts.rowDepth, opts.rowSpacing, opts.rowOrder);
    applyStagger(opts.stagger);
    placeBehind(specs);
    placeAbove(specs);
    applyOffsets(specs);
    applyFileOffsets(opts.fileOffsets);
    applyStageShift(activeShift); // move objects; frameStage keeps camera/floor centered

    applyWireframe();
    applyLighting(opts.lighting || 1);
    buildLabels(specs); // after layout — the anchors ride the pivots, so order is free
    activeCameraPadding = opts.cameraPadding ?? viewerConfig.cameraPadding ?? 1;
    activeMobileCameraPadding = opts.mobileCameraPadding ?? viewerConfig.mobileCameraPadding ?? activeCameraPadding;
    activePad = opts.pad || 1.0;
    activeFloor = opts.floor || 1;
    activeFrameEnvelope = !!opts.frameEnvelope;
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
  const files = [...fileList].filter((f) => /\.(fbx|glb|gltf)$/i.test(f.name));
  if (!files.length) return;
  // groundToMesh on every drop-in: the catalog grounds on the lowest JOINT, which
  // holds because its rigs are known to have foot joints at the sole (and the few
  // that don't carry the flag). A visitor's rig is unknown — a belly-slung spine, a
  // fish, a mech with its joints inside the shell all hover — and the lowest MESH
  // vertex is the one rule that grounds any of them without knowing the skeleton.
  const specs = files.map((f) => ({ url: URL.createObjectURL(f), isFbx: isFbxPath(f.name), groundToMesh: true }));
  // Named after the file: the status line is the only thing on screen saying what is
  // loaded, and two drops in a row are otherwise indistinguishable. The stem is left
  // verbatim — prettifying `wall_e-greet` gets it wrong more often than not.
  const label = files.length === 1
    ? files[0].name.replace(/\.(fbx|glb|gltf)$/i, '')
    : `${files.length} imported models`;
  // frameEnvelope: a visitor's clip may travel where the catalog's loop in place, so
  // the ground has to cover the path rather than the pose it starts in.
  loadStage(specs, null, { label, frameEnvelope: true });
}

// ── 11. UI wiring ────────────────────────────────────────────────────────────
// Toolbar (lil-gui), pinned inside the viewer. Flat panel (no nested folders).
const gui = new GUI({ container: wrapper, title: 'Controls' });
gui.add(settings, 'show model').name('Mesh')
  .onChange((v) => models.forEach((m) => { m.visible = v; }));
gui.add(settings, 'show skeleton').name('Skeleton')
  .onChange((v) => skeletons.forEach((s) => { s.visible = v; }));
gui.add(settings, 'show prompts').name('Prompts').onChange(applyLabels);
// No Wireframe row: lil-gui only ever shows on the embedded page (the lab
// hides it and carries wireframe in its own control bar), and the embedded
// page dropped the option.
if (viewerConfig.playbackControls) {
  gui.add(settings, 'paused').name('Pause');
}
if (viewerConfig.autoOrbitControls) {
  gui.add(settings, 'auto orbit').name('Auto orbit')
    .onChange((enabled) => { controls.autoRotate = enabled; });
}
gui.add({ reset: () => frameStage(activePad, 0) }, 'reset').name('Reset view');

// Full-screen lab controls use a compact, keyboard-first dock. lil-gui remains
// the engine's control surface for the embedded viewer, but is visually hidden
// on interactive.html so the stage has one coherent set of controls.
const dockControls = [...wrapper.querySelectorAll('[data-setting]')];
const embedControls = [...document.querySelectorAll('.embed-control-bar [data-setting]')];
const dockActions = [...wrapper.querySelectorAll('[data-action]')];
const themeToggle = wrapper.querySelector('[data-theme-toggle]');

function setDisplaySetting(key, value, buttons) {
    settings[key] = value;
    if (key === 'show model') models.forEach((model) => { model.visible = value; });
    if (key === 'show skeleton') skeletons.forEach((skeleton) => { skeleton.visible = value; });
    if (key === 'wireframe') applyWireframe();
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

  for (const button of dockControls) {
    button.addEventListener('click', () => {
      const key = button.dataset.setting;
      if (key) setDockSetting(key, !settings[key]);
    });
  }

  // Reset restores the stage as it loaded: every clip back to its first frame AND
  // the camera back to its framing. Pause state is left alone on purpose —
  // paused, reset shows the opening pose; playing, the motion starts over. The
  // lil-gui "Reset view" item stays camera-only, as its name promises.
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
    ['Space', 'paused'],
    ['KeyO', 'auto orbit'],
  ]);

  window.addEventListener('keydown', (event) => {
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

// Match the prompt chips on phones: scale the complete Controls panel from its
// pinned top-right corner, preserving the desktop proportions instead of
// restyling individual rows. getBoundingClientRect() in measureGui() reports
// this transformed size, so prompt labels avoid the panel's visible footprint.
function applyResponsiveControlScale() {
  const scale = controlViewportScale(wrapper.clientWidth);
  gui.domElement.style.transform = scale === 1 ? '' : `scale(${scale})`;
  // Scale the desktop inset with the panel so its top/right alignment remains
  // visually identical. max() also keeps it clear of notches in fullscreen.
  const inset = 10 * scale;
  gui.domElement.style.top = scale === 1 ? '' : `max(${inset}px, env(safe-area-inset-top))`;
  gui.domElement.style.right = scale === 1 ? '' : `max(${inset}px, env(safe-area-inset-right))`;
}
applyResponsiveControlScale();

// Collapsing the panel frees the space under it, so the pills' no-go box must follow.
gui.onOpenClose?.(measureLabels);

// Sidebar: one row per example — the stage's name, plus how many rigs stand on
// it. The count is read off `files`, so it cannot fall out of step with the stage
// it labels. It is aria-hidden and the button carries the same fact in words: a
// bare numeral read out after a name is ambiguous where the column of them is not.
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
  btn.title = words;   // the numeral is unlabelled by design; this is where it says what it is
  btn.setAttribute('aria-pressed', 'false');
  btn.addEventListener('click', () => loadExample(i));
  sidebar.appendChild(btn);
});

// Drag & drop .fbx / .glb / .gltf onto the viewer.
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
// One measured delta drives everything on screen — mixers, auto-orbit, label
// easing — so a faster display renders the same motion more smoothly instead of
// a different, faster motion.
//
// The cap exists because rAF stops while the tab is hidden, so the first frame
// back carries the whole absence: uncapped, that is a rig teleporting through
// its clip and the camera spinning several revolutions at once. 1/20 s is longer
// than any frame a real display produces, so it only ever fires on a stall.
const MAX_FRAME_DELTA = 1 / 20;
(function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
  const playbackDelta = settings['paused'] ? 0 : dt;
  for (const m of mixers) m.update(playbackDelta);
  // Pass the delta: OrbitControls' no-argument branch advances a fixed step per
  // FRAME, so the sweep ran twice as fast on a 120 Hz screen as on a 60 Hz one
  // and slowed down under load. With a delta it is a rate — see 'orbit speed'.
  // dt and not playbackDelta: Pause holds the motion still and lets the camera
  // keep moving around it.
  controls.update(dt);
  renderer.render(scene, camera);
  updateLabels(dt); // after render: the camera matrices the pills project through are final
})();

let previousViewerWidth = wrapper.clientWidth;
window.addEventListener('resize', () => {
  const w = wrapper.clientWidth, h = wrapper.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  applyResponsiveControlScale();
  measureLabels(); // the pills' max-width is breakpoint-dependent, so their boxes move
  // A width change means either a responsive breakpoint or an orientation
  // change. Re-fit the stage so mobile keeps the same composed view as desktop.
  // Height-only changes are commonly Safari's address bar and should not reset
  // a view the visitor has already orbited.
  if (Math.abs(w - previousViewerWidth) > 1 && pivots.length) frameStage(activePad);
  previousViewerWidth = w;
});

// ── Deep links (lab only) ────────────────────────────────────────────────────
// interactive.html#unitree-g1-robot opens straight onto that stage: the slug is
// the label lowercased with everything non-alphanumeric collapsed to "-", so
// every sidebar entry has a stable, guessable address. loadExample writes the
// current stage's slug back to the bar, and hashchange lets a pasted or edited
// URL retarget a lab already open. The embedded page ignores all of this — its
// hash is the document's own TOC anchors.
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
