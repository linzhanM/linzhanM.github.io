// Entry point for the DIMO Motion Lab (interactive.html). The catalog is
// examples.js; everything here is presentation. viewer.js reads this
// before it builds the scene.
window.DIMO_LAB_CONFIG = {
  // interactive.html?embed — the root homepage frames the lab as DIMO's
  // thumbnail. The chrome is hidden by interactive.css; the engine drops zoom,
  // keys and the selection ring, keeps its palette off localStorage, takes the
  // homepage's palette on its plate (light or dark), and renders only while
  // the frame is on screen.
  embedded: document.documentElement.classList.contains('is-embed'),
  // Where the framed stage must stay clear, in CSS px (viewer.js frameCamera):
  // the lab's head and facts along the top and its dock along the bottom; in
  // the homepage thumbnail only a hair, so the bodies fill it.
  frameInsets: { top: 76, right: 28, bottom: 88, left: 28 },
  embedInsets: { top: 6, right: 8, bottom: 6, left: 8 },
  // The homepage thumbnail plays the robot ducks, then the UR5e arms, and
  // round again: two periods each (6 s a scene), cut at the loop. Ignored in
  // the lab, which shows what the visitor picks.
  embedCycle: { slugs: ['microduck', 'ur5e'], loops: 2 },
  // The thumbnail holds the view it was fitted for — an orbit would swing the
  // bodies out of it. Drag still orbits there.
  autoOrbit: !document.documentElement.classList.contains('is-embed'),
  // The homepage thumbnail looks straight at the stage; the lab keeps each
  // object's own three-quarter azimuth (examples.js).
  cameraAzimuth: document.documentElement.classList.contains('is-embed') ? 0 : undefined,
  // OrbitControls units: one is 6°/s. 4°/s keeps a row of bodies readable
  // from one side for a few cycles.
  orbitSpeed: 4 / 6,
  // Opening state of the dock: surface representation and overlays.
  surface: 'mesh',
  keypoints: false,
  trajectories: true,
  // Key points drawn with trajectories (a prefix of the FPS order, so they
  // are spread over the body), phases sampled per period, and how many of
  // those samples trail behind the live point.
  trailCount: 64,
  trailSamples: 48,
  trailFrames: 14,
};

await import('./viewer.js?v=13');
