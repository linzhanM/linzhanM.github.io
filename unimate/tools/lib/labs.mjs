// The pages this tool can render, and how each is driven. The lab is always
// the renderer; an adapter only says where its stage list, load state and
// stage switch live, as expressions evaluated in the page. Three pages today:
// UniMate's own lab, and the two homepage thumbnails under resources/overview/
// (each a lab opened ?embed, framed by the root index.html).

import { LAB_PATH } from './paths.mjs';

// CSS px of the homepage thumbnails at desktop width (255x143). DIMO's embed
// insets are pixels (interactive.js embedInsets), so a render taller than the
// thumbnail scales them, or its bodies fill more of the frame than they do live.
const THUMBNAIL_HEIGHT = 143;

const unimate = {
  path: LAB_PATH,
  configGlobal: 'UNIMATE_VIEWER_CONFIG',
  ready: 'document.querySelectorAll("#example-sidebar button").length > 0',
  // {label, index}; the slug is slugify(label), as the page's own hash is.
  stages: '[...document.querySelectorAll("#example-sidebar .example-name")].map((el, index) => ({ label: el.textContent, index }))',
  loaded: `(() => {
    const overlay = document.getElementById('loading-overlay');
    const canvas = document.querySelector('#viewer-wrapper canvas');
    return !!canvas && !!overlay && getComputedStyle(overlay).display === 'none';
  })()`,
  themeToggle: '[data-theme-toggle]',
  chrome: '.category-panel,.panel-toggle,.control-bar,.control-dock,.drop-note,#drop-hint,#loading-overlay',
  reopen: (index) => `document.querySelectorAll('#example-sidebar button')[${index}].click()`,
  // The INLINE style, not the computed one: hideChrome put `display: none
  // !important` on the overlay, so computed reads "hidden" from the first
  // poll. loadStage writes 'flex' then 'none' on the element itself.
  reopened: `document.getElementById('loading-overlay').style.display === 'none'`,
  config: () => ({}),
  seconds: null,   // read off the rigs (clip.mjs)
};

export const LABS = {
  unimate,

  // The homepage's UniMate thumbnail. The page frames its one stage on
  // fractions (its own `pad`), so it frames alike at any size; only the pixel
  // ratio is raised, so the skeleton hairlines keep their weight (viewer.js
  // maxPixelRatio, which the lab caps at 2 on its own).
  'homepage-unimate': {
    ...unimate,
    path: '/resources/overview/unimate/interactive.html?embed',
    config: (opts) => ({ maxPixelRatio: opts.scale }),
  },

  // The homepage's DIMO thumbnail: the ducks then the UR5e arms, in turn
  // (interactive.js embedCycle). Reduced motion is emulated because the fade
  // between them is a CSS transition on the real clock: under the virtual
  // clock it would be a run of blank frames, where the cut it takes instead
  // can be faded in post (see unimate/README.md).
  'homepage-dimo': {
    path: '/resources/overview/dimo/interactive.html?embed',
    configGlobal: 'DIMO_LAB_CONFIG',
    ready: '!!window.dimoLab && window.dimoLab.stage.ready',
    // Only the objects the embed built (the ones it cycles through); `index`
    // is the catalog index showObject takes.
    stages: 'window.dimoLab.stage.objects.filter(Boolean).map((o) => ({ label: o.spec.label, slug: o.spec.slug, index: o.index }))',
    loaded: '!!window.dimoLab && window.dimoLab.stage.ready && !document.getElementById("viewer-wrapper").classList.contains("is-loading")',
    themeToggle: '#theme-toggle',
    chrome: '',   // ?embed already hides every piece of it
    reopen: (index) => `window.dimoLab.showObject(${index}, { force: true })`,
    reopened: 'true',   // synchronous: the objects are built, the switch only relayouts
    reducedMotion: true,
    config: (opts) => {
      const k = opts.height / THUMBNAIL_HEIGHT;
      return {
        maxPixelRatio: opts.scale,
        embedInsets: { top: 6 * k, right: 8 * k, bottom: 6 * k, left: 8 * k },
      };
    },
    // One pass of the whole cycle: each built object for its `loops` periods.
    seconds: `(() => {
      const c = window.DIMO_LAB_CONFIG || {};
      const loops = (c.embedCycle && c.embedCycle.loops) || 1;
      return window.dimoLab.stage.objects.filter(Boolean).reduce((s, o) => s + loops * o.cycle, 0);
    })()`,
  },
};

export const LAB_NAMES = Object.keys(LABS);
