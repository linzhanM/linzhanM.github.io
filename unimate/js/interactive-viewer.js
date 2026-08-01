// Standalone entry point for the full-screen UniMate motion lab.
// Page-specific viewer settings belong here so interactive.html can evolve
// independently from the viewer embedded in the main project page.
window.UNIMATE_VIEWER_CONFIG = {
  fullscreenLab: true,
  cameraPadding: 1.45,
  cameraPaddingByCategory: {
    'Bipedal': 1.45,
    'Articulated': 1.45,
    'Flower': 1.45,
    'Zoo': 1.45,
    'Humanoid Robot': 1.45,
    'Quadruped Robot': 1.45,
    'Baymax Robot': 1.45,
    'Eagle': 1.45,
    'Shark': 1.45,
    'Michelle': 1.45,
  },
  cameraElevation: 0.34,
  horizontalSafeArea: 0.09,
  hoverPrompts: true,
  playbackControls: true,
  autoOrbitControls: true,
};

await import('./viewer.js?v=46');
