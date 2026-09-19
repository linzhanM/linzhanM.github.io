// Entry point for the Let Occ Flow lab (interactive.html). The street is
// scene.js, its surfaces mesh.js, the camera's rendering render2d.js;
// everything here is presentation. viewer.js reads this before it builds.
const embedded = document.documentElement.classList.contains('is-embed');

window.OCC_LAB_CONFIG = {
  // interactive.html?embed — a homepage thumbnail: the stage alone, the wheel
  // zooms about the fitted view, rendering only while on screen, the palette
  // read off the framing page (interactive.html's head).
  embedded,
  // Opening state of the dock.
  view: embedded ? 'occupancy' : 'flow',
  surface: 'mesh',
  arrows: false,
  history: false,
  sensor: true,
  // A chase camera, low behind the car as in Tesla's occupancy demos, aimed
  // `ahead` metres down the street. Its distance is fitted so `fitBox` clears
  // the insets: metres relative to the car, z along the street from just
  // behind it to far ahead, half-widths `near` and `far` at those two ends.
  // The thumbnail sits higher and takes in more of the street.
  fov: 40,
  elevation: 0.3,
  ahead: 12,
  fitBox: { z: [-3, 30], near: 5, far: 16, y: [0, 2] },
  embedElevation: 0.46,
  embedAhead: 12,
  embedFitBox: { z: [-4, 28], near: 7, far: 16, y: [0, 1] },
  // Fog, in metres past the camera's distance to its target.
  fogNear: 4,
  fogFar: 34,
  // Where the stage must stay clear, in CSS px: the lab's head and legend along
  // the top, its dock along the bottom; in a thumbnail a hair.
  frameInsets: { top: 110, right: 24, bottom: 84, left: 24 },
  embedInsets: { top: 4, right: 4, bottom: 4, left: 4 },
  // Framed, the loop alternates the paper's two predictions, one per pass.
  embedCycle: ['occupancy', 'flow'],
};

await import('./viewer.js?v=1');
