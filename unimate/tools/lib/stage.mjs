// Driving the lab: open it, pick a category, and get the page into the state
// the capture expects. Where a real control exists (theme, stage) the tool
// clicks it rather than reaching into the viewer. Which page, and where its
// controls are, is the `lab` adapter (labs.mjs).

import { REPO_ROOT } from './paths.mjs';
import { fail, slugify } from './util.mjs';

// A stage's slug: the page's own where it has one (DIMO's catalog), else the
// label slugified as the UniMate lab's hash is.
export const stageSlug = (stage) => stage.slug || slugify(stage.label);

// Returns the stages the page currently shows, {label, slug?, index} — also
// what --list prints.
export async function openLab(page, origin, slug, lab) {
  const url = `${origin}${lab.path}${slug ? '#' + slug : ''}`;
  process.stderr.write(`serving ${REPO_ROOT}\nopening ${url}\n`);
  await page.send('Page.navigate', { url });
  await page.waitFor('document.readyState === "complete"', 60_000, 'the page to load');
  await page.waitFor(lab.ready, 180_000, 'the stage list');
  return page.eval(lab.stages);
}

// The lab resolves an unknown hash to the first stage without a word, which
// would render the wrong category silently.
export function resolveStage(stages, opts, slug) {
  const match = stages.find((stage) => stageSlug(stage) === slug);
  if (!match) {
    fail(`no category "${opts.category}". The lab currently shows:\n${stages.map((s) => `  ${s.label} (${stageSlug(s)})`).join('\n')}`);
  }
  return match;
}

export function useLightTheme(page, lab) {
  return page.eval(`(() => {
    const t = document.querySelector(${JSON.stringify(lab.themeToggle)});
    if (t && document.documentElement.dataset.theme !== 'light') t.click();
  })()`);
}

export function waitForStageLoaded(page, lab) {
  return page.waitFor(lab.loaded, 180_000, 'the stage to finish loading');
}

// Repaints only what is BEHIND the stage; floor, lights and skeleton stay on
// the theme. Returned as a function because it runs twice: the stage reload on
// the virtual clock must not repaint over it.
export function backgroundPainter(page, opts, alpha) {
  return async function applyBackground() {
    if (!opts.background) return;
    const css = alpha ? null : opts.background;
    const painted = await page.eval(`window.__labCapture.setBackground(${JSON.stringify(css)})`);
    if (painted === 0) fail('could not reach the scene to set --background (no scene was observed)');
    if (painted < 0) fail(`could not read a colour from "${opts.background}" — is it a valid CSS colour?`);
    // The canvas is not the only thing painting: `body` carries a gradient and
    // `.viewer-wrapper` its own `--stage` fill, so a style on body alone leaves
    // the wrapper opaque under a cleared canvas.
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

// Chrome composites the page over opaque white unless told not to, which
// would fill the alpha the canvas just cleared.
export function clearDefaultBackground(page) {
  return page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
}

// Call AFTER waitForStageLoaded, which reads the loading overlay this hides.
export function hideChrome(page, lab) {
  if (!lab.chrome) return;
  return page.eval(`(() => {
    const style = document.createElement('style');
    style.textContent = ${JSON.stringify(lab.chrome)} + '{display:none !important}';
    document.head.appendChild(style);
  })()`);
}

export async function beginVirtualClock(page) {
  await page.eval('window.__labCapture.begin()');
  // The render loop joins the virtual queue one real frame after the flip;
  // stepping before that burns frames on an empty queue.
  await page.waitFor('window.__labCapture.pending() > 0', 10_000, 'the render loop to join the virtual clock');
}

// Frame 0 must be the stage as the lab first shows it: opening orbit angle,
// every motion at t=0. Nothing rewinds a running mixer, so the stage is loaded
// again now that the clock is virtual. Loading runs on fetch and promises, not
// frames, so it completes while time is frozen — no mixer advances and the
// camera does not orbit between the fit and the first captured frame.
export async function reloadStageOnVirtualClock(page, stage, lab) {
  await page.eval(lab.reopen(stage.index));
  await page.waitFor(lab.reopened, 180_000, 'the stage to reload on the virtual clock');
}
