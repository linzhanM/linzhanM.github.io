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
//   4. Toolbar appliers (time scale / wireframe / lighting / shadow)
//   5. Model loading & material repair
//   6. Normalize & ground (Blender pipeline port)
//   7. Stage: framing + teardown
//   8. Layout helpers (row / stagger / behind / above / offsets)
//   9. Load a stage / example / dropped files
//  10. UI wiring (toolbar, sidebar, drag & drop)
//  11. Render loop, resize, init
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Imports & DOM refs ────────────────────────────────────────────────────
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { EXAMPLES } from './examples.js';

const wrapper = document.getElementById('viewer-wrapper');
const overlay = document.getElementById('loading-overlay');
const sidebar = document.getElementById('example-sidebar');
const LOADING_HTML = overlay.innerHTML;

// ── 2. State ─────────────────────────────────────────────────────────────────
// Toolbar state (persists across example switches).
const settings = {
  'show model': true,
  'show skeleton': true,
  'wireframe': false,
  'pause': false,
  'time scale': 1.0,
  'shadow': true,
};

// The active "stage" — parallel arrays, one entry per model in the window.
let pivots = [];       // THREE.Group wrapping each model (for ground/normalize/layout)
let models = [];       // each model's root object
let mixers = [];       // one AnimationMixer per animated model
let skeletons = [];    // one THREE.SkeletonHelper per model
let grid = null;       // shared ground grid, sized to the whole stage
let shadowPlane = null; // transparent shadow-catcher over the floor

let loadToken = 0;     // guards against overlapping async loads
let activePad = 1.15;  // camera padding of the current example (so Reset view keeps it)
let activeFloorY = 0;  // vertical nudge of the floor for the current example
let activeShift = [0, 0, 0]; // whole-diorama pan held OUT of auto-framing (e.g. [-1,0,0] slides left)

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
scene.background = new THREE.Color(0xf0eee6);

const camera = new THREE.PerspectiveCamera(
  35, wrapper.clientWidth / wrapper.clientHeight, 0.01, 5000
);
camera.position.set(0, 1.4, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;   // soft-edged ground shadows
wrapper.appendChild(renderer.domElement);

// Lights. Each remembers its base intensity so a per-example multiplier can
// brighten/dim just one window (see applyLighting / EXAMPLES `lighting`).
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 2.2);
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

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const clock = new THREE.Clock();

// ── 4. Toolbar appliers ──────────────────────────────────────────────────────
function applyTimeScale() {
  for (const m of mixers) m.timeScale = settings['pause'] ? 0 : settings['time scale'];
}

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

// Toggle ground shadows: stop the key light casting and hide the catcher plane.
// (Cheaper than flipping renderer.shadowMap.enabled, which would recompile materials.)
function applyShadow() {
  keyLight.castShadow = settings['shadow'];
  if (shadowPlane) shadowPlane.visible = settings['shadow'];
}

// ── 5. Model loading & material repair ───────────────────────────────────────
const isFbxPath = (p) => /\.fbx$/i.test(p);

// Load one model (url string or object-URL) with the right loader.
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
    o.castShadow = true;     // drop shadows onto the ground catcher
    o.receiveShadow = true;  // (and onto each other)
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

  // Resolve diffuse maps by their actual load state (not a guessed delay,
  // which could wrongly drop a slow-decoding embedded texture). A map that
  // loaded keeps its texture (and a black base color is lifted to white so
  // it shows through); a map that definitively failed — a missing external
  // .fbm texture — is dropped so the surface shows a clean base color
  // instead of an empty/black sample. Unresolved stragglers are dropped
  // after a generous timeout.
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
// e.g. mixamo-flip — ship with high-roughness standard materials that read dark
// and matte under the scene's direct lights. Lowering roughness sharpens their
// specular highlights, and an emissive lift brightens the dark diffuse without
// touching the global lighting or other models. Emissive comes in two flavors:
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
// Port of render_mesh_skeleton_stage.py's normalize + ground steps (note: glTF is
// Y-up where the Blender script is Z-up, so "ground" here is min-Y):
//   • normalize : scale so the MESH's tallest per-frame height == TARGET_HEIGHT (step 4)
//   • center    : x/z centered on the MESH bounding box over all frames (recenter, step 5)
//   • ground    : lowest JOINT across all frames -> y = 0 (lowest_joint_z + step 5),
//                 skipping armature-origin root joints (head_local.length < 1e-3 guard)
// groundToMesh: ground the lowest MESH vertex instead of the lowest joint — for rigs
//   (e.g. the fish) whose spine joints sit well above the belly, so joint-grounding
//   leaves the body floating above the grid.
// sizeBy: 'height' (default) scales so the tallest per-frame height == TARGET_HEIGHT;
//   'maxdim' scales by the largest per-frame bounding-box dimension instead. Use 'maxdim'
//   for elongated creatures animated across clips (eagles, sharks) — height varies wildly
//   with pose, so height-normalization makes the same character different sizes per clip,
//   whereas body length (the max dimension) is pose-stable and keeps them consistent.
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
  if (!bones.length && !skinned.length) return new THREE.Vector3(1, 1, 1);

  // Real joints = drop the armature-origin root (≈ Blender's head_local.length < 1e-3).
  const isOriginRoot = (b) => !(b.parent && b.parent.isBone) && b.position.length() < 1e-3;
  const realJoints = bones.filter((b) => !isOriginRoot(b));
  const joints = realJoints.length ? realJoints : bones;

  const gMin = new THREE.Vector3(Infinity, Infinity, Infinity);   // mesh bbox (all frames)
  const gMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let jointMinY = Infinity;                                       // lowest joint (all frames)
  let maxFrameHeight = 0;                                         // tallest single-frame mesh height
  let maxFrameDim = 0;                                            // largest single-frame bbox dimension
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

  // Normalized footprint, used to space models out in a row.
  return new THREE.Vector3(
    (gMax.x - gMin.x) * s, (gMax.y - gMin.y) * s, (gMax.z - gMin.z) * s
  );
}

// ── 7. Stage: framing + teardown ─────────────────────────────────────────────
// Shared checkerboard floor texture: a 2x2 pixel pattern (two ivory tones), tiled
// with NearestFilter for crisp squares. repeat is set per-rebuild to size the squares.
const checkerTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const cx = c.getContext('2d');
  cx.fillStyle = '#e7e1d3'; cx.fillRect(0, 0, 2, 2);
  cx.fillStyle = '#d0c9b5'; cx.fillRect(0, 0, 1, 1); cx.fillRect(1, 1, 1, 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// Frame the whole stage: fit the camera to the union of all pivots, drop a checker floor.
// pad > 1 zooms the camera further out (extra margin) without moving the models —
// useful when a tightly-spaced row (e.g. the two quadrupeds) still reads too big.
function frameStage(pad = 1.0) {
  const box = new THREE.Box3();
  for (const pv of pivots) box.expandByObject(pv);
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
  dist *= pad; // padding

  // The objects were physically translated by activeShift (applyStageShift), which
  // dragged the box center with them. Subtract it back out so the camera, floor, and
  // shadows stay locked on the natural (un-shifted) ground center — the objects slide
  // off-center within the frame, but the viewpoint never pans.
  const tx = center.x - activeShift[0];
  const ty = center.y - activeShift[1];
  const tz = center.z - activeShift[2];
  controls.target.set(tx, ty, tz);
  // Lift the camera above the target (~+0.28·dist) so it looks slightly DOWN at the
  // stage instead of dead level — a gentle high-angle view.
  camera.position.set(tx, ty + size.y * 0.12 + dist * 0.28, tz + dist);
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
  const gridSize = (Math.max(size.x, size.z, MIN_FRAME_WIDTH, 1) + 2 * shiftMag) * 1.6;
  const squares = 24;                          // squares across the whole floor
  checkerTex.repeat.set(squares / 2, squares / 2); // 2x2 base pattern -> 2 squares per repeat
  grid = new THREE.Mesh(
    new THREE.PlaneGeometry(gridSize, gridSize),
    // Unlit (like the old line grid) so the floor tone stays constant regardless of
    // the per-window lighting multiplier.
    new THREE.MeshBasicMaterial({ map: checkerTex, transparent: true, opacity: 0.75, side: THREE.DoubleSide })
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.set(tx, box.min.y + activeFloorY, tz); // natural center, so the floor stays put
  scene.add(grid);

  // Transparent shadow catcher laid just over the checker floor: ShadowMaterial
  // renders ONLY where a shadow falls, so the checker tone shows through elsewhere.
  if (shadowPlane) { scene.remove(shadowPlane); shadowPlane.geometry.dispose(); shadowPlane.material.dispose(); }
  shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(gridSize, gridSize),
    new THREE.ShadowMaterial({ opacity: 0.3 })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.set(tx, box.min.y + activeFloorY + 0.001, tz); // hair above the floor (no z-fight)
  shadowPlane.receiveShadow = true;
  shadowPlane.visible = settings['shadow'];
  scene.add(shadowPlane);

  // Fit the key light's ortho shadow frustum to the stage: aim it at the ground
  // center and size the frustum to the footprint so shadows stay crisp. A wider
  // frustum over the same map would blur/blockify them.
  const extent = Math.max(size.x, size.y, size.z, MIN_FRAME_WIDTH) + shiftMag;
  keyLight.target.position.set(tx, box.min.y, tz);
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
  pivots = []; models = []; mixers = []; skeletons = [];
}

// ── 8. Layout helpers ────────────────────────────────────────────────────────
// Each helper mutates pivots[].position in place. They run in this order:
//   row → stagger → behind → above → offsets
// so later helpers can build on earlier ones (e.g. `above` snaps onto a `behind`
// model, and `offset` nudges the final result).

// Position each model's `row` group along X (centered on the origin), then push
// row N back along −Z so multiple rows read as a front-to-back diorama. Models with
// `behind`/`above` are excluded — they anchor to another model later, so they must
// not shift a row's centering.
function layoutRows(specs, sizes, spacing, evenGaps, rowDepth = 2.6) {
  const members = pivots.map((_, i) => i).filter((i) => !specs[i].behind && !specs[i].above);

  // Group members by their row index (default 0 = front).
  const byRow = new Map();
  for (const i of members) {
    const r = specs[i].row || 0;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r).push(i);
  }

  for (const [r, rowIdx] of byRow) {
    placeAlongX(rowIdx, sizes, spacing, evenGaps);
    if (r) rowIdx.forEach((i) => { pivots[i].position.z += -r * rowDepth; pivots[i].updateMatrixWorld(true); });
  }
}

// Spread one row's members along X, centered on the origin.
function placeAlongX(rowIdx, sizes, spacing, evenGaps) {
  const sp = spacing || ROW_STEP_MULT;
  if (!rowIdx.length) return;

  if (evenGaps) {
    // Even *visual* gaps: place each model edge-to-edge with a constant gap, so a
    // wide model (e.g. the fish) doesn't crowd its neighbor while a narrow one leaves
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

// ── 9. Load a stage / example / dropped files ────────────────────────────────
// Expand an EXAMPLES entry's `files` into normalized specs, then load it.
function loadExample(index) {
  const ex = EXAMPLES[index];
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
      row: o.row || 0,
    };
  });
  return loadStage(specs, index, {
    scale: ex.scale, spacing: ex.spacing, pad: ex.pad, lighting: ex.lighting,
    evenGaps: ex.evenGaps, sizeBy: ex.sizeBy, stagger: ex.stagger, rowDepth: ex.rowDepth, floorOffset: ex.floorOffset,
    stageShift: ex.stageShift,
  });
}

// specs: [{ url, isFbx, material, ... }].  activeIndex: sidebar item to highlight, or null.
// opts: { scale, spacing, pad, lighting, evenGaps, sizeBy, stagger, rowDepth, floorOffset, stageShift } — see examples.js.
async function loadStage(specs, activeIndex, opts = {}) {
  const token = ++loadToken;
  overlay.innerHTML = LOADING_HTML;
  overlay.style.display = 'flex';
  [...sidebar.children].forEach((b, i) => b.classList.toggle('active', i === activeIndex));

  try {
    const loaded = await Promise.all(specs.map((s) => loadModel(s.url, s.isFbx)));
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
      scene.add(skeleton);

      pivots.push(pivot);
      models.push(model);
      skeletons.push(skeleton);
    }

    // Position the stage: rows → stagger → behind → above → offsets → whole-stage shift.
    activeShift = opts.stageShift || [0, 0, 0];
    layoutRows(specs, sizes, opts.spacing, opts.evenGaps, opts.rowDepth);
    applyStagger(opts.stagger);
    placeBehind(specs);
    placeAbove(specs);
    applyOffsets(specs);
    applyStageShift(activeShift); // move objects; frameStage keeps camera/floor centered

    applyTimeScale();
    applyWireframe();
    applyLighting(opts.lighting || 1);
    activePad = opts.pad || 1.0;
    activeFloorY = opts.floorOffset || 0;
    frameStage(activePad);
    overlay.style.display = 'none';
  } catch (err) {
    if (token !== loadToken) return;
    console.error('Failed to load stage', err);
    overlay.textContent = 'Failed to load model.';
  }
}

// Load user-supplied files (drag-drop or picker) as a new stage.
function loadFiles(fileList) {
  const files = [...fileList].filter((f) => /\.(fbx|glb|gltf)$/i.test(f.name));
  if (!files.length) return;
  const specs = files.map((f) => ({ url: URL.createObjectURL(f), isFbx: isFbxPath(f.name) }));
  loadStage(specs, null);
}

// ── 10. UI wiring ────────────────────────────────────────────────────────────
// Toolbar (lil-gui), pinned inside the viewer. Flat panel (no nested folders).
const gui = new GUI({ container: wrapper, title: 'Controls' });
gui.add(settings, 'show model').name('Geometry')
  .onChange((v) => models.forEach((m) => { m.visible = v; }));
gui.add(settings, 'show skeleton').name('Skeleton')
  .onChange((v) => skeletons.forEach((s) => { s.visible = v; }));
gui.add(settings, 'wireframe').name('Wireframe').onChange(applyWireframe);
gui.add(settings, 'shadow').name('Shadow').onChange(applyShadow);
gui.add(settings, 'time scale', 0, 2, 0.01).name('Speed').onChange(applyTimeScale);
gui.add({ reset: () => frameStage(activePad) }, 'reset').name('Reset view');

// Sidebar: one button per example.
EXAMPLES.forEach((ex, i) => {
  const btn = document.createElement('button');
  btn.className = 'example-item';
  btn.textContent = ex.label;
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

// ── 11. Render loop, resize, init ────────────────────────────────────────────
(function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  for (const m of mixers) m.update(dt);
  controls.update();
  renderer.render(scene, camera);
})();

window.addEventListener('resize', () => {
  const w = wrapper.clientWidth, h = wrapper.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
});

loadExample(0);
