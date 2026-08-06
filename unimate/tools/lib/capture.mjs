// The frame loop: step the virtual clock, screenshot, hand the buffer to the
// sink. Screenshotting is slow (~5-10 fps) and that is fine — the page only
// advances when it is stepped, so the result is a perfect --fps regardless.

import { frameName } from './output.mjs';

export async function captureFrames(page, sink, { total, fps, format, jpeg }) {
  const frameMs = 1000 / fps;
  const started = Date.now();
  let stalled = false;

  for (let i = 0; i < total; i++) {
    const queued = await page.eval(`window.__labCapture.step(${frameMs})`);
    if (!queued && !stalled) {
      stalled = true;
      console.error('warning: nothing re-registered a frame callback — the render loop may have stopped');
    }

    const shot = await page.send('Page.captureScreenshot', {
      format, ...(jpeg ? { quality: 95 } : {}), fromSurface: true, captureBeyondViewport: false,
    });
    await sink.write(Buffer.from(shot.data, 'base64'), frameName(i, format));

    if (i % fps === 0 || i === total - 1) {
      const done = i + 1;
      const rate = done / ((Date.now() - started) / 1000);
      const left = Math.round((total - done) / Math.max(rate, 0.01));
      process.stderr.write(`\r  ${done}/${total} frames · ${rate.toFixed(1)} fps · ~${left}s left    `);
    }
  }
  process.stderr.write('\n');
}
