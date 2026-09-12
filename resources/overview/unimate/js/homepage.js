// The root homepage's UniMate thumbnail: index.html frames
// interactive.html?embed#teaser-scene, and this is its one stage. It is not one
// of unimate/'s examples: it lives only in this copy of the lab, whose catalog
// (examples.js) is this stage alone. An earlier Homepage stage (Tabletop's three
// in front of the Locomotion walkers) was the thumbnail until 2026-09-12 and was
// removed with its rigs at the owner's request.
//
// The paper teaser's bottom two rows as a stage (owner's request, 2026-09-12): in
// front the satellite, Spot with its arm and the flower; behind them Baymax, the
// Go2 rearing up, the G1 picking up and the mixamo kick, left to right as in the
// teaser. It frames on its own `pad` at every width (interactive.js).
//
// Each rig faces as it does in the teaser: `rotate` is render_teaser_unimate.py's
// rot_z (Blender's Z is three.js's Y, same sign), and `scale` its target height
// relative to the satellite's 1.8, both measured on the tallest frame as this
// engine normalizes.
//
// The rigs in resources/glbs/ are the paper teaser's own assets
// (Paper/SIGA-2026/teaser_assets), copied uncompressed at the owner's request
// (2026-09-12): ~107 MB, ~46 MB gzipped, where compressed builds were ~10 MB
// and ~7 MB.
export const TEASER_SCENE_EXAMPLE = {
  label: 'Teaser Scene',
  files: [
    // groundFrame as the Articulated stage sets the satellite: its legs extend
    // over the clip, so it grounds on the last frame. Its material is a half
    // metal: this engine has had a studio environment to reflect since
    // 2026-09-12 (viewer.js buildEnvironment), so the dish reads as brushed
    // metal, where the matte 0.55 / 0.15 it wore before was flat. That stage's
    // 0.3 / 0.7 went darker than the thumbnail wants.
    // The satellite a little back and the flower a little forward (offset z), so
    // both line up in depth with Spot's middle, the satellite a touch left, and
    // the whole row 1.15× its teaser ratios, at the owner's request.
    { url: 'resources/glbs/radar-extend.glb', material: { roughness: 0.4, metalness: 0.5 }, rotate: [0, 70, 0], groundFrame: 1, groundToMesh: true, scale: 1.15, offset: [-0.2, 0, -0.2] },
    { url: 'resources/glbs/quadruped_spot_arm-step_reach.glb', groundToMesh: true, rotate: [0, -60, 0], scale: 1.15, offset: [0.05, 0, 0.] },
    { url: 'resources/glbs/flower-close.glb', groundToMesh: true, rotate: [0, 25, 0], scale: 0.95, offset: [0.1, 0, 0.2] },
    // Row 1: the teaser's second row at about 1.4× its teaser height ratios: at
    // the teaser's own ratios this camera, lower than the teaser's, left the back
    // row small behind the front, and 1.9 back it needs the size to hold its own.
    // The mixamo rig takes the catalog's mixamo material, which renders dark and
    // matte without it, at half the catalog's emissive lift (0.25, not 0.5): with
    // the environment the rig has reflections to brighten it, and the full lift
    // washed its yellows toward white.
    // Baymax a size up on the rest of its row and a little left, at the owner's
    // request (offset −0.15: at −0.3 its punch reached the frame's left edge).
    // The Go2, the G1 and the mixamo rig shifted right (offset x 0.1, 0.25 and
    // 0.6), the mixamo rig also a little forward, and it turned 20° toward the
    // camera from the teaser's rot_z 0, where it stood three-quarters away. All
    // at the owner's request, as are Spot's and the flower's x offsets.
    { url: 'resources/glbs/baymax-punch.glb', row: 1, rotate: [0, 90, 0], scale: 1.4, offset: [-0.15, 0, 0] },
    { url: 'resources/glbs/go2-rear_up.glb', row: 1, groundToMesh: true, rotate: [0, -65, 0], scale: 1.65, offset: [0.1, 0, 0] },
    { url: 'resources/glbs/g1-pick_up.glb', row: 1, groundToMesh: true, rotate: [0, 35, 0], scale: 1.95, offset: [0.25, 0, 0] },
    { url: 'resources/glbs/mixamo-high_kick.glb', row: 1, material: { roughness: 0.8, emissiveIntensity: 0.25 }, rotate: [0, -20, 0], scale: 1.6, offset: [0.6, 0, 0.1] },
  ],
  // frameEnvelope: Spot walks and reaches down past its opening pose late in
  // the clip, which a camera fitted at t = 0 cropped. The rigs fill most of the
  // thumbnail from the embed's raised camera (interactive.js) and clear every
  // edge over the whole loop, at the owner's request. Rows 1.9 apart: the back
  // row went back from 1.6 into the band of fading floor that hung over it.
  // The front row 1.05 across and the back row's four edge to edge
  // (rowSpacing; 1.1 across left the stage too wide to zoom in on), with pad
  // 0.765. The extremes come at different moments of the loop, so judge a
  // change over all of it, not a few frames: the G1's head at the top as it
  // opens, Spot's reach and the closing flower at the bottom and the kick on
  // the right late in their clips, Baymax's punch on the left. Pad 0.665 looked
  // clear on a few frames and cropped those poses. The frame's height binds
  // the camera, so a taller back row pulls it out (the G1 at 2.05 shrank the
  // whole stage). stageShift slides the group back 0.75, which lifts the front
  // row off the bottom edge, and 0.04 left, away from the kick's edge.
  // Earlier, 1.4 apart read as crowded and 1.2 put Spot on the G1's legs.
  // Both rows keep the teaser's order: the satellite
  // under Baymax, Spot under the Go2 and G1, the flower under the kick. Tuned
  // on the thumbnail at 255x143 on 2026-09-12.
  spacing: 1.05, rowSpacing: [1.05, 1.0], rowDepth: 1.9, pad: 0.765, stageShift: [-0.04, 0, -0.75], evenGaps: true, frameEnvelope: true,
};
