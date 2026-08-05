// ─────────────────────────────────────────────────────────────────────────────
// Per-page stage tuning.
//
// The CATALOG is shared: examples.js decides the stages, their order, and which
// rigs each one holds. What differs per page is PRESENTATION — the same stage
// can want a different pad, spacing, scale, lighting, floor or stageShift on
// the embedded project-page canvas than in the full-screen lab.
//
// Each map is keyed by stage label and holds stage-level options (the
// vocabulary is in the examples.js header). The entry module passes its map
// through UNIMATE_VIEWER_CONFIG.stageTuning and viewer.js merges it over the
// shared stage before layout. Only stage-level options merge — the files and
// their per-file opts always stay the catalog's, or the two pages would
// silently drift apart in content.
//
// Put a stage here only when it needs a value the catalog does not give it.
// Restating a catalog value pins nothing and reads as a difference that isn't.
// ─────────────────────────────────────────────────────────────────────────────

// The embedded viewer on the project page (unimate/index.html).
export const EMBED_TUNING = {
  // The opening stage. Both pages override its pad, so the catalog's 1.2 is
  // the value neither one uses — change the pad here and in interactive.js's
  // cameraPaddingByCategory, or only one page moves. This canvas is the
  // smaller and squarer of the two, and at the catalog's framing the diorama
  // sat adrift in the middle of it; closer, the four rigs carry the frame the
  // way a single-rig stage does. Under ~1.0 EVE's arm touches the right edge.
  'Welcome': { pad: 1.06 },
  // Tighter row than the catalog's 1.0 — the four read better shoulder to
  // shoulder — and a further camera, because at the catalog's 0.9 the row
  // clipped both edges of this canvas. The lab keeps the catalog's values.
  'Gundam Robot': { spacing: 0.85, pad: 1.1 },
  // A step past the catalog's 1.8: the walk travels, and on this canvas it
  // needs more room to end centred. The lab keeps the catalog's framing.
  'Locomotion': { pad: 2.2 },
};

// The full-screen motion lab (unimate/interactive.html).
export const LAB_TUNING = {
  // The lab's frame is wide, so the four greet in ONE row here rather than the
  // catalog's two ranks — side by side they read as one group facing the
  // visitor, where in a frame this wide the depth between ranks read as two.
  // The catalog keeps the ranks for the embedded canvas, which is far squarer;
  // singleRow flattens them without forking the shared files.
  //
  // rowOrder then puts the two Unitree rigs on the flanks (G1 · WALL-E · EVE ·
  // Go2): left in catalog order the two of them stand together and the row
  // falls into a pair of robots and a pair of characters. Both maps below key
  // on the CATALOG's file index, not on a position in rowOrder — 2 is the G1
  // and 3 the Go2, wherever the row puts them. Reorder examples.js's files and
  // every number here means a different rig.
  //
  // fileOffsets then walks the two flanks toward the visitor, and the G1 left
  // as well: four rigs on one rail read as a lineup, and breaking the rail is
  // what makes them a group.
  //
  // pad is the lab's share of the framing, multiplied by
  // cameraPaddingByCategory['Welcome'] in interactive.js: a row of four is
  // framed on its width, so it takes far less than the two ranks did and still
  // leaves the flanks clear of the category panel and the frame edge.
  'Welcome': {
    singleRow: true, rowOrder: [2, 0, 1, 3], spacing: 1.05, pad: 1.05,
    fileOffsets: { 2: [-0.2, 0, 0.2]},
  },
};
