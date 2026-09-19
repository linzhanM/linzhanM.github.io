// Rewriting a served module as Chrome fetches it (the CDP Fetch domain), for
// render-lab-video.mjs. Two modules are patched, each for one run only; the
// files on disk, and every run that does not ask, are untouched.
//
//   OrbitControls.js  the auto-orbit rate. viewer.js sets autoRotateSpeed and
//                     advances the controls itself, so the page gives no handle
//                     on the rate; the one term in getAutoRotationAngle is
//                     scaled by window.__LAB_ORBIT_MULT (1 when unset).
//   examples.js       extra catalog stages, pushed onto the EXAMPLES array the
//                     module exports, so every importer sees them.

import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import { REPO_ROOT } from './paths.mjs';

// One paused response: rewrite() maps the source text to the patched text, or
// throws to let the original through, with `note` on stderr.
function fulfilPatched(page, params, rewrite, note) {
  return (async () => {
    try {
      const { body, base64Encoded } = await page.send('Fetch.getResponseBody', { requestId: params.requestId });
      const src = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
      const patched = rewrite(src);
      await page.send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: params.responseStatusCode || 200,
        responseHeaders: (params.responseHeaders || []).filter((h) => !/^content-length$/i.test(h.name)),
        body: Buffer.from(patched, 'utf8').toString('base64'),
      });
    } catch (err) {
      process.stderr.write(`${note} (${err.message})\n`);
      await page.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
    }
  })();
}

// Each handler filters by URL because every paused request reaches every
// listener; the returned pattern is what Fetch.enable pauses.
function patchOrbitRate(cdp, page) {
  const needle = /scope\.autoRotateSpeed(\s*\))/g;
  cdp.on('Fetch.requestPaused', (params, sessionId) => {
    if (sessionId !== page.sessionId || !/OrbitControls\.js/.test(params.request.url)) return;
    fulfilPatched(page, params, (src) => {
      const fn = src.indexOf('function getAutoRotationAngle');
      const end = src.indexOf('function getZoomScale', fn);
      if (fn < 0 || end < 0) throw new Error('getAutoRotationAngle not found — three version changed?');
      const patched = src.slice(0, fn)
        + src.slice(fn, end).replace(needle, 'scope.autoRotateSpeed * ( window.__LAB_ORBIT_MULT || 1 )$1')
        + src.slice(end);
      if (patched === src) throw new Error('auto-rotate term not found');
      return patched;
    }, 'orbit-rate patch failed; orbit keeps the lab\'s own rate');
  });
  return { urlPattern: '*controls/OrbitControls.js*', requestStage: 'Response' };
}

function patchExtraStages(cdp, page, stages) {
  cdp.on('Fetch.requestPaused', (params, sessionId) => {
    if (sessionId !== page.sessionId || !/js\/examples\.js/.test(params.request.url)) return;
    fulfilPatched(page, params, (src) => `${src}\nEXAMPLES.push(...${JSON.stringify(stages)});\n`,
      'extra-stage injection failed');
  });
  return { urlPattern: '*js/examples.js*', requestStage: 'Response' };
}

// The served tree reaches only files under the repo, so a stage that names a
// .glb elsewhere gets a copy in a scratch folder for the length of the run.
async function stageRoom(stagesFile) {
  const stages = JSON.parse(await readFile(stagesFile, 'utf8'));
  const room = path.join(REPO_ROOT, 'unimate', 'resources', 'glbs', '_render_tmp');
  await mkdir(room, { recursive: true });
  for (const stage of stages) {
    stage.files = await Promise.all((stage.files || []).map(async (f) => {
      const entry = typeof f === 'string' ? { url: f } : { ...f };
      if (path.isAbsolute(entry.url)) {
        const base = path.basename(entry.url);
        await copyFile(entry.url, path.join(room, base));
        entry.url = `resources/glbs/_render_tmp/${base}`;
      }
      return entry;
    }));
  }
  return { stages, cleanup: () => rm(room, { recursive: true, force: true }).catch(() => {}) };
}

// Installs whichever patches the run asks for and enables the Fetch domain for
// their URLs. Returns the cleanup that removes the scratch folder, if any —
// call it however the run ends.
export async function installPatches(cdp, page, mine) {
  const patterns = [];
  let cleanup = async () => {};
  if (mine.speed !== null || mine.arc !== null) patterns.push(patchOrbitRate(cdp, page));
  if (mine.extraStages) {
    const room = await stageRoom(mine.extraStages);
    cleanup = room.cleanup;
    patterns.push(patchExtraStages(cdp, page, room.stages));
    process.stderr.write(`extra stages: ${room.stages.map((s) => s.label).join(', ')}\n`);
  }
  if (patterns.length) await page.send('Fetch.enable', { patterns });
  return cleanup;
}
