// Standalone entry point for the full-screen UniMate motion lab. The catalog is
// the shared examples.js — same stages, same order on both pages. What differs
// is the VIEWER: everything below is lab-only presentation (fullscreen chrome,
// camera paddings, hover prompts, theme).
import { HIDDEN_CATEGORIES } from './viewer-presets.js?v=3';
import { LAB_TUNING } from './stage-tuning.js?v=12';

window.UNIMATE_VIEWER_CONFIG = {
  fullscreenLab: true,
  hiddenCategories: HIDDEN_CATEGORIES,
  stageTuning: LAB_TUNING,
  cameraPadding: 1.32,
  mobileCameraPadding: 0.96,
  cameraPaddingByCategory: {
    // Multiplies the stage's own pad in stage-tuning.js — together they are the
    // lab's framing. Wide enough that the flanks of that file's one-row Welcome
    // never reach the panel or the frame edge as their clips swing out.
    'Welcome': 1.37,
    'Bipedal': 1.5,
    'Articulated': 1.34,
    'Flower': 1.25,
    'Armored Robot': 1.55,
    'Gundam Robot': 1.58,
    'Quadrupedal': 1.40,
  },
  mobileCameraPaddingByCategory: {
    // A phone frames this row on its width alone; under 1.0 the two flanks sit
    // on the frame edges. Every entry here stays under its desktop counterpart.
    'Welcome': 1.02,
    'Bipedal': 1.08,
    'Articulated': 1.02,
    'Flower': 1.02,
    'Armored Robot': 1.16,
    'Gundam Robot': 1.08,
    'Quadrupedal': 1.03,
  },
  cameraElevation: 0.34,
  initialOrbitAngle: 5,
  mobileControlScaleMin: 0.54,
  hoverPrompts: true,
  playbackControls: true,
  autoOrbitControls: true,
};

await import('./viewer.js?v=165');

// Category-panel collapse — lab-only chrome, so it is wired here, not in the
// shared engine. The canvas never resizes: only the floating panel and its
// handle move, so camera and stage layout are untouched. The state is kept for
// the visit (sessionStorage) and restored via .is-instant, so a returning
// visitor's hidden panel is simply hidden rather than seen leaving.
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
