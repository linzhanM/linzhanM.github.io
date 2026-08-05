// ─────────────────────────────────────────────────────────────────────────────
// Interactive viewer — scene catalog (data only, no engine code).
//
// EXAMPLES drives the viewer's sidebar: each entry is one "stage", a window of
// one or more models laid out together. Edit this file to add, reorder or
// reposition characters; the rendering engine lives in viewer.js and the
// per-page framing in stage-tuning.js.
//
// ── Stage options ────────────────────────────────────────────────────────────
//   label      sidebar button text; also the key stage-tuning.js and
//              viewer-presets.js match on, and the slug the lab deep-links to.
//   files      file entries, laid out left→right in a row.
//   spacing    row step multiplier (gap between models, in widths). Default 1.15.
//   rowSpacing per-row override keyed by row index, e.g. { 0: 0.9, 1: 1.1 }.
//              Rows not listed fall back to `spacing`.
//   scale      multiplies every model's normalized size in this stage.
//   pad        camera zoom-out margin (>1 pulls the camera back). Default 1.0.
//   lighting   per-stage light-intensity multiplier (1 = default look).
//   evenGaps   true = constant gap between model EDGES, so a wide model doesn't
//              crowd a narrow one; false = uniform center spacing.
//   sizeBy     'height' (default), or 'maxdim' to normalize to the largest bbox
//              dimension — pose-stable for elongated animals (eagles, sharks)
//              whose height swings wildly across clips.
//   stagger    peak depth offset: alternating models step forward/back along Z
//              so the row zig-zags instead of sitting on one line.
//   rowDepth   Z gap between rows when files use `row` (default 2.6).
//   stageShift [x, y, z] slides the GROUP off-center while the camera and floor
//              stay locked on the ground center. Held out of the auto-framing.
//   floor      multiplier on the auto-sized checker floor (default 1). The floor
//              pads itself by 2×|stageShift|, which a deep shift inflates until
//              the models read lost — shrink it here.
//
// ── File entry ───────────────────────────────────────────────────────────────
//   Either a path string, or an object { url, ...opts }:
//     url          .glb / .gltf via GLTFLoader, .fbx via FBXLoader.
//     prompt       OVERRIDE only. The prompts live in ../resources/prompts.json
//                  keyed by filename, with the house style documented there —
//                  edit them there. Use this to show one glb under a different
//                  prompt in one stage; `prompt: ''` suppresses the chip.
//     labelSlot    initial chip position; the collision solver may still move it.
//     lockLabelSlot hold `labelSlot` instead of letting the solver re-choose.
//     labelOffset  [x, y] pixel nudge on the chip's chosen screen position.
//     labelPinOffset [x, y] pixel nudge on the leader's endpoint only.
//     material     PBR override { roughness, metalness, emissiveIntensity,
//                  emissive?, colorScale? }. Lowering roughness and lifting
//                  emissive rescues rigs that render dark; pass a flat
//                  `emissive: 0xRRGGBB` for near-black rigs (eagles).
//                  `colorScale` multiplies the base color and its texture.
//     scale        size multiplier, stacking with the stage `scale`.
//     row          front-to-back row (0 = front, default). Rows are centered on
//                  X and pushed back by `rowDepth` per step.
//     groundToMesh ground the lowest MESH vertex instead of the lowest joint —
//                  for rigs whose spine joints float above the belly.
//     groundFrame  ground on a SINGLE frame (0..1) instead of the lowest point
//                  across all frames — for a limb that dips below the feet
//                  mid-clip and floats the body (stego-attack → groundFrame: 0).
//     rotate       [x, y, z] degrees, applied BEFORE grounding.
//     offset       [x, y, z] normalized-unit nudge, applied LAST.
//     behind       [index, depth] park behind row member `index`. Off the row.
//     above        [index, height] snap X/Z onto `index` and lift into the air
//                  (flyers). Chains resolve in dependency order. Off the row.
// ─────────────────────────────────────────────────────────────────────────────

import { SHOWCASE_EXAMPLE } from './showcase.js?v=4';

// The mixamo rigs all render dark and matte the same way, so they share one
// material. Every other glb carries its own inline `material`.
const MIXAMO = { roughness: 0.8, emissiveIntensity: 0.5 };

export const EXAMPLES = [
  SHOWCASE_EXAMPLE,
  // The stage both pages open on: whatever stands first here after
  // viewer-presets.js filters the hidden labels is the first thing a visitor
  // sees. Four rigs that could not be built more differently — 70 bones on
  // tracks, a 7-bone floating robot, a 29-DOF humanoid, a 19-bone quadruped —
  // greeting on one beat is the paper's claim in a single frame. All four clips
  // are 48 frames at 24fps and hold their peak across the middle third, so the
  // gestures arrive together with no stagger to arrange.
  {
    label: 'Welcome',
    files: [
      // Row 0 (front): WALL-E · EVE.  Row 1 (back): G1 · Go2.
      // Two ranks rather than one row of four: side by side, the reared dog
      // leaned into whatever stood next to it (evenGaps sizes its slot from a
      // quadruped's sprawl, not the narrow column it becomes rearing), and the
      // row had to spread until it stopped reading as a group. Depth buys the
      // same room without the spread.
      //
      // groundToMesh throughout: EVE's root joint sits inside her shell, the
      // G1's and Go2's ankle joints above their foot shells, WALL-E's tracks
      // below his — joint-grounding buries the first and hovers the rest.
      //
      // The two front chips are pushed out to the flanks, where at rest they
      // crowded the G1's chip into one block in the middle; the leaders keep
      // each one attached to its rig once they part. This costs the lab
      // nothing — it shows one prompt at the cursor and never runs the
      // anchored solver these offsets feed.
      //
      // The -open cut of the greet, not the one the WALL-E Robot stage runs:
      // same rig, arms swinging out to the sides instead of lifting a little.
      // At this size a small gesture reads as nothing happening.
      { url: 'resources/glbs/wall-e-greet-open.glb', groundToMesh: true, labelOffset: [-60, 0] },
      // The waving cut, chosen over the plain one: the arms come up and then
      // swing while the head rocks with them, so EVE keeps moving through the
      // middle of the loop instead of parking at her peak like the other three.
      { url: 'resources/glbs/eve_greet_wave.glb', groundToMesh: true, labelOffset: [60, 0] },
      // Both scales correct for the gesture rather than art-direct the rig:
      // height normalization sizes a rig by its OWN tallest frame, so a clip
      // whose peak is a raised arm or a rear-up is sized by the gesture and the
      // body stands short for the rest of the loop.
      { url: 'resources/glbs/g1_wave.glb', groundToMesh: true, scale: 1.3, row: 1 },
      // Here the multiplier lands on the top of the rear, so it reads about
      // double what the number suggests. 1.3 put the dog's reared head above
      // every other rig, which is backwards — it is the small one here.
      { url: 'resources/glbs/go2_rear_up.glb', groundToMesh: true, scale: 1.1, row: 1 },
    ],
    // rowDepth is under the 2.6 default: the ranks only have to be told apart,
    // and at 2.4 the back pair stood off across empty floor and read as a
    // separate group. pad is the lab's framing — the embed overrides it in
    // stage-tuning.js, so change both together or only one page moves.
    spacing: 1.15,
    pad: 1.2, evenGaps: true, rowDepth: 1.8,
  },
  {
    label: 'Articulated',
    files: [
      { url: 'resources/glbs/radar.glb', material: { roughness: 0.3, metalness: 0.7 }, rotate: [0, 30, 0], groundFrame: 1, groundToMesh: true },
      { url: 'resources/glbs/robot-arm.glb', rotate: [0, -60, 0], offset: [1.0, 0, -0.2], scale: 0.8, labelSlot: 'above', lockLabelSlot: true, labelOffset: [85, 10] },
      { url: 'resources/glbs/lamp.glb', rotate: [0, 45, 0], scale: 0.65, labelSlot: 'above', lockLabelSlot: true, labelOffset: [0, -24] },
    ],
    spacing: 0.6, lighting: 2.0, evenGaps: true,
  },
  {
    // Row 0 (front, ground): gyarados · jellyfish · whale, with a bird above.
    // Row 1 (back, ground):  monster · stego, with two dragons above.
    label: 'Creatures',
    files: [
      // Row 0. The whole front row is nudged left (−x) and forward (+z).
      { url: 'resources/glbs/gyarados.glb', groundToMesh: true, scale: 1.25, offset: [-0.6, 0, 1.0] },    // 0
      { url: 'resources/glbs/jellyfish.glb', offset: [-0.6, 0, 1.0] },                                     // 1
      // Row 1.
      { url: 'resources/glbs/monster.glb', row: 1, scale: 1.3, material: { roughness: 0.8, emissiveIntensity: 0.8 }, rotate: [0, 90, 0], offset: [-0.5, -0.15, 0] },    // 2  yawed to profile, sunk slightly into the ground
      { url: 'resources/glbs/stego-attack.glb', row: 1, material: { roughness: 0.6, emissiveIntensity: 0.8 }, scale: 1.8, groundFrame: 0, offset: [0, 0, 0], labelSlot: 'below', labelOffset: [30, 0] }, // 3  grounded on the neutral stance, not the swinging tail
      // Flyers, each anchored over a ground model.
      { url: 'resources/glbs/bird.glb', scale: 0.7, above: [2, 1.4], offset: [1.5, 0, 1.0] },              // 4  back-row center, between the two dragons
      { url: 'resources/glbs/dragon-fire.glb', material: { roughness: 0.8, emissiveIntensity: 0.8 }, scale: 2.0, above: [2, 1.5], offset: [0, 0, 1.0] },   // 5  above monster
      { url: 'resources/glbs/dragon.glb', material: { roughness: 0.3, emissiveIntensity: 0.8 }, scale: 2.0, above: [3, 1.5], offset: [-1.0, 0, 12] },      // 6  above stego
      { url: 'resources/glbs/whale.glb', rotate: [0, 180, 0], scale: 0.8, offset: [-0.6, 0.3, 1.0] },      // 7  row 0, lifted off the ground
      { url: 'resources/glbs/chicken.glb', scale: 0.7, material: { roughness: 0.6, emissiveIntensity: 0.8 }, above: [2, 0], offset: [1.5, 0, 0] },         // 8  on the ground under the bird (same anchor and offset as 4)
    ],
    // pad leaves the flanks the chips need and no more: they take side and
    // corner slots now, so the camera no longer stands back far enough to clear
    // a band above and below everything.
    spacing: 1.05, pad: 1.02, evenGaps: true, rowDepth: 2.8, stageShift: [-0.3, 0, 0],
  },
  {
    label: 'Bipedal',
    files: [
      'resources/glbs/garfield.glb',
      'resources/glbs/gundam-kick.glb',
      { url: 'resources/glbs/mixamo-flip.glb', material: MIXAMO, labelSlot: 'above', lockLabelSlot: true },
      'resources/glbs/ironman-walk.glb',
    ],
    pad: 1.15, spacing: 0.96,
  },
  {
    label: 'Quadrupedal',
    files: [
      'resources/glbs/quadruped-spot.glb',
      'resources/glbs/quadruped-green.glb',
    ],
    spacing: 1.35, scale: 0.6, pad: 0.7,
  },
  // The two Unitree machines walking out of the depth of the stage toward the
  // viewer — real locomotion, not in-place, so the layout has to account for
  // travel. scale is not cosmetic: the pair spans less than the camera's
  // MIN_FRAME_WIDTH, so growing the models grows them on screen instead of
  // just refitting, and their travel grows with them. stageShift starts the
  // pair at the BACK so the walk ENDS at the floor centre — largest exactly
  // when centred, never close enough to crop — and keeping it near the G1's
  // scaled travel is what holds that. floor reins in the checker the deep
  // shift would otherwise inflate.
  {
    label: 'Locomotion',
    files: [
      { url: 'resources/glbs/g1_walk.glb', groundToMesh: true },
      { url: 'resources/glbs/go2_ellipse_walk.glb', groundToMesh: true, scale: 0.45 },
    ],
    spacing: 1.4, scale: 3.0, pad: 1.8, stageShift: [0, 0, -2.5], floor: 0.8,
  },
  {
    label: 'WALL-E Robot',
    files: [
      { url: 'resources/glbs/wall-e-spin.glb', groundToMesh: true },
      { url: 'resources/glbs/wall-e-greet.glb', groundToMesh: true },
      { url: 'resources/glbs/wall-e-turn.glb', groundToMesh: true },
    ],
    spacing: 1.35, pad: 1.12, evenGaps: true,
  },
  // EVE's rig is 7 bones with its root well inside the body shell, so
  // joint-grounding buries her to the waist. The three clips are gestures
  // rather than locomotion — nothing travels, so the row holds its spacing.
  {
    label: 'EVE Robot',
    files: [
      { url: 'resources/glbs/eve_scan.glb', groundToMesh: true },
      { url: 'resources/glbs/eve_curious.glb', groundToMesh: true },
      { url: 'resources/glbs/eve_alert.glb', groundToMesh: true },
    ],
    spacing: 1.25, pad: 1.12, evenGaps: true,
  },
  // groundToMesh throughout: the G1's ankle joints sit above its foot shells,
  // so joint-grounding leaves the feet hovering. The wave's scale corrects for
  // its raised arm setting the bbox height (1.28 against the others' ~1.04),
  // putting the three bodies back at one size.
  {
    label: 'Unitree G1 Robot',
    files: [
      { url: 'resources/glbs/g1_pick_up.glb', groundToMesh: true },
      { url: 'resources/glbs/g1_jump.glb', groundToMesh: true },
      { url: 'resources/glbs/g1_wave.glb', groundToMesh: true, scale: 1.23 },
    ],
    spacing: 1.3, scale: 1.1, pad: 1.1,
  },
  {
    label: 'Baymax Robot',
    files: [
      { url: 'resources/glbs/baymax-walk.glb', labelOffset: [0, -18] },
      { url: 'resources/glbs/baymax-dance.glb', labelOffset: [0, -18] },
      { url: 'resources/glbs/baymax-punch.glb', labelOffset: [0, -18] },
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
      { url: 'resources/glbs/piranha-plant.glb', rotate: [0, 45, 0], offset: [0, 0, -0.2], labelSlot: 'above', lockLabelSlot: true, labelOffset: [0, -45] },
    ],
    spacing: 1.0, pad: 0.9,
  },
  {
    // The outer two chips are held below their eagles and pulled clear of the
    // canvas edge and the Controls panel; the middle one is free.
    label: 'Eagle',
    files: [
      { url: 'resources/glbs/eagle-takeoff.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 0.4, 0], labelSlot: 'below', lockLabelSlot: true, labelOffset: [24, 0] },
      { url: 'resources/glbs/eagle-strike.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 1.0, 0], labelOffset: [0, -10] },
      { url: 'resources/glbs/eagle-landing.glb', material: { emissive: 0x6b6455, emissiveIntensity: 0.18 }, offset: [0, 0.4, 0], labelSlot: 'below', lockLabelSlot: true },
    ],
    sizeBy: 'maxdim', spacing: 1.15, evenGaps: true, lighting: 6.0,
  },
  {
    label: 'Shark',
    files: [
      { url: 'resources/glbs/jaws-swimright.glb', offset: [0, 0.4, 0] },
      { url: 'resources/glbs/jaws-bite.glb', offset: [0, 0.4, 0] },
      { url: 'resources/glbs/jaws-swim180.glb', offset: [-0.4, 0.4, 0] },
    ],
    sizeBy: 'maxdim', spacing: 1.0, evenGaps: true, lighting: 6.0, pad: 1.12,
  },
  {
    label: 'Michelle',
    files: [
      { url: 'resources/glbs/mixamo-spinkick.glb', material: MIXAMO, labelOffset: [-20, 0], labelPinOffset: [-45, 0] },
      { url: 'resources/glbs/mixamo-highkick.glb', material: MIXAMO },
      { url: 'resources/glbs/mixamo-breakdance.glb', material: MIXAMO },
    ],
    spacing: 0.5, stagger: 0.6, pad: 1.12,
  },
];
