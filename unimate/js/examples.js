// ─────────────────────────────────────────────────────────────────────────────
// Interactive viewer — scene catalog (data only, no engine code).
//
// EXAMPLES drives the viewer's sidebar: each entry is one "stage" (a window of
// one or more models laid out together). Edit this file to add/reorder/reposition
// characters; the rendering engine lives in viewer.js.
//
// ── Per-example options ──────────────────────────────────────────────────────
//   label     sidebar button text.
//   files     array of file entries (see below), laid out left→right in a row.
//   spacing   row step multiplier (gap between models, in widths). Default 1.15.
//   scale     multiplies EVERY model's normalized size in this stage (e.g. 0.6
//             shrinks stocky quadrupeds so they don't read oversized next to bipeds).
//   pad       camera zoom-out margin (>1 pulls the camera back). Default 1.0.
//   lighting  per-stage light-intensity multiplier (1 = default look).
//   evenGaps  true = constant visual gap between model edges (so a wide model
//             doesn't crowd a narrow one); false = uniform center spacing.
//   sizeBy    'height' (default) normalizes to unit height; 'maxdim' normalizes to
//             the largest bbox dimension — pose-stable sizing for elongated animals
//             (eagles, sharks) whose height swings wildly across clips.
//   stagger   peak depth offset: pushes alternating row models forward/back along Z
//             so the row zig-zags instead of sitting on one straight line.
//   rowDepth  Z gap between rows when files use `row` (default 2.6). Bigger = deeper.
//   stageShift [x, y, z] slide the WHOLE group of objects off-center within the frame,
//             while the camera + floor stay locked on the ground center (the objects
//             move across a stationary floor; the viewpoint never pans). Held out of
//             the auto-framing. e.g. [-1, 0, 0] moves the group left. Default [0, 0, 0].
//
// ── File entry ───────────────────────────────────────────────────────────────
//   A file is either a path string ('glbs/foo.glb'), or an object { url, ...opts }:
//     url          model path (.glb / .gltf via GLTFLoader, .fbx via FBXLoader).
//     material     per-model PBR override { roughness, metalness, emissiveIntensity,
//                  emissive? }. Lowering roughness + an emissive lift rescues rigs
//                  that render dark/matte. Pass a flat `emissive: 0xRRGGBB` for
//                  near-black rigs (eagles); omit it to lift via the model's own map.
//     scale        per-model size multiplier (stacks with the stage `scale`).
//     row          which front-to-back row this model sits in (0 = front, default).
//                  Each row is centered on X and pushed back by `rowDepth` per step.
//     groundToMesh ground the lowest MESH vertex instead of the lowest joint — for
//                  rigs (e.g. gyarados) whose spine joints float above the belly.
//     groundFrame  ground on a SINGLE frame (normalized 0..1) rather than the lowest
//                  point across all frames — use when a limb/tail dips below the feet
//                  mid-clip and floats the body (e.g. stego-attack → groundFrame: 0).
//     rotate       [x, y, z] degrees, applied BEFORE grounding (re-orient a model).
//     offset       [x, y, z] normalized-unit nudge, applied LAST (after all layout).
//     behind       [index, depth] — park this model behind row member `index`,
//                  pushed back `depth` along −Z. Excluded from the row.
//     above        [index, height] — snap X/Z onto target `index` and lift `height`
//                  units into the air (flyers). Targets may themselves be `above`
//                  models (chains resolve in dependency order). Excluded from the row.
// ─────────────────────────────────────────────────────────────────────────────

// Shared PBR lift for the mixamo rigs — they all render dark/matte the same way,
// so they share one material. Every other glb uses its own inline `material`.
const MIXAMO = { roughness: 0.8, emissiveIntensity: 0.5 };

export const EXAMPLES = [
  {
    label: 'Bipedal',
    files: [
      'glbs/garfield.glb',
      'glbs/gundam-punch.glb',
      { url: 'glbs/mixamo-flip.glb', material: MIXAMO },
      'glbs/ironman-walk.glb',
    ],
    pad: 1.12,
  },
  {
    label: 'Articulated',
    files: [{ url: 'glbs/satellite.glb', material: { roughness: 0.3, metalness: 0.7 }, rotate: [0, 30, 0], groundFrame: 1, groundToMesh: true }, { url: 'glbs/robot-arm.glb', rotate: [0, -60, 0], offset: [1. , 0, -0.2],scale: 0.8 }, { url: 'glbs/lamp.glb', rotate: [0, 45, 0], scale: 0.65 }],
    spacing: 0.6, lighting: 2., evenGaps: true,
  },
  {
    label: 'Flower',
    files: [
      'glbs/flower.glb',
      { url: 'glbs/piranha-plant.glb', rotate: [0, 45, 0], offset: [0.0, 0, -0.2] },
    ],
    spacing: 1.0, pad: 0.9,
  },
  {
    // Two-row diorama (front row 0 → back row 1, separated by `rowDepth`):
    //   Row 0 (front, ground):  gyarados · jellyfish          + a bird hovering above.
    //   Row 1 (back,  ground):  monster · stego               + two dragons above.
    // Flyers use `above: [index, height]` to sit over a specific ground model.
    label: 'Zoo',
    files: [
      // Row 0 (front, ground). Whole front row nudged left (−x).
      { url: 'glbs/gyarados.glb', groundToMesh: true, scale: 1.25, offset: [-0.6, 0, 1.0] },    // 0
      { url: 'glbs/jellyfish.glb', offset: [-0.6, 0, 1.0] },          // 1
      // Row 1 (back, ground).
      { url: 'glbs/monster.glb', row: 1, scale: 1.3, material: { roughness: 0.8, emissiveIntensity: 0.8 }, rotate: [0, 90, 0], offset: [-0.5, -0.15, 0] },    // 2  yaw to profile; nudged left; sunk slightly into the ground
      { url: 'glbs/stego-attack.glb', row: 1, material: { roughness: 0.6, emissiveIntensity: 0.8 }, scale: 1.8, groundFrame: 0, offset: [0., 0, 0] }, // 3  ground on the neutral stance (feet down, not the swinging tail)
      // Flyers.
      { url: 'glbs/bird.glb', scale: 0.7, above: [2, 1.4], offset: [1.5, 0, 1.0] }, // 4  hovering at back-row center (between the two dragons); nudged forward (+z)
      { url: 'glbs/dragon-fire.glb', material: { roughness: 0.8, emissiveIntensity: 0.8 }, scale: 2.0, above: [2, 1.5], offset: [0, 0, 1.0] }, // 5  above monster; nudged forward (+z)
      { url: 'glbs/dragon.glb', material: { roughness: 0.3, emissiveIntensity: 0.8 }, scale: 2.0, above: [3, 1.5], offset: [-1.0, 0, 12] },      // 6  above stego; nudged forward (+z)
      { url: 'glbs/whale.glb', rotate: [0, 180, 0], scale: 0.8, offset: [-0.6, 0.3, 1.0] }, // 7  row 0 (front), lifted slightly off the ground; nudged left (−x)
      { url: 'glbs/chicken.glb', scale: 0.7, material: { roughness: 0.6, emissiveIntensity: 0.8 }, above: [2, 0], offset: [1.5, 0, 0] }, // 8  on the ground directly below the bird (same anchor/offset as index 4)
    ],
    spacing: 1.05, pad: 1.05, evenGaps: true, rowDepth: 2.8, stageShift: [-0.3, 0, 0],
  },
  {
    label: 'Humanoid Robot',
    files: [
      // Row 0 (front): gundams (left & right nudged inward toward the center kick).
      { url: 'glbs/gundam-crouch.glb', scale: 0.8, offset: [0.1, 0, 0] },
      { url: 'glbs/gundam-kick.glb', scale: 0.8 },
      { url: 'glbs/gundam-dance.glb', scale: 0.8, offset: [-0.1, 0, 0] },
      // Row 1 (back): robots.
      { url: 'glbs/robot-walk.glb', row: 1 },
      { url: 'glbs/robot-jump.glb', row: 1 },
      { url: 'glbs/robot-rotate.glb', row: 1 },
      { url: 'glbs/robot-kick.glb', row: 1 },
    ],
    spacing: 1.0, pad: 1.1, rowDepth: 1.8,
  },
  {
    label: 'Quadruped Robot',
    files: ['glbs/quadruped.glb', 'glbs/robot.glb'],
    spacing: 1.35, scale: 0.6, pad: 0.7,
  },
  {
    label: 'Baymax Robot',
    files: ['glbs/bigwhite-walk.glb', 'glbs/bigwhite-dance.glb', 'glbs/bigwhite-punch.glb'],
    spacing: 1.0, pad: 1.12,
  },
  {
    label: 'Eagle',
    files: [
      { url: 'glbs/eagle-takeoff.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 0.4, 0] },
      { url: 'glbs/eagle-strike.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 1.0, 0] },
      { url: 'glbs/eagle-landing.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 0.4, 0] },
    ],
    sizeBy: 'maxdim', spacing: 1.15, evenGaps: true, lighting: 6.0,
  },
  {
    label: 'Shark',
    files: [
      { url: 'glbs/jaws-swimright.glb', offset: [0, 0.4, 0] },
      { url: 'glbs/jaws-biteleft.glb', offset: [0, 0.4, 0] },
      { url: 'glbs/jaws-swim180.glb', offset: [-0.4, 0.4, 0] },
    ],
    sizeBy: 'maxdim', spacing: 1.0, evenGaps: true, lighting: 6.0, pad: 1.12,
  },
  {
    label: 'Michelle',
    files: [
      { url: 'glbs/mixamo-kick.glb', material: MIXAMO },
      { url: 'glbs/mixamo-kick1.glb', material: MIXAMO },
      { url: 'glbs/mixamo-breakdance.glb', material: MIXAMO },
    ],
    spacing: 0.5, stagger: 0.6, pad: 1.12,
  },
];
