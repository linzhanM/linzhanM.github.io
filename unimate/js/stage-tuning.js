// ─────────────────────────────────────────────────────────────────────────────
// Per-page stage tuning.
//
// The CATALOG is shared: examples.js decides the stages, their order and their
// rigs. What differs per page is PRESENTATION — the same stage can want a
// different pad, spacing, scale, lighting, floor or stageShift on the embedded
// project-page canvas than in the full-screen lab.
//
// Each map is keyed by stage label and holds stage-level options (vocabulary in
// the examples.js header); the entry module passes it through
// UNIMATE_VIEWER_CONFIG.stageTuning and viewer.js merges it over the shared
// stage before layout. Only stage-level options merge — the files and their
// per-file opts stay the catalog's, or the two pages drift apart in content.
//
// Put a stage here only when it needs a value the catalog does not give it: a
// restated catalog value pins nothing and reads as a difference that isn't.
// ─────────────────────────────────────────────────────────────────────────────

// The embedded viewer on the project page (unimate/index.html).
export const EMBED_TUNING = {
  // Both pages override the opening stage's pad, so the catalog's is the value
  // neither uses — change it here AND in interactive.js's
  // cameraPaddingByCategory, or only one page moves. This canvas is the smaller
  // and squarer, and wants the four rigs close enough to carry the frame the way
  // a single rig does; under ~1.0 EVE's arm touches the right edge.
  'Welcome': { pad: 1.06 },
  // Tighter row than the catalog's — the four read better shoulder to shoulder
  // — and a further camera, or the row clips both edges of this canvas. The lab
  // keeps the catalog's values.
  'Gundam Robot': { spacing: 0.85, pad: 1.1 },
  // The walk travels, and on this canvas needs more room than the catalog gives
  // it to end centred. The lab keeps the catalog's framing.
  'Locomotion': { pad: 2.2 },
};

// The full-screen motion lab (unimate/interactive.html).
export const LAB_TUNING = {
  // The lab's frame is wide, so the four greet in ONE row here: side by side
  // they read as one group facing the visitor, where in a frame this wide the
  // depth between the catalog's two ranks reads as two groups. singleRow
  // flattens them without forking the shared files, so the far squarer embedded
  // canvas keeps its ranks.
  //
  // rowOrder puts the two Unitree rigs on the flanks (G1 · WALL-E · EVE · Go2);
  // in catalog order they stand together and the row falls into a pair of
  // robots beside a pair of characters. Both it and fileOffsets key on the
  // CATALOG's file index, not a position in the row — reorder examples.js's
  // files and every number here means a different rig.
  //
  // fileOffsets then walks the flanks and the G1 toward the visitor: four rigs
  // on one rail read as a lineup, and breaking the rail makes them a group.
  //
  // pad is the lab's share of the framing, multiplied by
  // cameraPaddingByCategory['Welcome'] in interactive.js — a row framed on its
  // width alone needs far less margin than the two ranks did.
  'Welcome': {
    singleRow: true, rowOrder: [2, 0, 1, 3], spacing: 1.05, pad: 1.05,
    fileOffsets: { 2: [-0.2, 0, 0.2]},
  },
};
