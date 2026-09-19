// Run-time edits to the lab's config for render-lab-video.mjs, made in the
// page once the stage is on screen and before it is reloaded on the virtual
// clock. They work because viewer.js re-reads the config global at every
// stage open — stageTuning, cameraPaddingByCategory / cameraPadding and
// initialOrbitAngle are all read in loadStage / frameStage — so a value
// written now is what the capture's reload frames on.

// The lab's own auto-orbit rate, 8°/s (unimate/README.md, "orbit speed").
export const ORBIT_DEG_PER_SEC = 8;

// The rate: explicit, or whatever carries the camera through --orbit-arc in
// exactly this clip. Takes effect through the OrbitControls patch (patches.mjs).
export async function setOrbitRate(page, mine, seconds) {
  let speed = mine.speed ?? ORBIT_DEG_PER_SEC;
  if (mine.arc !== null) speed = mine.arc / seconds;
  if (speed !== ORBIT_DEG_PER_SEC) await page.eval(`window.__LAB_ORBIT_MULT = ${speed / ORBIT_DEG_PER_SEC}`);
  return speed;
}

// Layout for this render only, merged over this category's stageTuning entry.
export async function applyStageOpts(page, lab, label, stageOpts) {
  await page.eval(`(() => {
    const c = window.${lab.configGlobal};
    const label = ${JSON.stringify(label)};
    c.stageTuning = c.stageTuning || {};
    c.stageTuning[label] = Object.assign({}, c.stageTuning[label], ${JSON.stringify(stageOpts)});
  })()`);
  process.stderr.write(`stage opts ${JSON.stringify(stageOpts)}\n`);
}

// Framing. A category with its own entry in cameraPaddingByCategory (Welcome's
// 1.37) REPLACES the global padding (viewer.js: opts.cameraPadding ??
// viewerConfig.cameraPadding), so --zoom — which the bootstrap divides into
// the global only — never reached it. This scales the category's entry too,
// and --pad replaces whichever applies before the zoom divides it.
export async function applyPadding(page, lab, label, opts, mine) {
  const padded = await page.eval(`(() => {
    const c = window.${lab.configGlobal};
    const byCat = c.cameraPaddingByCategory || {};
    const label = ${JSON.stringify(label)};
    if (byCat[label] != null) {
      byCat[label] = (${mine.pad !== null ? mine.pad : 'byCat[label]'}) / ${opts.zoom};
      return byCat[label];
    }
    ${mine.pad !== null ? `c.cameraPadding = ${mine.pad} / ${opts.zoom};` : ''}
    return c.cameraPadding;
  })()`);
  process.stderr.write(`camera padding ${Number(padded).toFixed(3)} (zoom ${opts.zoom}${mine.pad !== null ? `, pad ${mine.pad}` : ''})\n`);
}

// Centre the sweep on --orbit-angle: open half of it to one side and let the
// clip carry the camera the same distance past. OrbitControls' auto-rotate
// walks the azimuth DOWN, so the clip opens on the + side and ends on the −.
export async function centreSweep(page, lab, mine, speed, seconds) {
  const half = (speed * seconds) / 2;
  const centre = mine.orbitAngle ?? 0;
  const start = centre + half;
  await page.eval(`window.${lab.configGlobal}.initialOrbitAngle = ${start}`);
  process.stderr.write(`orbit ${start.toFixed(1)}° -> ${(start - half * 2).toFixed(1)}° `
    + `(${(half * 2).toFixed(1)}° sweep, centred on ${centre.toFixed(1)}°)\n`);
}
