// Page-side overlays for render-lab-video.mjs. Each function returns source
// text for Page.addScriptToEvaluateOnNewDocument, exactly as bootstrap.mjs
// does, and the same rules hold: plain source, no imports, nothing that leaks
// into the shipped viewer. They run after the bootstrap in the same document
// and reach the live scene the way it does — through window.__THREE_DEVTOOLS__,
// to which three dispatches every renderer; each wraps that renderer's own
// `render` (an own property, so the prototype is no use) to run before every
// frame. Anything they need from three is imported in the page through the
// lab's import map, so it is the viewer's own instance.

// The chips are DOM (interactive.css .viewer-label / .viewer-pin) and the lab
// measures each box to place it, so restyling them is enough: bigger text,
// proportional padding, and a pin that keeps its ratio.
function chipStyleSource(scale) {
  const css = `
    .viewer-label { font-size: ${(10 * scale).toFixed(2)}px !important;
                    padding: ${(5 * scale).toFixed(2)}px ${(9 * scale).toFixed(2)}px !important;
                    border-radius: ${(3 * scale).toFixed(2)}px !important; }
    .viewer-label::after { width: ${Math.max(1, scale).toFixed(2)}px !important; }
    .viewer-pin { width: ${(4 * scale).toFixed(2)}px !important; height: ${(4 * scale).toFixed(2)}px !important;
                  box-shadow: 0 0 0 ${(2 * scale).toFixed(2)}px rgba(18, 19, 18, 0.72) !important; }`;
  return `(() => {
    const add = () => {
      const el = document.createElement('style');
      el.id = 'render-lab-chip-scale';
      el.textContent = ${JSON.stringify(css)};
      document.head.appendChild(el);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add, { once: true });
  })();`;
}

// A ring around every joint whose bone name matches: one fixed-position div
// each, moved to the projected joint before every frame. DOM rather than scene
// geometry, so it reads at any camera distance and is captured with the chips.
function ringSource(ring) {
  return `(() => {
  const R = ${JSON.stringify(ring)};
  const dev = window.__THREE_DEVTOOLS__;
  if (!dev) return;
  const rings = new Map();
  let layer = null;
  const style = document.createElement('style');
  style.textContent = '.lab-ring{position:fixed;border-radius:50%;pointer-events:none;' +
    'box-shadow:0 0 0 2px rgba(0,0,0,.55);transform:translate(-50%,-50%);z-index:60}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
  function place(scene, camera, renderer) {
    if (!layer) { layer = document.createElement('div'); document.body.appendChild(layer); }
    const canvas = renderer.domElement.getBoundingClientRect();
    const re = new RegExp(R.match, 'i');
    const live = new Set();
    scene.traverse((o) => {
      if (!o.isSkeletonHelper) return;
      for (const b of o.bones) {
        if (!b || !re.test(b.name)) continue;
        live.add(b);
        let el = rings.get(b);
        if (!el) {
          el = document.createElement('div');
          el.className = 'lab-ring';
          el.style.border = '3px solid ' + (R.color || '#ffffff');
          el.style.width = el.style.height = (R.size || 30) + 'px';
          layer.appendChild(el);
          rings.set(b, el);
        }
        b.updateMatrixWorld();
        const v = new THREE_NS.Vector3().setFromMatrixPosition(b.matrixWorld).project(camera);
        if (v.z > 1) { el.style.display = 'none'; continue; }
        el.style.display = '';
        el.style.left = (canvas.left + (v.x * 0.5 + 0.5) * canvas.width) + 'px';
        el.style.top = (canvas.top + (-v.y * 0.5 + 0.5) * canvas.height) + 'px';
      }
    });
    for (const [b, el] of rings) if (!live.has(b)) { el.remove(); rings.delete(b); }
  }
  let THREE_NS = null;
  dev.addEventListener('observe', (event) => {
    const r = event.detail;
    if (!r || !r.isWebGLRenderer) return;
    if (!THREE_NS) import('three').then((m) => { THREE_NS = m; }).catch(() => {});
    const render = r.render;
    r.render = function (scene, camera) {
      try { if (THREE_NS && scene && scene.isScene) place(scene, camera, this); } catch (err) { console.error('ring', err); }
      return render.call(this, scene, camera);
    };
  });
})();`;
}

// Callouts: for each entry a ring on the first joint its name matches, a chip
// offset from it and a leader between the two — the lab's own chip look,
// pointing at ONE joint rather than a whole rig.
function annotateSource(list) {
  return `(() => {
  const A = ${JSON.stringify(list)};
  const dev = window.__THREE_DEVTOOLS__;
  if (!dev) return;
  let THREE_NS = null, svg = null;
  const made = [];
  const css = document.createElement('style');
  css.textContent = [
    '.lab-call{position:fixed;transform:translate(-50%,-50%);border-radius:999px;pointer-events:none;z-index:60}',
    '.lab-note{position:fixed;transform:translate(-50%,-50%);pointer-events:none;z-index:61;',
    '  font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.01em;color:#fff;',
    '  background:rgba(18,20,19,.88);padding:6px 10px;border-radius:6px;white-space:nowrap}',
    '.lab-lead{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:59}',
  ].join('');
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css));
  function ensure() {
    if (svg) return;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'lab-lead');
    document.body.appendChild(svg);
    A.forEach((a) => {
      const ring = document.createElement('div');
      ring.className = 'lab-call';
      ring.style.border = '3px solid ' + (a.color || '#ffffff');
      ring.style.width = ring.style.height = (a.size || 44) + 'px';
      const note = document.createElement('div');
      note.className = 'lab-note';
      note.textContent = a.text || '';
      note.style.boxShadow = 'inset 0 0 0 1px ' + (a.color || '#ffffff');
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', a.color || '#ffffff');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-opacity', '.85');
      svg.appendChild(line);
      document.body.append(ring, note);
      made.push({ a, ring, note, line });
    });
  }
  function place(scene, camera, renderer) {
    ensure();
    const box = renderer.domElement.getBoundingClientRect();
    made.forEach(({ a, ring, note, line }) => {
      const re = new RegExp(a.match, 'i');
      let bone = null;
      scene.traverse((o) => { if (!bone && o.isSkeletonHelper) bone = o.bones.find((b) => b && re.test(b.name)) || null; });
      if (!bone) { ring.style.display = note.style.display = 'none'; line.setAttribute('stroke-opacity', '0'); return; }
      bone.updateMatrixWorld();
      const v = new THREE_NS.Vector3().setFromMatrixPosition(bone.matrixWorld).project(camera);
      const x = box.left + (v.x * 0.5 + 0.5) * box.width;
      const y = box.top + (-v.y * 0.5 + 0.5) * box.height;
      ring.style.display = note.style.display = '';
      ring.style.left = x + 'px'; ring.style.top = y + 'px';
      const nx = x + (a.dx || 0), ny = y + (a.dy || 0);
      note.style.left = nx + 'px'; note.style.top = ny + 'px';
      const r = (a.size || 44) / 2;
      const ang = Math.atan2(ny - y, nx - x);
      line.setAttribute('x1', x + Math.cos(ang) * r); line.setAttribute('y1', y + Math.sin(ang) * r);
      line.setAttribute('x2', nx - Math.cos(ang) * 8); line.setAttribute('y2', ny - Math.sin(ang) * 8);
      line.setAttribute('stroke-opacity', '.85');
    });
  }
  dev.addEventListener('observe', (event) => {
    const r = event.detail;
    if (!r || !r.isWebGLRenderer) return;
    if (!THREE_NS) import('three').then((m) => { THREE_NS = m; }).catch(() => {});
    const render = r.render;
    r.render = function (scene, camera) {
      try { if (THREE_NS && scene && scene.isScene) place(scene, camera, this); } catch (err) { console.error('annotate', err); }
      return render.call(this, scene, camera);
    };
  });
})();`;
}

// The generated span between two given poses: fade every rig but the flanks,
// so the eye reads the ends as the input poses and the middle as what the
// model filled in. Meshes only — the skeletons stay crisp. Rigs are grouped by
// their top-level object and ordered by world x; fewer than three leaves the
// stage alone.
function dimMiddleSource(opacity) {
  return `(() => {
  const dev = window.__THREE_DEVTOOLS__;
  if (!dev) return;
  const OP = ${opacity};
  let THREE_NS = null;
  const faded = new WeakSet();
  function apply(scene) {
    const rigs = new Map();
    scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      let top = o;
      while (top.parent && top.parent !== scene) top = top.parent;
      if (!rigs.has(top)) rigs.set(top, []);
      rigs.get(top).push(o);
    });
    if (rigs.size < 3) return;
    const rows = [...rigs.entries()].map(([root, meshes]) => {
      root.updateMatrixWorld();
      return { meshes, x: new THREE_NS.Vector3().setFromMatrixPosition(root.matrixWorld).x };
    }).sort((a, b) => a.x - b.x);
    rows.slice(1, -1).forEach(({ meshes }) => meshes.forEach((m) => {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mat) => {
        if (!mat || faded.has(mat)) return;
        mat.transparent = true; mat.opacity = OP; mat.depthWrite = false; mat.needsUpdate = true;
        faded.add(mat);
      });
    }));
  }
  dev.addEventListener('observe', (event) => {
    const r = event.detail;
    if (!r || !r.isWebGLRenderer) return;
    if (!THREE_NS) import('three').then((m) => { THREE_NS = m; }).catch(() => {});
    const render = r.render;
    r.render = function (scene, camera) {
      try { if (THREE_NS && scene && scene.isScene) apply(scene); } catch (err) { console.error('dim-middle', err); }
      return render.call(this, scene, camera);
    };
  });
})();`;
}

// Hide every rig but the flanks. The camera fit has already happened, so the
// framing is the full row's and the two clips cut together without a jump.
// The SkeletonHelpers sit beside the rigs, not under them, so they are matched
// to the kept rigs by their root bone's x.
function onlyEndsSource() {
  return `(() => {
  const dev = window.__THREE_DEVTOOLS__;
  if (!dev) return;
  let THREE_NS = null;
  function apply(scene) {
    const rigs = new Map();
    scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      let top = o;
      while (top.parent && top.parent !== scene) top = top.parent;
      if (!rigs.has(top)) rigs.set(top, []);
      rigs.get(top).push(o);
    });
    if (rigs.size < 3) return;
    const rows = [...rigs.keys()].map((root) => {
      root.updateMatrixWorld();
      return { root, x: new THREE_NS.Vector3().setFromMatrixPosition(root.matrixWorld).x };
    }).sort((a, b) => a.x - b.x);
    const keep = new Set([rows[0].root, rows[rows.length - 1].root]);
    const lo = rows[0].x, hi = rows[rows.length - 1].x;
    rows.forEach(({ root }) => { if (!keep.has(root)) root.visible = false; });
    scene.traverse((o) => {                       // the helpers live beside the rigs, not under them
      if (!o.isSkeletonHelper || !o.bones.length) return;
      const b = o.bones[0];
      b.updateMatrixWorld();
      const x = new THREE_NS.Vector3().setFromMatrixPosition(b.matrixWorld).x;
      o.visible = Math.abs(x - lo) < 1e-3 || Math.abs(x - hi) < 1e-3 ||
                  Math.min(Math.abs(x - lo), Math.abs(x - hi)) < (hi - lo) * 0.12;
    });
  }
  dev.addEventListener('observe', (event) => {
    const r = event.detail;
    if (!r || !r.isWebGLRenderer) return;
    if (!THREE_NS) import('three').then((m) => { THREE_NS = m; }).catch(() => {});
    const render = r.render;
    r.render = function (scene, camera) {
      try { if (THREE_NS && scene && scene.isScene) apply(scene); } catch (err) { console.error('only-ends', err); }
      return render.call(this, scene, camera);
    };
  });
})();`;
}

// Fat skeleton: a LineSegments2 (plus joint Points) child on every
// SkeletonHelper, synced from its positions before each render; the helper's
// own hairlines are hidden. The addon modules load through the page's import
// map at the renderer's first appearance, after the map is parsed, so the
// page's module graph is untouched. `highlight` ({match, held, rest}) recolours
// the helper's vertex colours, which the fat lines then carry.
function fatSkeletonSource(width, joint, highlight) {
  return `(() => {
  const WIDTH = ${width}, JOINT = ${joint};
  const HL = ${JSON.stringify(highlight || null)};
  const dev = window.__THREE_DEVTOOLS__;
  if (!dev) return;
  let mods = null;
  const built = new WeakMap();
  const dot = () => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    return c;
  };
  // the bones SkeletonHelper actually draws: one segment each, bone to parent
  const segBones = (helper) => helper.bones.filter((b) => b && b.parent && b.parent.isBone);
  function build(helper) {
    const { THREE, LineSegments2, LineSegmentsGeometry, LineMaterial } = mods;
    const pos = helper.geometry.getAttribute('position');
    const col = helper.geometry.getAttribute('color');
    // held vs resampled: SkeletonHelper lays two vertices per bone, bones[i] and its parent, so a
    // name test on helper.bones[i] paints that segment and the joint at its end.
    if (HL && col) {
      const re = new RegExp(HL.match, 'i');
      const held = HL.held ? new mods.THREE.Color(HL.held) : null;
      const rest = HL.rest ? new mods.THREE.Color(HL.rest) : null;   // null keeps the lab's own gradient
      segBones(helper).forEach((b, i) => {
        const c = b && re.test(b.name) ? held : rest;
        if (!c) return;
        col.array[i * 6 + 0] = c.r; col.array[i * 6 + 1] = c.g; col.array[i * 6 + 2] = c.b;
        col.array[i * 6 + 3] = c.r; col.array[i * 6 + 4] = c.g; col.array[i * 6 + 5] = c.b;
      });
      col.needsUpdate = true;
    }
    const geo = new LineSegmentsGeometry();
    geo.setPositions(pos.array);
    if (col) geo.setColors(col.array);
    const mat = new LineMaterial({ linewidth: WIDTH, vertexColors: !!col, depthTest: false, depthWrite: false,
                                   transparent: true, worldUnits: false });
    const line = new LineSegments2(geo, mat);
    line.frustumCulled = false; line.renderOrder = helper.renderOrder;
    helper.add(line);
    let pts = null;
    if (JOINT > 0) {
      const pg = new THREE.BufferGeometry();
      pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.array), 3));
      if (col) pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col.array), 3));
      const pm = new THREE.PointsMaterial({ size: JOINT, sizeAttenuation: false, map: new THREE.CanvasTexture(dot()),
        alphaTest: 0.5, vertexColors: !!col, depthTest: false, depthWrite: false, transparent: true });
      pts = new THREE.Points(pg, pm);
      pts.frustumCulled = false; pts.renderOrder = helper.renderOrder + 1;
      helper.add(pts);
    }
    helper.material.visible = false;
    return { line, mat, pts };
  }
  function sync(scene, renderer) {
    if (!mods || !scene || !scene.isScene) return;
    const size = renderer.getSize(new mods.THREE.Vector2());
    scene.updateMatrixWorld();
    scene.traverse((o) => {
      if (!o.isSkeletonHelper) return;
      let f = built.get(o);
      if (!f) { f = build(o); built.set(o, f); }
      o.updateMatrixWorld(true);
      const src = o.geometry.getAttribute('position').array;
      const inst = f.line.geometry.getAttribute('instanceStart').data;
      inst.array.set(src); inst.needsUpdate = true;
      f.mat.resolution.set(size.x, size.y);
      if (f.pts) { const a = f.pts.geometry.getAttribute('position'); a.array.set(src); a.needsUpdate = true; }
    });
  }
  dev.addEventListener('observe', (event) => {
    const r = event.detail;
    if (!r || !r.isWebGLRenderer) return;
    if (!mods) {
      Promise.all([import('three'), import('three/addons/lines/LineSegments2.js'),
                   import('three/addons/lines/LineSegmentsGeometry.js'), import('three/addons/lines/LineMaterial.js')])
        .then(([THREE, a, b, c]) => { mods = { THREE, LineSegments2: a.LineSegments2,
                                               LineSegmentsGeometry: b.LineSegmentsGeometry, LineMaterial: c.LineMaterial }; })
        .catch((err) => console.error('fat skeleton: addons failed to load', err));
    }
    const render = r.render;
    r.render = function (scene, camera) {
      try { sync(scene, r); } catch (err) { console.error('fat skeleton', err); }
      return render.call(this, scene, camera);
    };
  });
})();`;
}

// The overlays a run asks for, in the order they are injected (after the
// bootstrap, which installs the devtools hook they all wait on).
export function overlaysFor(mine) {
  const sources = [];
  if (mine.skelWidth !== null && mine.skelWidth > 0) {
    sources.push(fatSkeletonSource(mine.skelWidth, mine.jointSize ?? mine.skelWidth * 2.2, mine.highlight));
  }
  if (mine.annotate) sources.push(annotateSource(mine.annotate));
  if (mine.onlyEnds) sources.push(onlyEndsSource());
  if (mine.dimMiddle !== null) sources.push(dimMiddleSource(mine.dimMiddle));
  if (mine.ring) sources.push(ringSource(mine.ring));
  if (mine.promptScale !== 1) sources.push(chipStyleSource(mine.promptScale));
  return sources;
}
