// Standalone entry point for the full-screen UniMate motion lab.
// Interactive-only catalog and camera settings live here so the project-page
// viewer remains identical to the original embedded experience.
const { EXAMPLES } = await import('../../js/examples.js?v=46');
const humanoidRobotIndex = EXAMPLES.findIndex(({ label }) => label === 'Humanoid Robot');
if (humanoidRobotIndex >= 0) {
  const combined = EXAMPLES[humanoidRobotIndex];
  const gundam = {
    label: 'Gundam Robot',
    files: combined.files.slice(0, 4).map((file) => ({ ...file, scale: 1.0 })),
    spacing: 1.0,
    pad: 0.9,
  };
  const humanoid = {
    label: 'Humanoid Robot',
    files: combined.files.slice(4).map(({ row, ...file }) => file),
    spacing: 1.1,
    pad: 1.1,
  };
  EXAMPLES.splice(humanoidRobotIndex, 1, humanoid, gundam);

  const quadrupedIndex = EXAMPLES.findIndex(({ label }) => label === 'Quadruped Robot');
  if (quadrupedIndex >= 0) {
    const [quadruped] = EXAMPLES.splice(quadrupedIndex, 1);
    EXAMPLES.splice(humanoidRobotIndex, 0, quadruped);
  }
}

window.UNIMATE_VIEWER_CONFIG = {
  fullscreenLab: true,
  hiddenCategories: ['Showcase'],
  cameraPadding: 1.32,
  mobileCameraPadding: 0.96,
  cameraPaddingByCategory: {
    'Bipedal': 1.5,
    'Articulated': 1.25,
    'Flower': 1.25,
    'Humanoid Robot': 1.55,
    'Gundam Robot': 1.48,
    'Quadruped Robot': 1.40,
  },
  mobileCameraPaddingByCategory: {
    'Bipedal': 1.08,
    'Articulated': 1.02,
    'Flower': 1.02,
    'Humanoid Robot': 1.16,
    'Gundam Robot': 1.08,
    'Quadruped Robot': 1.03,
  },
  cameraElevation: 0.34,
  initialOrbitAngle: 5,
  horizontalSafeArea: 0.09,
  mobileHorizontalSafeArea: 0.055,
  mobileControlScaleMin: 0.54,
  hoverPrompts: true,
  playbackControls: true,
  autoOrbitControls: true,
};

await import('../../js/viewer.js?v=106');
