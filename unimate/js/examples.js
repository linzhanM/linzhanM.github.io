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
//   rowSpacing per-row spacing override, keyed by row index (e.g. { 0: 0.9, 1: 1.1 }).
//             Rows not listed fall back to `spacing` — use when two rows have
//             different member counts/widths and shouldn't share one spacing.
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
//   floor     multiplier on the auto-sized checker floor (default 1). The floor pads
//             itself by 2×|stageShift| to keep reaching under a shifted group, which
//             on a deep shift inflates it until the models read lost — shrink it here.
//
// ── File entry ───────────────────────────────────────────────────────────────
//   A file is either a path string ('resources/glbs/foo.glb'), or an object { url, ...opts }:
//     url          model path (.glb / .gltf via GLTFLoader, .fbx via FBXLoader).
//     prompt       OVERRIDE for the text prompt on the chip pinned above this model.
//                  The prompts themselves live in `../resources/prompts.json`, keyed by filename,
//                  with the house style documented there — edit them there, not here;
//                  this field is only for showing one glb under a different prompt in
//                  one stage. `prompt: ''` (or any falsy value) suppresses the label.
//     labelSlot    initial prompt position around the model. The collision solver may
//                  still move it when another slot is substantially clearer.
//     lockLabelSlot keep the prompt in `labelSlot` instead of letting the solver
//                  choose another side of the model.
//     labelOffset  [x, y] pixel nudge applied to that prompt's chosen screen position.
//     labelPinOffset [x, y] pixel nudge applied only to the leader's endpoint.
//     material     per-model PBR override { roughness, metalness, emissiveIntensity,
//                  emissive?, colorScale? }. `colorScale` multiplies the base color
//                  (and therefore its texture) to compensate for brighter stage lights.
//                  Lowering roughness + an emissive lift rescues rigs
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

import { SHOWCASE_EXAMPLE } from './showcase.js?v=1';

// Shared PBR lift for the mixamo rigs — they all render dark/matte the same way,
// so they share one material. Every other glb uses its own inline `material`.
const MIXAMO = { roughness: 0.8, emissiveIntensity: 0.5 };

export const EXAMPLES = [
  SHOWCASE_EXAMPLE,
  // The stage both pages open on — `stageFromHash()` returns 0 for the embedded
  // viewer and for a lab arriving without a slug, so whatever stands first here
  // is the first thing a visitor sees. Four rigs that could not be built more
  // differently — 70 bones on tracks, a 7-bone floating robot, a 29-DOF
  // humanoid, a 19-bone quadruped — greeting on the same beat is the paper's
  // claim in one frame, which is why this is the stage that opens the page.
  //
  // All four clips are 48 frames at 24fps and hold their peak across the middle
  // third, so the arms, the wave and the rear-up arrive together with no stagger
  // to arrange.
  //
  // Two of the four carry a per-model `scale`, and both are corrections for the
  // same thing rather than art direction: height normalization sizes a rig by
  // its OWN tallest frame, so a clip whose peak is a raised arm (the G1) or a
  // rear-up (the Go2) gets sized by the gesture instead of by the body, and the
  // rig stands short for the rest of the loop. Read those two numbers as
  // "corrects for the gesture", not as "make this one bigger".
  {
    label: 'Welcome',
    files: [
      // Two rows, front to back:
      //   Row 0 (front):  WALL-E · EVE      — the pair, at the viewer.
      //   Row 1 (back):   G1 · Go2          — the two Unitree machines behind.
      // Depth is what buys the four rigs room: side by side the reared dog kept
      // leaning into whatever stood next to it (evenGaps sizes its slot from the
      // sprawl of a quadruped on all fours, not from the narrow column it
      // becomes when it rears), and the row had to spread until the group
      // stopped reading as a group. Standing them in two ranks solves the same
      // problem with depth instead of width, and the label solver already knows
      // what to do with a diorama: front row's chips go down onto the empty
      // floor, back row's up into the empty sky.
      //
      // groundToMesh throughout: EVE's root joint sits inside the body shell,
      // the G1's and the Go2's ankle joints sit above their foot shells, and
      // WALL-E's tracks hang below his — joint-grounding buries the first and
      // hovers the rest.
      //
      // The -open cut of the greet, not the one the WALL-E Robot stage runs:
      // same 70-bone rig, but the arms swing out to the sides instead of lifting
      // a little, about three times the travel. At this size in the front rank a
      // small gesture reads as nothing happening.
      //
      // It takes the shared prompt from prompts.json, which is why it says
      // "A robot …" and not the character line its neighbour stage overrides
      // with — four chips in one voice is the stage's whole claim, and
      // "WALL-E greets…" among them breaks the series into a cast list.
      { url: 'resources/glbs/wall-e-greet-open.glb', groundToMesh: true },
      // The waving cut of the greet, chosen over the plain one: the arms come up
      // to ~46° and then swing (46 → 31 → 39 → 46 → 36) while the head rocks
      // with them, so EVE keeps moving through the middle of the loop instead
      // of parking at her peak the way the other three do.
      { url: 'resources/glbs/eve_greet_wave.glb', groundToMesh: true },
      // Same correction the Unitree G1 stage makes for this clip and for the
      // same reason: the raised arm is what sets the bbox height, so height
      // normalization sizes the rig by the wave rather than by the body and the
      // G1 stands a head short of everyone here. 1.2 puts its shoulders back in
      // line with EVE's — which matters more in the back rank, where perspective
      // is already taking a cut out of it.
      { url: 'resources/glbs/g1_29dof_wave.glb', groundToMesh: true, scale: 1.2, row: 1 },
      // The multiplier lands on the rig's TALLEST frame, which for this clip is
      // the top of the rear — so it reads roughly double what it looks like on
      // the number. 1.3 put the dog's reared head above every other rig on the
      // stage, which is backwards: it is the small one here. 0.95 brings the
      // peak up to about EVE's head and leaves it at a large dog's height for
      // the rest of the loop.
      { url: 'resources/glbs/go2_rear_up.glb', groundToMesh: true, scale: 0.95, row: 1 },
    ],
    // rowDepth is well under the 2.6 default: the two ranks only have to be
    // told apart, and at 2.4 the back pair stood off across an empty stretch of
    // floor and read as a separate group rather than as the back of this one.
    // 1.4 keeps them close enough to greet together while the front pair still
    // clearly overlaps them. pad is still doing more work than usual, because a
    // second rank pushes the front row toward the camera as well as the back
    // row away from it — at the 1.2 that framed a single row WALL-E and EVE
    // were cropped off the bottom edge.
    spacing: 1.15, pad: 1.35, evenGaps: true, rowDepth: 1.4,
  },
  {
    label: 'Bipedal',
    files: [
      'resources/glbs/garfield.glb',
      'resources/glbs/gundam-kick.glb',
      {
        url: 'resources/glbs/mixamo-flip.glb',
        material: MIXAMO,
        labelSlot: 'above',
        lockLabelSlot: true,
      },
      'resources/glbs/ironman-walk.glb',
    ],
    pad: 1.15, spacing: 0.96
  },
  {
    label: 'Articulated',
    files: [
      { url: 'resources/glbs/satellite.glb', material: { roughness: 0.3, metalness: 0.7 }, rotate: [0, 30, 0], groundFrame: 1, groundToMesh: true },
      { url: 'resources/glbs/robot-arm.glb', rotate: [0, -60, 0], offset: [1., 0, -0.2], scale: 0.8, labelSlot: 'above', lockLabelSlot: true, labelOffset: [85, 10] },
      { url: 'resources/glbs/lamp.glb', rotate: [0, 45, 0], scale: 0.65, labelSlot: 'above', lockLabelSlot: true, labelOffset: [0, -24] },
    ],
    spacing: 0.6, lighting: 2., evenGaps: true,
  },
  {
    // Two-row diorama (front row 0 → back row 1, separated by `rowDepth`):
    //   Row 0 (front, ground):  gyarados · jellyfish          + a bird hovering above.
    //   Row 1 (back,  ground):  monster · stego               + two dragons above.
    // Flyers use `above: [index, height]` to sit over a specific ground model.
    label: 'Creatures',
    files: [
      // Row 0 (front, ground). Whole front row nudged left (−x).
      { url: 'resources/glbs/gyarados.glb', groundToMesh: true, scale: 1.25, offset: [-0.6, 0, 1.0] },    // 0
      { url: 'resources/glbs/jellyfish.glb', offset: [-0.6, 0, 1.0] },          // 1
      // Row 1 (back, ground).
      { url: 'resources/glbs/monster.glb', row: 1, scale: 1.3, material: { roughness: 0.8, emissiveIntensity: 0.8 }, rotate: [0, 90, 0], offset: [-0.5, -0.15, 0] },    // 2  yaw to profile; nudged left; sunk slightly into the ground
      { url: 'resources/glbs/stego-attack.glb', row: 1, material: { roughness: 0.6, emissiveIntensity: 0.8 }, scale: 1.8, groundFrame: 0, offset: [0., 0, 0], labelSlot: 'below', labelOffset: [30, 0] }, // 3  ground on the neutral stance (feet down, not the swinging tail); prompt starts below and slightly right
      // Flyers.
      { url: 'resources/glbs/bird.glb', scale: 0.7, above: [2, 1.4], offset: [1.5, 0, 1.0] }, // 4  hovering at back-row center (between the two dragons); nudged forward (+z)
      { url: 'resources/glbs/dragon-fire.glb', material: { roughness: 0.8, emissiveIntensity: 0.8 }, scale: 2.0, above: [2, 1.5], offset: [0, 0, 1.0] }, // 5  above monster; nudged forward (+z)
      { url: 'resources/glbs/dragon.glb', material: { roughness: 0.3, emissiveIntensity: 0.8 }, scale: 2.0, above: [3, 1.5], offset: [-1.0, 0, 12] },      // 6  above stego; nudged forward (+z)
      { url: 'resources/glbs/whale.glb', rotate: [0, 180, 0], scale: 0.8, offset: [-0.6, 0.3, 1.0] }, // 7  row 0 (front), lifted slightly off the ground; nudged left (−x)
      { url: 'resources/glbs/chicken.glb', scale: 0.7, material: { roughness: 0.6, emissiveIntensity: 0.8 }, above: [2, 0], offset: [1.5, 0, 0] }, // 8  on the ground directly below the bird (same anchor/offset as index 4)
    ],
    // pad still leaves the flanks the labels need, but only just — the chips learned
    // to take side and corner slots, so the camera no longer has to stand back far
    // enough to clear a band above and below everything.
    spacing: 1.05, pad: 1.02, evenGaps: true, rowDepth: 2.8, stageShift: [-0.3, 0, 0],
  },
  // Unitree's two machines walking side by side, out of the depth of the
  // stage toward the viewer — real locomotion, not in-place: the G1 covers
  // ~1.9 of its heights per loop, the Go2 ~5.6 of its own smaller height
  // (0.45 keeps the dog at roughly true scale beside the G1). stageShift
  // starts the pair at the BACK of the floor so the walk ENDS at the floor
  // centre: largest exactly when centred, never close enough to crop.
  // `floor` reins in the checker the deep shift would otherwise inflate.
  {
    label: 'Unitree Locomotion',
    files: [
      { url: 'resources/glbs/g1_29dof_walk_forward.glb', groundToMesh: true },
      { url: 'resources/glbs/go2_ellipse_walk.glb', groundToMesh: true, scale: 0.45 },
    ],
    spacing: 1.4,
    // scale is not cosmetic here: the pair spans less than the camera's
    // MIN_FRAME_WIDTH, so growing the models grows them on screen instead of
    // just refitting. Travel grows with them — keep stageShift ≈ the G1's
    // scaled travel so the walk still ends at the floor centre.
    scale: 3.0,
    pad: 1.8,
    // The walk occupies the middle third of the checker: it starts a third of
    // the way in from the back edge and ends at two thirds — shift places the
    // start, floor sizes the board so the ~2.5-unit scaled travel IS that
    // middle third.
    stageShift: [0, 0, -2.5],
    floor: 0.8,
  },
  {
    label: 'Quadruped Robot',
    files: [
      'resources/glbs/quadruped.glb',
      'resources/glbs/robot.glb',
    ],
    spacing: 1.35, scale: 0.6, pad: 0.7,
  },
  {
    label: 'WALL-E Robot',
    files: [
      {
        url: 'resources/glbs/wall-e-spin.glb',
        prompt: 'WALL-E spins around on his tracks.',
        groundToMesh: true,
      },
      {
        url: 'resources/glbs/wall-e-greet.glb',
        prompt: 'WALL-E greets with a friendly gesture.',
        groundToMesh: true,
      },
      {
        url: 'resources/glbs/wall-e-turn.glb',
        prompt: 'WALL-E turns around on his tracks.',
        groundToMesh: true,
      },
    ],
    spacing: 1.35,
    pad: 1.12,
    evenGaps: true,
  },
  // EVE, beside WALL-E. groundToMesh on all three: the rig is 7 bones and its
  // root joint sits well inside the body shell, so joint-grounding buries her
  // to the waist. The three clips are gestures rather than locomotion — nothing
  // travels, so the row holds its spacing for the whole loop.
  {
    label: 'EVE Robot',
    files: [
      { url: 'resources/glbs/eve_scan.glb', groundToMesh: true },
      { url: 'resources/glbs/eve_curious.glb', groundToMesh: true },
      { url: 'resources/glbs/eve_alert.glb', groundToMesh: true },
    ],
    spacing: 1.25,
    pad: 1.12,
    evenGaps: true,
  },
  // Unitree G1 (29-DOF humanoid). groundToMesh on all three: the ankle joints
  // sit above the foot shells, so joint-grounding leaves the feet hovering.
  // The wave's scale is a correction, not a design choice: sizing normalizes
  // to bbox height, and its raised arm makes that 1.28 against the others'
  // ~1.04 — 1.23 puts the three bodies back at one size.
  {
    label: 'Unitree G1 Robot',
    files: [
      { url: 'resources/glbs/g1_29dof_pick_up.glb', groundToMesh: true },
      { url: 'resources/glbs/g1_29dof_jump_forward.glb', groundToMesh: true },
      { url: 'resources/glbs/g1_29dof_wave.glb', groundToMesh: true, scale: 1.23 },
    ],
    spacing: 1.3,
    scale: 1.1,
    pad: 1.1,
  },
  {
    label: 'Baymax Robot',
    files: [
      { url: 'resources/glbs/bigwhite-walk.glb', labelOffset: [0, -18] },
      { url: 'resources/glbs/bigwhite-dance.glb', labelOffset: [0, -18] },
      { url: 'resources/glbs/bigwhite-punch.glb', labelOffset: [0, -18] },
    ],
    spacing: 1.0, pad: 1.12,
  },
  {
    label: 'Gundam Robot',
    files: [
      'resources/glbs/gundam-crouch.glb',
      'resources/glbs/gundam-punch.glb',
      'resources/glbs/gundam-jump.glb',
      'resources/glbs/gundam-dance.glb',
    ],
    spacing: 1.0, pad: 0.9,
  },
  {
    label: 'Armored Robot',
    files: [
      { url: 'resources/glbs/robot-walk.glb' },
      { url: 'resources/glbs/robot-jump.glb' },
      { url: 'resources/glbs/robot-rotate.glb' },
      { url: 'resources/glbs/robot-kick.glb', labelSlot: 'above', lockLabelSlot: true, labelOffset: [70, 15] },
    ],
    spacing: 1.1, pad: 1.1,
  },
  {
    label: 'Flower',
    files: [
      { url: 'resources/glbs/flower.glb', labelSlot: 'above', lockLabelSlot: true, labelOffset: [0, -5] },
      { url: 'resources/glbs/piranha-plant.glb', rotate: [0, 45, 0], offset: [0.0, 0, -0.2], labelSlot: 'above', lockLabelSlot: true, labelOffset: [0, -45] },
    ],
    spacing: 1.0, pad: 0.9,
  },
  {
    label: 'Eagle',
    files: [
      // Keep the prompt below the eagle and pull it clear of the canvas edge.
      { url: 'resources/glbs/eagle-takeoff.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 0.4, 0], labelSlot: 'below', lockLabelSlot: true, labelOffset: [24, 0] },
      { url: 'resources/glbs/eagle-strike.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 1.0, 0], labelOffset: [0, -10] },
      // Match the left eagle's annotation: below the model and clear of Controls.
      { url: 'resources/glbs/eagle-landing.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 0.4, 0], labelSlot: 'below', lockLabelSlot: true },
    ],
    sizeBy: 'maxdim', spacing: 1.15, evenGaps: true, lighting: 6.0,
  },
  {
    label: 'Shark',
    files: [
      { url: 'resources/glbs/jaws-swimright.glb', offset: [0, 0.4, 0] },
      { url: 'resources/glbs/jaws-biteleft.glb', offset: [0, 0.4, 0] },
      { url: 'resources/glbs/jaws-swim180.glb', offset: [-0.4, 0.4, 0] },
    ],
    sizeBy: 'maxdim', spacing: 1.0, evenGaps: true, lighting: 6.0, pad: 1.12,
  },
  {
    label: 'Michelle',
    files: [
      { url: 'resources/glbs/mixamo-kick.glb', material: MIXAMO, labelOffset: [-20, 0], labelPinOffset: [-45, 0] },
      { url: 'resources/glbs/mixamo-kick1.glb', material: MIXAMO },
      { url: 'resources/glbs/mixamo-breakdance.glb', material: MIXAMO },
    ],
    spacing: 0.5, stagger: 0.6, pad: 1.12,
  },
];
