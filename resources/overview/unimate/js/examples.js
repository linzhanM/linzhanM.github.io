// ─────────────────────────────────────────────────────────────────────────────
// Interactive viewer — scene catalog. Data only; the engine is viewer.js. This
// copy's catalog is the root homepage's one stage (homepage.js); the option
// vocabulary below is unimate/'s, kept whole so the stage can use any of it.
//
// EXAMPLES drives the sidebar: each entry is one "stage", a window of one or
// more models laid out together. Add, reorder or reposition rigs here.
//
// ── Stage options ────────────────────────────────────────────────────────────
//   label      sidebar button text; also the slug the lab deep-links to.
//   files      file entries, laid out left→right in a row.
//   spacing    row step multiplier (gap between models, in widths). Default 1.15.
//   rowSpacing per-row override keyed by row index, e.g. { 0: 0.9, 1: 1.1 }.
//              Rows not listed fall back to `spacing`.
//   rowOrder   file indices in left→right order, e.g. [2, 0, 1, 3]. Placement
//              only — the files, and every index they cite, stay as written.
//              Files it omits follow the ones it names, in catalog order.
//   scale      multiplies every model's normalized size in this stage.
//   pad        camera zoom-out margin (>1 pulls the camera back). Default 1.0.
//   lighting   light-intensity multiplier (1 = default look).
//   evenGaps   true = constant gap between model EDGES, so a wide model doesn't
//              crowd a narrow one; false = uniform centre spacing.
//   sizeBy     'height' (default), or 'maxdim' to normalize to the largest bbox
//              dimension — pose-stable for elongated animals (eagles, sharks)
//              whose height swings across clips.
//   stagger    peak depth offset: alternating models step forward/back along Z
//              so the row zig-zags instead of sitting on one line.
//   rowDepth   Z gap between rows when files use `row` (default 2.6).
//   fileOffsets { index: [x, y, z] } — one rig's nudge, in the same normalized
//              units as the file's own `offset` and added on top of it.
//   singleRow  collapse every `row` onto the front rank.
//   stageShift [x, y, z] slides the GROUP off-centre while the camera and floor
//              stay locked on the ground centre. Held out of the auto-framing.
//   frameEnvelope true = frame the camera and floor on every rig's whole clip
//              (the envelope drop-ins already use) instead of the pose at load.
//              For a stage whose rigs reach or travel mid-clip, so its offsets
//              don't fight a camera that re-centres on them.
//   floor      multiplier on the auto-sized paper floor (default 1). The floor
//              pads itself by 2×|stageShift|, which a deep shift inflates until
//              the models read lost — shrink it here.
//   sameRig    Override only. A stage whose files all share the stem before
//              the dash (g1-pick_up, g1-jump, g1-wave) is ONE character and is
//              sized alike automatically — by each rig's bind-pose mesh rather
//              than the tallest frame of its own clip, which shrinks whichever
//              clip raises an arm; the plainest-posed clip keeps the size the
//              height rule gives it and the rest match it. A mixed stage keeps
//              the height rule. `true`/`false` forces either way.
//   liftScale  lab only: multiplier on how far the pinned prompt stands above
//              each rig's root joint (default 1). The engine measures that from
//              the mesh; under 1 lets the chip sit into a silhouette that is
//              mostly air (a bird's wings), so the leader stays short.
//
// ── File entry ───────────────────────────────────────────────────────────────
//   Either a path string, or an object { url, ...opts }:
//     url          .glb / .gltf via GLTFLoader.
//     prompt       OVERRIDE only. Prompts live in ../resources/prompts.json,
//                  keyed by filename, with the house style documented there.
//                  Use this to show one glb under a different prompt in one
//                  stage; `prompt: ''` suppresses the chip.
//     labelSlot    initial chip position; the collision solver may still move it.
//     lockLabelSlot hold `labelSlot` instead of letting the solver re-choose.
//     labelOffset  [x, y] pixel nudge on the chip's chosen screen position.
//     labelPinOffset [x, y] pixel nudge on the leader's endpoint only.
//     liftScale    lab only: this rig's own multiplier on the pinned prompt's
//                  height above its root, on top of the stage's `liftScale`.
//     material     PBR override { roughness, metalness, emissiveIntensity,
//                  emissive?, colorScale? }. Lower roughness and higher
//                  emissive rescue rigs that render dark; a flat
//                  `emissive: 0xRRGGBB` for near-black rigs (eagles).
//                  `colorScale` multiplies the base colour and its texture.
//     scale        size multiplier, stacking with the stage `scale`.
//     row          front-to-back row (0 = front, default). Rows are centred on
//                  X and pushed back by `rowDepth` per step.
//     groundToMesh ground the lowest MESH vertex instead of the lowest joint —
//                  for rigs whose joints float above (or sit inside) the body.
//     groundFrame  ground on a SINGLE frame (0..1) instead of the lowest point
//                  across all frames — for a limb that dips below the feet
//                  mid-clip and floats the body (stego-attack → groundFrame: 0).
//     rotate       [x, y, z] degrees, applied BEFORE grounding.
//     offset       [x, y, z] normalized-unit nudge, applied LAST.
//     behind       [index, depth] park behind row member `index`. Off the row.
//     above        [index, height] snap X/Z onto `index` and lift into the air
//                  (flyers). Chains resolve in dependency order. Off the row.
// ─────────────────────────────────────────────────────────────────────────────

import { TEASER_SCENE_EXAMPLE } from './homepage.js?v=59';

export const EXAMPLES = [TEASER_SCENE_EXAMPLE];
