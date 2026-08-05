// ─────────────────────────────────────────────────────────────────────────────
// Per-page stage tuning.
//
// The CATALOG is shared and identical on both pages — examples.js decides the
// stages, their order, and which rigs each one holds. What may differ per page
// is PRESENTATION: the same stage can want a different camera pad, spacing,
// scale, lighting, floor or stageShift on the embedded project-page canvas
// than in the full-screen motion lab.
//
// Each map is keyed by stage label and holds stage-level options (see the
// per-example vocabulary in the header of examples.js). The entry module
// passes its map through UNIMATE_VIEWER_CONFIG.stageTuning, and viewer.js
// merges it over the shared stage before layout. Only stage-level options
// merge here — the files (and their per-file opts) always stay the catalog's,
// or the two pages would silently drift apart in content.
// ─────────────────────────────────────────────────────────────────────────────

// The embedded viewer on the project page (unimate/index.html).
export const EMBED_TUNING = {
  // The opening stage, and the embedded canvas is the smaller of the two: the
  // catalog's 1.35 is the air the lab's wide frame wants, and here it left the
  // diorama adrift in the middle of the canvas. Closer, so the four rigs carry
  // the frame the way a single-rig stage does.
  'Welcome': { pad: 1.06 },
  // Tighter row than the shared 1.0 (the four read better shoulder to
  // shoulder) and a further camera — at the catalog's 0.9 the row clipped
  // both edges of the embedded canvas. The lab keeps the catalog's values.
  'Gundam Robot': { spacing: 0.85, pad: 1.1 },
  // A step past the shared 1.6 — on the embedded canvas the walk needs a bit
  // more air; the lab keeps the catalog's framing.
  'Locomotion': { pad: 2.2 },
};

// The full-screen motion lab (unimate/interactive.html).
export const LAB_TUNING = {
  "Welcome": { rowDepth: 1.6, pad: 1.25 },
};
