// The page-side bootstrap: injected with Page.addScriptToEvaluateOnNewDocument,
// so it runs before any of the lab's own scripts, in every document. This is the
// only channel this tool has into the page — the shipped viewer must never grow
// a capture-only branch.

// Config overrides the lab does not offer as UI. Everything else about the
// scene (framing, lighting, layout) stays in examples.js / stage-tuning.js.
export function viewerConfigFor(opts) {
  return {
    ...(opts.labels ? { hoverPrompts: false } : {}),
    ...(opts.orbit ? {} : { autoOrbitControls: false, initialOrbitAngle: 0 }),
  };
}

export function bootstrapSource(config, zoom) {
  return `(() => {
  const CONFIG = ${JSON.stringify(config)};
  const ZOOM = ${zoom};

  // Keep the WebGL back buffer readable after the compositor paints, or a
  // screenshot taken between render ticks returns a black canvas.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (typeof type === 'string' && type.indexOf('webgl') === 0) {
      attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
    }
    return getContext.call(this, type, attrs);
  };

  // interactive.js assigns the whole config object, so the overrides are folded
  // in as it lands rather than written before or after it.
  let cfg;
  Object.defineProperty(window, 'UNIMATE_VIEWER_CONFIG', {
    configurable: true,
    get: () => cfg,
    set: (value) => {
      cfg = Object.assign(value || {}, CONFIG);
      // Zoom divides the GLOBAL padding and leaves the per-category multipliers
      // alone, so every stage keeps the relative framing the lab gave it.
      if (ZOOM !== 1) {
        cfg.cameraPadding = (cfg.cameraPadding || 1) / ZOOM;
        cfg.mobileCameraPadding = (cfg.mobileCameraPadding || 1) / ZOOM;
      }
    },
  });

  // Reaching the live scene. three dispatches every Scene and WebGLRenderer it
  // constructs to window.__THREE_DEVTOOLS__ when that object exists, and
  // defining it here — before any module loads — is the only way in: the viewer
  // exports nothing, and WebGLRenderer.render is an OWN property of each
  // instance, so patching the prototype from outside silently does nothing.
  const scenes = [];
  const renderers = [];
  const devtools = new EventTarget();
  devtools.addEventListener('observe', (event) => {
    const target = event.detail;
    if (!target) return;
    if (target.isScene) scenes.push(target);
    else if (target.isWebGLRenderer) renderers.push(target);
  });
  window.__THREE_DEVTOOLS__ = devtools;

  // Which rigs this stage pulled. The catalog is not exported to the page, so
  // the fetches are the reliable list — and the driver reads the clip lengths
  // off those files to decide how long the video runs.
  const assets = [];
  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\\.(glb|gltf|fbx)(\\?|$)/i.test(url) && assets.indexOf(url) < 0) assets.push(url);
    return realFetch(input, init);
  };

  // Virtual clock. Passthrough until begin(): the stage loads, compiles and
  // frames itself in real time, and only the capture runs on stepped time.
  const realRAF = window.requestAnimationFrame.bind(window);
  const realCAF = window.cancelAnimationFrame.bind(window);
  const realPerfNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  const epoch = realDateNow() - realPerfNow();
  let virtual = null;
  let nextId = 1 << 24;          // far from any id the real rAF hands out
  let queue = new Map();

  window.requestAnimationFrame = (cb) => {
    if (virtual === null) return realRAF(cb);
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => { if (!queue.delete(id)) realCAF(id); };
  performance.now = () => (virtual === null ? realPerfNow() : virtual);
  Date.now = () => (virtual === null ? realDateNow() : Math.round(epoch + virtual));

  window.__labCapture = {
    assets: () => assets.slice(),
    // Repaint what is behind the stage; null clears to transparent instead. The
    // Color constructor is borrowed off the background already there, since the
    // module itself is out of reach from here. Returns the number of scenes
    // repainted, or -1 if the way in stopped working — never silence.
    setBackground(css) {
      if (!scenes.length) return 0;
      for (const scene of scenes) {
        if (css === null) { scene.background = null; continue; }
        const Color = scene.background && scene.background.isColor ? scene.background.constructor : null;
        if (!Color) return -1;
        scene.background = new Color(css);
      }
      if (css === null) for (const renderer of renderers) renderer.setClearAlpha(0);
      return scenes.length;
    },
    // Start from the real clock's current value so the first delta is ~0 rather
    // than a jump the mixers would swallow as one huge step.
    begin() { if (virtual === null) virtual = realPerfNow(); },
    // Callbacks waiting on the virtual clock. Zero right after begin() only
    // means the loop's real rAF has not come back around yet — the driver waits
    // on this before stepping, or the first frames step an empty queue.
    pending() { return queue.size; },
    // Advance one frame and run everything waiting on it. The return value is
    // how many callbacks re-registered: 0 means the render loop stopped.
    step(ms) {
      virtual += ms;
      const due = queue;
      queue = new Map();
      for (const cb of due.values()) { try { cb(virtual); } catch (e) { console.error(e); } }
      return queue.size;
    },
  };
})();`;
}
