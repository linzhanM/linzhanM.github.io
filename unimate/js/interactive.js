// Standalone entry point for the full-screen UniMate motion lab.
// Interactive-only catalog and camera settings live here so the project-page
// viewer remains identical to the original embedded experience.
import { prepareInteractiveCatalog } from './catalog-runtime.js';
import { HIDDEN_CATEGORIES } from './viewer-presets.js';

const { EXAMPLES } = await import('./examples.js?v=48');
const interactiveCatalog = EXAMPLES.map((example) => ({
  ...example,
  files: [...example.files],
}));
window.UNIMATE_VIEWER_CATALOG = prepareInteractiveCatalog(interactiveCatalog);

window.UNIMATE_VIEWER_CONFIG = {
  fullscreenLab: true,
  hiddenCategories: HIDDEN_CATEGORIES,
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

await import('./viewer.js?v=110');
