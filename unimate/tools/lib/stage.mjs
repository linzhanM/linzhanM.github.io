// Driving the lab: open it, pick a category, and get the page into the state
// the capture expects. Every step here is something a visitor could do — the
// tool clicks the real controls rather than reaching into the viewer.

import { LAB_PATH, REPO_ROOT } from './paths.mjs';
import { fail, slugify } from './util.mjs';

// Returns the category labels the lab currently shows, which is also all
// --list needs.
export async function openLab(page, origin, slug) {
  const url = `${origin}${LAB_PATH}${slug ? '#' + slug : ''}`;
  process.stderr.write(`serving ${REPO_ROOT}\nopening ${url}\n`);
  await page.send('Page.navigate', { url });
  await page.waitFor('document.readyState === "complete"', 60_000, 'the page to load');
  await page.waitFor('document.querySelectorAll("#example-sidebar button").length > 0', 60_000, 'the category list');
  return page.eval('[...document.querySelectorAll("#example-sidebar .example-name")].map((el) => el.textContent)');
}

// The hash resolves by slug, and an unknown one silently falls back to the
// first stage — which would render the wrong category without a word.
export function resolveStage(stages, opts, slug) {
  const match = stages.find((label) => slugify(label) === slug);
  if (!match) {
    fail(`no category "${opts.category}". The lab currently shows:\n${stages.map((l) => `  ${l} (${slugify(l)})`).join('\n')}`);
  }
  return match;
}

export function useLightTheme(page) {
  return page.eval(`(() => {
    const t = document.querySelector('[data-theme-toggle]');
    if (t && document.documentElement.dataset.theme !== 'light') t.click();
  })()`);
}

export function waitForStageLoaded(page) {
  return page.waitFor(`(() => {
    const overlay = document.getElementById('loading-overlay');
    const canvas = document.querySelector('#viewer-wrapper canvas');
    return !!canvas && !!overlay && getComputedStyle(overlay).display === 'none';
  })()`, 180_000, 'the stage to finish loading');
}

// Repaints only what is BEHIND the stage: the floor, lights and skeleton stay on
// the theme. Returned as a function because it runs twice — the stage reload on
// the virtual clock must not repaint over it.
export function backgroundPainter(page, opts, alpha) {
  return async function applyBackground() {
    if (!opts.background) return;
    const css = alpha ? null : opts.background;
    const painted = await page.eval(`window.__labCapture.setBackground(${JSON.stringify(css)})`);
    if (painted === 0) fail('could not reach the scene to set --background (no scene was observed)');
    if (painted < 0) fail(`could not read a colour from "${opts.background}" — is it a valid CSS colour?`);
    // The canvas is not the only thing painting: `body` carries a gradient and
    // `.viewer-wrapper` its own `--stage` fill, so an inline style on body
    // leaves the wrapper opaque underneath a cleared canvas.
    const pageBackground = alpha ? 'transparent' : opts.background;
    await page.eval(`(() => {
      const id = 'lab-capture-background';
      const style = document.getElementById(id) || document.createElement('style');
      style.id = id;
      style.textContent = 'html,body,.lab-shell,.viewer-panel,.viewer-layout,.viewer-wrapper'
        + '{background: ' + ${JSON.stringify(pageBackground)} + ' !important}';
      document.head.appendChild(style);
    })()`);
  };
}

// Chrome composites the page over its own opaque white unless told not to,
// which would fill the alpha the canvas just cleared.
export function clearDefaultBackground(page) {
  return page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
}

// Call AFTER waitForStageLoaded, which reads the loading overlay.
export function hideChrome(page) {
  return page.eval(`(() => {
    const style = document.createElement('style');
    style.textContent = '.category-panel,.panel-toggle,.control-bar,.control-dock,.drop-note,#drop-hint,#loading-overlay{display:none !important}';
    document.head.appendChild(style);
  })()`);
}

export async function beginVirtualClock(page) {
  await page.eval('window.__labCapture.begin()');
  // The render loop hands itself over one real frame after the clock flips;
  // stepping before that lands on an empty queue and burns frames.
  await page.waitFor('window.__labCapture.pending() > 0', 10_000, 'the render loop to join the virtual clock');
}

// Frame 0 is the stage as the lab first shows it — opening orbit angle, every
// motion at t=0 — and the way to get there is to load it again now that the
// clock is virtual. Loading runs on fetch and promises, not on frames, so it
// completes while time is frozen: no mixer advances and the camera does not
// orbit between the fit and the first captured frame. (Resetting in place
// cannot do this — nothing rewinds a running mixer.)
export async function reloadStageOnVirtualClock(page, stageIndex) {
  await page.eval(`document.querySelectorAll('#example-sidebar button')[${stageIndex}].click()`);
  // The INLINE style, not the computed one: hiding the chrome put a
  // `display: none !important` on the overlay, so computed says "hidden" from
  // the first poll. loadStage writes 'flex' then 'none' on the element itself.
  await page.waitFor(`document.getElementById('loading-overlay').style.display === 'none'`,
    180_000, 'the stage to reload on the virtual clock');
}
