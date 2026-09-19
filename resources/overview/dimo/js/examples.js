// ─────────────────────────────────────────────────────────────────────────────
// DIMO Motion Lab — object catalog. Data only; the engine is viewer.js,
// the rig builder rigs.js and the toy decoder decoder.js.
//
// Every object is a rig: a skinned model rigs.js loads (the UR5e, the robot
// duck) or a kinematic tree of primitives it builds (the bouncing balls).
// Either way it samples 512 neural key points from the surface and covers it
// in Gaussians. Its motions are a BASIS — one periodic joint-space curve per
// motion (the project's own clips for the UR5e and the duck, hand-authored
// loops for the balls), each pinned to a point of the 2-D latent sheet — which
// decoder.js blends by RBF weights around the current latent code. That is an
// illustration of the paper's mechanism (a shared decoder conditioned on a
// latent code and time, driving key points that drive Gaussians), not the
// trained model: DIMO's latent is 32-D and its decoder an 8-layer MLP. The
// lab says so on screen; keep that line.
//
// ── Object ───────────────────────────────────────────────────────────────────
//   label     rail button text; slug is the deep-link hash (#robot-arm).
//   camera    { elevation, azimuth } in radians and fov?, the vertical lens
//             angle in degrees (default 32): the view the stage is framed
//             for. The engine fits distance and aim to what the bodies sweep,
//             so nothing is cropped at this view; Reset returns to it.
//   cycleSeconds  this object's period (default CYCLE_SECONDS): the time u
//             runs 0 → 1 over.
//   ringRadius the selected body's floor ring (default from the rig's reach,
//             never under 0.35: sized for the UR5e, far too wide for a small body).
//   instances how many bodies stand on the stage at once (the paper's point:
//             diverse motions of one object from one model). `ranks` counts
//             them per rank, front first (default: one rank of all); each rank
//             is centred, so a shorter rank behind stands in the gaps.
//             `stagger` sets neighbouring ranks that fraction of a step apart
//             sideways (0.5 lays equal ranks out as a hex). `spacing` is the
//             step within a rank, `depth` between ranks.
//   model     a skinned GLB: { url, rotation: [x, y, z] degrees on the whole
//             model, finish?, joints: { bone: { drive, axis } } }. Its
//             bones are links; `axis` is in the bone's own frame. A bone given
//             `free: true` instead of an axis floats: it reads six controls,
//             <drive>_tx/_ty/_tz (translation from rest, parent frame) and
//             _rx/_ry/_rz (XYZ Euler angles after rest). Every mesh
//             part must be rigidly bound to one bone. Compress it first
//             (meshopt, as AGENTS.md describes): the loader expects it.
//   joints    a kinematic tree, parent before child: the whole object when
//             there is no model, extra links when there is (`parent` may name
//             a bone). Each entry is one LINK carrying the joint that moves it:
//     name     unique; also the control name unless `drive` says otherwise.
//     parent   name of the parent link, or null for the fixed root.
//     pos      the joint's origin in the PARENT'S frame (after its rotation).
//     axis     unit axis of the joint in its own frame; absent = fixed link.
//     type     'revolute' (default, radians) or 'slide' (metres along `axis`).
//     drive    control name this joint reads, so two joints can share one
//              (both gripper fingers read `grip`).
//     shapes   primitives in the link's frame: { kind: 'cylinder' | 'sphere' |
//              'box', r, h | size, pos, color }. Cylinders stand along +y.
//   rest      the canonical pose (control → value): key points and Gaussians
//             are sampled in it, and a motion that leaves a control unset
//             holds it here.
//   motions   the basis. { name, caption, z: [x, y] in the unit sheet,
//             joints: { control: (u) => value } } with u the phase in [0, 1).
//             `caption` is the chip text and follows the paper's language-
//             guided form: one plain sentence naming the object and one action.
//
// The lab's frame: y up, +z the object's FRONT (the camera starts a little to
// the right of it). Joint sign conventions are per object, beside its entry.
//
// Primitive kinds (rigs.js): cylinder { r, h }, sphere { r }, and box
// { size, radius? } with rounded edges.
// `finish` picks the material: shell (default for light colours), metal
// (default for dark), gloss, matte. `scenery: true` marks a shape that is
// drawn with the object but is not part of it — no key points or Gaussians
// are sampled from it and it stays a mesh in Gaussian mode (the balls'
// plate). Give scenery its own colour: materials are shared by colour.
// ─────────────────────────────────────────────────────────────────────────────

import { MICRODUCK_MOTIONS } from './microduck-motions.js?v=2';
import { UR5E_MOTIONS } from './ur5e-motions.js?v=1';

export const CYCLE_SECONDS = 3.6;   // default period (an object may set its own)
// RBF width in sheet units (see decoder.js). Anchors stand ~0.33 apart, so at
// an anchor its own motion takes ≥ 0.97 of the weight and a body plays its
// basis motion undiluted; the blend only shows between anchors. At 0.17 a body
// kept 0.6–0.75, and nine motions averaged toward one.
export const LATENT_SIGMA = 0.1;
export const KEYPOINTS = 512;       // N_k in the paper
export const GAUSSIANS = 6000;

const TAU = Math.PI * 2;
const sin = (u, cycles = 1, phase = 0) => Math.sin(TAU * (u * cycles + phase));
const cos = (u, cycles = 1, phase = 0) => Math.cos(TAU * (u * cycles + phase));
const hold = (v) => () => v;

// Periodic samples: `values` spread evenly over one period, linear between
// neighbours, the last wrapping to the first — how a UR5e clip plays.
function sampled(values) {
  const n = values.length;
  return (u) => {
    const x = (u - Math.floor(u)) * n;
    const i = Math.floor(x) % n;
    const f = x - Math.floor(x);
    return values[i] + (values[(i + 1) % n] - values[i]) * f;
  };
}

// Palette. Shells are near-white so the Gaussians read as a render, joints are
// the page's ink, and each object gets one accent from the page's spectrum.
const DARK = '#252a35';
const STEEL = '#8b95a7';
const PINK = '#ff5c8a';

// ── UR5e ─────────────────────────────────────────────────────────────────────
// Universal Robots UR5e, a skinned model: resources/glbs/ur5e.glb, compressed
// from dimo/resources/glbs-raw/ur5e.glb (gitignored). Its eight
// bones follow ur5e.urdf.xacro's kinetic-style frames — shoulder_pan and
// wrist_2 turn about their bone's z, the lift, elbow and other wrists about
// its y — and every mesh part is rigidly bound to one bone. The model is
// yawed −90° so the arm at all zeros lies along the lab's front. The URDF
// ends at the flange, so a small parallel gripper hangs off wrist_3_link,
// standing along that bone's y (the tool axis) at the flange's 0.0996 m.
//
// Joint conventions, probed numerically by forward kinematics over the bones
// on 2026-09-10 (they are the UR controller's own, so UR joint angles play on
// the model as given): at all zeros the arm lies flat along the front;
// shoulder_lift −π/2 stands it up; elbow positive folds the forearm forward
// and down; shoulder_pan positive swings the arm toward +x. With wrist_2 at
// −π/2 the tool direction is set by lift + elbow + wrist_1: −π/2 points it
// DOWN, 0 BACKWARD, +π/2 UP and π FORWARD.
// Latent anchors on a jittered 3 × 3 grid, ~0.33 apart (LATENT_SIGMA is sized
// to that spacing), shared by every object whose clips fill a 3 × 3 stage;
// the clips take them in order.
const GRID_ANCHORS = [
  [0.16, 0.2], [0.5, 0.14], [0.84, 0.22],
  [0.18, 0.52], [0.52, 0.48], [0.82, 0.56],
  [0.16, 0.84], [0.5, 0.86], [0.84, 0.84],
];

// The clips were authored to the bare flange; with the lab's gripper hanging
// 0.16 past it, three of them reach below the floor — measured over the loop
// on 2026-09-13, fingers at polish −7.6 cm, peg insert −5.1, dispense −1.7.
// Each is raised at the shoulder by this much (rad) with wrist_1 turned back
// the same, so the tool keeps its orientation; the smallest step that leaves
// the fingers 2 cm clear, rounded up (polish needed 0.28, peg insert 0.18,
// dispense 0.14). The other six stay as extracted.
const UR5E_RAISE = { polish: 0.3, 'peg insert': 0.2, dispense: 0.15 };

const UR5E = {
  label: 'UR5e arm',
  slug: 'ur5e',
  // A long lens from just right of front, looking down enough that each rank
  // clears the one ahead. A wide lens converges the outer columns of a grid
  // into towers of arms, whatever the stagger.
  camera: { elevation: 0.42, azimuth: 0.12, fov: 22 },
  // The clips run 2.97 s; one period plays each at its own speed, and the loop
  // cuts straight back to the first frame.
  cycleSeconds: 3,
  // One body per motion: the whole basis on stage at once.
  instances: Math.min(UR5E_MOTIONS.length, 9),
  // Three ranks of three, each half a step off the next, so no arm stands
  // straight behind another: a plain 3 × 3 lines its columns up toward the
  // camera, and five-and-four leaves every arm small in a 16:9 frame. Spacing
  // is from the reach measured over all nine clips on 2026-09-10: an arm
  // sweeps x −0.40…+0.42 and z −0.14…+0.81 about its base, so 1.1 across
  // leaves ~0.28 between neighbours at the widest swing (palletize), and 1.4
  // between ranks keeps a back arm's forward reach ~0.45 clear of the arm ahead.
  ranks: [3, 3, 3],
  stagger: 0.5,
  spacing: 1.1,
  depth: 1.4,
  model: {
    url: 'resources/glbs/ur5e.glb',
    rotation: [0, -90, 0],
    joints: {
      shoulder_link: { drive: 'shoulder_pan', axis: [0, 0, 1] },
      upper_arm_link: { drive: 'shoulder_lift', axis: [0, 1, 0] },
      forearm_link: { drive: 'elbow', axis: [0, 1, 0] },
      wrist_1_link: { drive: 'wrist_1', axis: [0, 1, 0] },
      wrist_2_link: { drive: 'wrist_2', axis: [0, 0, 1] },
      wrist_3_link: { drive: 'wrist_3', axis: [0, 1, 0] },
    },
  },
  joints: [
    { name: 'gripper', parent: 'wrist_3_link', pos: [0, 0.0996, 0], shapes: [
      { kind: 'cylinder', r: 0.036, h: 0.012, pos: [0, 0.006, 0], color: PINK, finish: 'gloss' },
      { kind: 'box', size: [0.086, 0.04, 0.046], radius: 0.008, pos: [0, 0.032, 0], color: DARK },
    ] },
    { name: 'finger_l', parent: 'gripper', pos: [-0.026, 0.05, 0], axis: [-1, 0, 0], type: 'slide', drive: 'grip', shapes: [
      { kind: 'box', size: [0.011, 0.058, 0.024], radius: 0.003, pos: [0, 0.029, 0], color: STEEL },
    ] },
    { name: 'finger_r', parent: 'gripper', pos: [0.026, 0.05, 0], axis: [1, 0, 0], type: 'slide', drive: 'grip', shapes: [
      { kind: 'box', size: [0.011, 0.058, 0.024], radius: 0.003, pos: [0, 0.029, 0], color: STEEL },
    ] },
  ],
  // Rest: the first clip's first pose.
  rest: Object.fromEntries(Object.entries(UR5E_MOTIONS[0].joints).map(([c, v]) => [c, v[0]])),
  // The motions are the project's nine UR5e clips
  // (dimo/resources/glbs-raw/ur5e_<motion>.glb), read into joint angles in the
  // generated ur5e-motions.js (AGENTS.md says how a clip became a loop). Each
  // keeps its file and length in `source`.
  motions: UR5E_MOTIONS.map((e, i) => ({
    name: e.name,
    caption: e.caption,
    z: GRID_ANCHORS[i],
    source: e.source,
    joints: Object.fromEntries(Object.entries(e.joints).map(([control, values]) => {
      const raise = UR5E_RAISE[e.name] || 0;
      const shifted = control === 'shoulder_lift' ? values.map((v) => v - raise)
        : control === 'wrist_1' ? values.map((v) => v + raise)
        : values;
      return [control, sampled(shifted)];
    })),
  })),
};

// ── Robot duck ───────────────────────────────────────────────────────────────
// The Microduck (pollen-robotics), a small servo biped, with the project's own
// clips (dimo/resources/glbs-raw/microduck_<motion>.glb). Fourteen servo bones
// each turn about their own z; the trunk floats (it sits, lies down and backs
// away), so it reads six free controls instead of an axis. microduck-motions.js
// was generated the same way as the UR5e's.
const MICRODUCK_SERVOS = ['yaw2roll', 'hip_l', 'upper_leg_left', 'leg', 'ankle_left', 'neck', 'neck_pitch',
  'yaw_roll_motion', 'jaw_soft', 'bearing_roll', 'hip_l_2', 'upper_leg_right', 'leg_2', 'ankle_right'];

// Where each clip stands, front rank first and left to right (body i plays
// motion i). A clip that moves goes where it has room: play dead (falls back
// 0.28 m) and electric slide (slides 0.19 m right, so the rank's right end) in
// the front rank, where nothing hides them; back away (backs off 0.22 m) at the
// back, into open floor. In clip order the slide stood 10 cm from its neighbour
// and play dead, at the back, was up to 46% hidden.
const MICRODUCK_ORDER = ['play dead', 'sit down', 'electric slide', 'curious tilts', 'turn away', 'head wag',
  'angry snaps', 'laugh', 'back away'];
const MICRODUCK_STAGE = MICRODUCK_ORDER.map((name) => {
  const motion = MICRODUCK_MOTIONS.find((e) => e.name === name);
  if (!motion) throw new Error(`microduck-motions.js has no motion named "${name}"`);
  return motion;
});

const MICRODUCK = {
  label: 'Robot duck',
  slug: 'microduck',
  camera: { elevation: 0.42, azimuth: 0.12, fov: 22 },
  cycleSeconds: 3,   // the clips run 2.97 s, played at their own speed
  instances: Math.min(MICRODUCK_MOTIONS.length, 9),
  // The UR5e's staggered 3 × 3 at the duck's scale: a duck stands ~0.29 tall,
  // 0.36 across and 0.5 between ranks, in MICRODUCK_ORDER. Measured over the
  // loop on 2026-09-11 (posed key points, 24 phases): no two ducks come within
  // 17.9 cm (play dead and sit down), and in the homepage thumbnail each stands
  // 40–62 px tall and none is hidden more than a third by the ducks in front.
  ranks: [3, 3, 3],
  stagger: 0.5,
  spacing: 0.36,
  depth: 0.5,
  ringRadius: 0.11,
  model: {
    // Every clip shares one rest pose, so any of them is the model; its own
    // animation never plays (the lab poses the bones).
    url: 'resources/glbs/microduck-angry_head_snaps.glb',
    rotation: [0, 0, 0],
    joints: {
      trunk_base: { drive: 'trunk', free: true },
      ...Object.fromEntries(MICRODUCK_SERVOS.map((bone) => [bone, { drive: bone, axis: [0, 0, 1] }])),
    },
  },
  rest: Object.fromEntries(Object.entries(MICRODUCK_MOTIONS[0].joints).map(([c, v]) => [c, v[0]])),
  motions: MICRODUCK_STAGE.map((e, i) => ({
    name: e.name,
    caption: e.caption,
    z: GRID_ANCHORS[i],
    source: e.source,
    joints: Object.fromEntries(Object.entries(e.joints).map(([control, values]) => [control, sampled(values)])),
  })),
};

// ── Bouncing balls ───────────────────────────────────────────────────────────
// D-NeRF's three-colour bouncing-balls scene, the canonical 4D toy: three
// glossy spheres whose only motion is rigid translation, so every key point
// trajectory is the ball's own path. Each ball rides three slide joints.
const BALL_R = 0.16;
const BALL_X = [-0.5, 0, 0.5];
const PLATE_H = 0.035;
const BALL_COLORS = ['#e4453c', '#3fbf5a', '#3b82f6'];
const ballJoints = (i) => [
  { name: `ball${i}_x`, parent: 'root', pos: [BALL_X[i], BALL_R + PLATE_H, 0], axis: [1, 0, 0], type: 'slide' },
  { name: `ball${i}_y`, parent: `ball${i}_x`, pos: [0, 0, 0], axis: [0, 1, 0], type: 'slide' },
  { name: `ball${i}_z`, parent: `ball${i}_y`, pos: [0, 0, 0], axis: [0, 0, 1], type: 'slide', shapes: [
    { kind: 'sphere', r: BALL_R, color: BALL_COLORS[i], finish: 'gloss' },
  ] },
];
const balls = (fn) => Object.fromEntries([0, 1, 2].flatMap((i) => {
  const [x, y, z] = fn(i);
  return [[`ball${i}_x`, x], [`ball${i}_y`, y], [`ball${i}_z`, z]];
}));
const still = hold(0);
const hop = (x) => Math.max(0, x);

const BALLS = {
  label: 'Bouncing balls',
  slug: 'bouncing-balls',
  camera: { elevation: 0.3, azimuth: 0.3 },
  instances: 3,
  spacing: 1.85,
  joints: [
    // The plate the balls stand on, as in the D-NeRF scene: scenery, so each
    // set of balls reads as one object on its own ground.
    { name: 'root', parent: null, pos: [0, 0, 0], shapes: [
      { kind: 'box', size: [1.6, PLATE_H, 0.9], radius: 0.012, pos: [0, PLATE_H / 2, 0], color: '#cfd3dc', finish: 'matte', scenery: true },
    ] },
    ...ballJoints(0), ...ballJoints(1), ...ballJoints(2),
  ],
  rest: balls(() => [0, 0, 0]),
  motions: [
    {
      name: 'bounce',
      caption: 'Three balls bounce in place, out of step.',
      z: [0.5, 0.18],
      joints: balls((i) => [still, (u) => 0.6 * Math.abs(Math.sin(Math.PI * (2 * u + i / 3))), still]),
    },
    {
      name: 'wave',
      caption: 'Three balls hop one after another.',
      z: [0.18, 0.42],
      joints: balls((i) => [still, (u) => 0.55 * Math.pow(hop(sin(u, 1, -0.2 * i)), 1.3), still]),
    },
    {
      name: 'orbit',
      caption: 'Three balls circle a common centre.',
      z: [0.84, 0.42],
      joints: balls((i) => [
        (u) => 0.5 * cos(u, 1, i / 3) - BALL_X[i],
        (u) => 0.05 * (1 + sin(u, 3, i / 3)),
        (u) => 0.5 * sin(u, 1, i / 3),
      ]),
    },
    {
      name: 'collide',
      caption: 'Two balls run at the middle one and rebound.',
      z: [0.32, 0.84],
      joints: balls((i) => [
        (u) => BALL_X[i] * (0.36 + 0.64 * Math.abs(Math.cos(Math.PI * u))) - BALL_X[i],
        i === 1 ? (u) => 0.4 * hop(sin(u, 1, -0.5)) ** 1.5 : (u) => 0.12 * hop(-cos(u, 2)),
        still,
      ]),
    },
    {
      name: 'sway',
      caption: 'Three balls roll side to side together.',
      z: [0.7, 0.86],
      joints: balls((i) => [(u) => 0.35 * sin(u), still, (u) => 0.12 * sin(u, 2, i * 0.2)]),
    },
  ],
};

// The duck opens the lab; the homepage thumbnail opens on #microduck and
// cycles to the UR5e (embedCycle in interactive.js).
export const OBJECTS = [MICRODUCK, UR5E, BALLS];
