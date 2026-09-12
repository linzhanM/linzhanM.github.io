// Entry point for the homepage's UniMate thumbnail: unimate/'s motion lab,
// copied here for index.html's frame alone. Its catalog is the one stage in
// examples.js; everything below is lab presentation (fullscreen chrome, camera
// paddings, hover prompts, theme).
const embedded = document.documentElement.classList.contains('is-embed');

window.UNIMATE_VIEWER_CONFIG = {
  fullscreenLab: true,
  // interactive.html?embed — the root homepage frames the lab as its UniMate
  // thumbnail. The chrome is hidden by interactive.css; the engine drops zoom,
  // pan and the dock keys (the wheel then scrolls the page the frame sits in)
  // and renders only while the frame is on screen.
  embedded,
  cameraPadding: 1.32,
  mobileCameraPadding: 0.96,
  // The stage frames on its own `pad` (homepage.js) at every width: the frame
  // is phone-sized on a desktop and wider on a phone, and one framing has to
  // hold at both, so this entry and its mobile twin are 1.
  cameraPaddingByCategory: { 'Teaser Scene': 1 },
  mobileCameraPaddingByCategory: { 'Teaser Scene': 1 },
  // The homepage thumbnail looks straight at its stage from well above, so the
  // Teaser Scene's two rows spread down the frame instead of leaving sky over
  // them (0.42, tuned for an earlier stage's lanes, left a band of it); the
  // lab opens at a slight angle.
  cameraElevation: embedded ? 0.62 : 0.34,
  initialOrbitAngle: embedded ? 0 : 5,
  hoverPrompts: true,
  // The Text Prompts switch pins every chip over its rig; on from arrival, so
  // the stage names what each rig is doing before anyone finds the switch.
  pinPrompts: true,
  playbackControls: true,
  // The homepage thumbnail holds still: a slow orbit swings each rig of its row
  // past the frame edge in turn, and the rigs' own motion keeps it alive.
  autoOrbitControls: !embedded,
};

await import('./viewer.js?v=260');

// Category-panel collapse — lab-only chrome, so wired here, not in the shared
// engine. The canvas never resizes: only the floating panel and its handle
// move, so camera and layout are untouched. The state lasts the visit
// (sessionStorage) and is restored under .is-instant, so a returning visitor's
// hidden panel is simply hidden rather than seen leaving.
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
