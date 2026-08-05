// Standalone entry point for the full-screen UniMate motion lab.
// The catalog is the shared examples.js — both pages show the same stages in
// the same order. What differs is the VIEWER: everything below is lab-only
// presentation (fullscreen chrome, camera paddings, hover prompts, theme).
import { HIDDEN_CATEGORIES } from './viewer-presets.js?v=3';
import { LAB_TUNING } from './stage-tuning.js?v=8';

window.UNIMATE_VIEWER_CONFIG = {
  fullscreenLab: true,
  hiddenCategories: HIDDEN_CATEGORIES,
  stageTuning: LAB_TUNING,
  cameraPadding: 1.32,
  mobileCameraPadding: 0.96,
  cameraPaddingByCategory: {
    // The only two-rank stage, and the rank nearest the camera is what the
    // shared fit reads: at the default the front pair loomed and sat on the
    // bottom edge with no floor under it. The catalog's own pad frames it on
    // the embedded canvas, which is far squarer — this is the lab's share.
    'Welcome': 1.28,
    'Bipedal': 1.5,
    'Articulated': 1.25,
    'Flower': 1.25,
    'Armored Robot': 1.55,
    'Gundam Robot': 1.48,
    'Quadrupedal': 1.40,
  },
  mobileCameraPaddingByCategory: {
    'Welcome': 0.93,
    'Bipedal': 1.08,
    'Articulated': 1.02,
    'Flower': 1.02,
    'Armored Robot': 1.16,
    'Gundam Robot': 1.08,
    'Quadrupedal': 1.03,
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

await import('./viewer.js?v=155');

// Category-panel collapse — lab-only chrome, so it is wired here rather than
// in the shared engine. The canvas never resizes: only the floating panel and
// its handle move, so the camera and stage layout are untouched. The state is
// remembered for the visit (sessionStorage, like the site nav's keypoint) and
// restored without the slide via .is-instant, so a returning visitor's hidden
// panel is simply hidden rather than seen leaving.
{
  const panel = document.getElementById('category-panel');
  const toggle = document.querySelector('.panel-toggle');
  const KEY = 'lab-categories-hidden';

  if (panel && toggle) {
    const setHidden = (hidden) => {
      panel.classList.toggle('is-collapsed', hidden);
      toggle.classList.toggle('is-collapsed', hidden);
      toggle.setAttribute('aria-expanded', String(!hidden));
      toggle.setAttribute('aria-label', hidden ? 'Show categories' : 'Hide categories');
      try { sessionStorage.setItem(KEY, hidden ? '1' : ''); } catch (e) { /* private mode */ }
    };

    toggle.addEventListener('click', () => {
      setHidden(!panel.classList.contains('is-collapsed'));
    });

    let hiddenAtLoad = false;
    try { hiddenAtLoad = sessionStorage.getItem(KEY) === '1'; } catch (e) { /* private mode */ }
    if (hiddenAtLoad) {
      panel.classList.add('is-instant');
      toggle.classList.add('is-instant');
      setHidden(true);
      void panel.offsetWidth;   // commit the jump before transitions return
      panel.classList.remove('is-instant');
      toggle.classList.remove('is-instant');
    }
  }
}
