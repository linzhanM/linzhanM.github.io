# UniMate site

Static project page and interactive Three.js motion viewer.

## Entry points

- `index.html` is the paper/project page. Its embedded viewer starts through
  `js/index-viewer.js`.
- `interactive.html` is the full-screen motion lab. Its viewer starts through
  `js/interactive.js`.

Both entries configure the shared `js/viewer.js` engine before importing it.

## Directory layout

```text
assets/                 Media, split by type — the same convention the root
  videos/               and dimo/ trees use
  posters/              One poster frame per clip, same basename
  logos/                Affiliation marks
  images/               Favicon, link-preview card, dataset figure
css/
  style.css             Project-page styles (10 numbered sections)
  schematics.css        Applications figure system (layout · rig · motion)
  responsive.css        Breakpoint overrides for the project page, loaded last
  interactive.css       Motion-lab styles (the only sheet interactive.html loads)
js/
  index-viewer.js       Entry: embedded project-page viewer
  interactive.js        Entry: full-screen motion lab (viewer config only —
                        the catalog is the shared examples.js)
  viewer.js             Shared Three.js scene engine
  examples.js           Scene catalog and layout metadata, shared by both pages
  stage-tuning.js       Per-page overrides of a stage's layout options
                        (pad/spacing/scale/lighting/floor) — catalog stays shared
  showcase.js           Hidden work-in-progress Showcase stage
  viewer-presets.js     Policy shared by both viewer entry points
  gallery.js            Video strips: scroll buttons, auto-cycle, app controls
  toc.js                TOC rail: scroll-spy + gutter-collision watcher
  abstract.js           Phone-width "Read full abstract" fold
resources/
  glbs/                 Runtime 3D model files (compressed — see below)
  prompts.json          Prompt labels keyed by model filename
  unimate.pdf           Paper PDF (linked from the site's resume page)
tools/
  render-category.mjs   Offline: render one lab category to a video. Not shipped
                        — nothing under css/ or js/ imports it
```

## Rig compression

`resources/glbs/` ships **meshopt-compressed geometry with 512px WebP textures**
— 54 rigs, 650 MB down to 48 MB (92.7%), which takes the landing stage from
27 MB to 1 MB. Triangle counts, animation counts and bounding boxes are
unchanged; the reduction is texture size, vertex welding and buffer encoding.

`viewer.js` therefore registers `MeshoptDecoder` on its `GLTFLoader`. **Without
it every rig fails to parse** — `EXT_texture_webp` and `KHR_mesh_quantization`
are native to three.js, but `EXT_meshopt_compression` is not.

The uncompressed sources live in `resources/glbs-raw/`, which is gitignored: the
repo is the deployed artifact and 657 MB of duplicates would put the published
site near GitHub Pages' 1 GB limit. They stay recoverable from commit `b4ac4c8`.
To rebuild after adding or replacing a rig:

```bash
npx @gltf-transform/cli optimize in.glb out.glb \
  --texture-compress webp --texture-size 512 --compress meshopt --simplify false
```

`--simplify false` is deliberate: these meshes are unwelded (one rig is 884k
vertices for 391k triangles), so simplification gains almost nothing here and is
the one step that would visibly change silhouettes.

## Rendering a category to video

`tools/render-category.mjs` turns one motion-lab category into a clip. The lab
itself is the renderer — the script serves the repo, drives a headless Chrome
over CDP, and pipes the frames into ffmpeg. Nothing about how a stage looks is
re-implemented there, so a framing fix belongs in `examples.js` /
`stage-tuning.js` and the render follows.

```bash
node unimate/tools/render-category.mjs --list
node unimate/tools/render-category.mjs --category "Unitree G1 Robot"
node unimate/tools/render-category.mjs -c welcome --zoom 1.35 --labels
node unimate/tools/render-category.mjs -c welcome --background "#f2efe6"
node unimate/tools/render-category.mjs -c welcome --background transparent -o walle.mov
```

Output lands in `~/Downloads/lab_renders/<slug>.mp4` — outside the repo on
purpose, since every file under `assets/**` is referenced by a page. Needs
Chrome and ffmpeg; no npm packages. `--help` lists every option.

`render-category.mjs` is the sequence and nothing else; each step is a module in
`tools/lib/`:

| | |
|---|---|
| `options.mjs` | the command line — usage text and the parser |
| `server.mjs` | the repo served read-only on loopback |
| `chrome.mjs` | finding and launching the browser |
| `cdp.mjs` | the DevTools socket, and one attached page |
| `bootstrap.mjs` | everything injected into the page, virtual clock included |
| `stage.mjs` | opening the lab and getting a category on screen |
| `clip.mjs` | how long the video runs, read out of the `.glb` rigs |
| `output.mjs` | frame geometry, the ffmpeg command, the frame sink |
| `capture.mjs` | the step-screenshot-write loop |
| `paths.mjs`, `util.mjs` | repo root and lab URL; `fail` / `slugify` / `waitUntil` |

Two seams are worth knowing before editing any of them. `bootstrap.mjs` is the
*only* channel into the page — it is stringified into
`Page.addScriptToEvaluateOnNewDocument`, so it is plain source with no imports,
and nothing it needs may leak into the shipped viewer. And `capture.mjs` knows
only about a sink with `write()` and `finish()`, which is why a `.png` output
(a directory of numbered frames) and an encoder on stdin are the same loop.

Four things it does that a screen recording cannot:

- **The page runs on a virtual clock.** `requestAnimationFrame`,
  `performance.now` and `Date.now` are replaced before any page script loads,
  and each captured frame advances time by exactly `1/fps`. Capture runs at
  ~5 fps and the result is a perfect 60.
- **Frame 0 is the stage as the lab first shows it.** The clock goes virtual
  *before* the stage is loaded again, so the reload's camera fit (opening orbit
  angle) and its fresh mixers (motion at t=0) are what the first frame sees —
  no rewind of a running mixer is possible otherwise.
- **The clip length comes from the rigs.** The `.glb` JSON chunk carries each
  animation's last keyframe time; the longest rig in the stage gets `--loops`
  passes (default 3), so no rig is ever cut mid-motion.
- **Colour and resolution are pinned.** Frames are supersampled (`--scale`,
  default 1.5 → 2560×1440 off a 4K render) and converted to Rec.709 limited
  range explicitly. ffmpeg otherwise picks BT.601 coefficients and tags nothing,
  which is what makes an encode look shifted against the browser.

`--background` repaints **only what is behind the stage** — the floor, lights and
skeleton stay on the theme. It reaches the live scene through
`window.__THREE_DEVTOOLS__`, which three dispatches every Scene and renderer to;
that is the only way in, since the viewer exports nothing and
`WebGLRenderer.render` is an own property of each instance, so patching the
prototype does nothing. `transparent` also needs the page's own fills off
(`body` carries a gradient, `.viewer-wrapper` its `--stage` colour) and Chrome's
default background override cleared, and it only survives into `.mov` (ProRes
4444) or a `.png` sequence — `libvpx-vp9` accepts `yuva420p` and then drops the
alpha plane without a word.

**Everything on screen runs off one measured delta** — mixers, auto-orbit and
label easing all take `dt` from the same `THREE.Clock`. Auto-orbit only does so
because `viewer.js` passes it explicitly (`controls.update(dt)`); OrbitControls'
no-argument branch advances a fixed step *per frame*, which used to make the
live lab sweep twice as fast on a 120 Hz screen and slow down under load.
`orbit speed` is therefore a rate — OrbitControls counts it in units of
`2π/60` rad/s, one unit being 6°/s. The lab runs **`8/6`: 8°/s, a revolution
every 45 s**, on any display. Auto-orbit is lab-only; the project page's embed
never sets `autoOrbitControls`, so its camera is still. What is *not* rate-free
is OrbitControls' damping, which decays per frame: the first ~12 frames are a
ramp, so a slower frame rate starts the sweep a fraction of a second behind and
carries that offset for the rest of the run. It is about a degree between 30 and
60 fps, constant rather than growing — visible only if you diff two renders.

Two consequences for capture. `--fps` is a sampling knob only: the virtual clock
hands the page exactly `1/fps` each frame, so 30 and 60 render the same clip at
the same speed, one more finely than the other. And `--fps` must stay **at or
above 20** — `viewer.js` caps a single frame's delta at `1/20` s so a
backgrounded tab doesn't resume by teleporting a rig through its clip, and below
20 fps that guard makes the whole render play slow.

## Showcase workflow

The Showcase stage remains available in `js/showcase.js`, but both public entry
points hide it through `HIDDEN_CATEGORIES` in `js/viewer-presets.js`. Remove
`Showcase` from that list to resume visual debugging on both pages.

## Cache versions

Every local CSS/JS reference carries a `?v=N` query, including the ES-module
imports between the viewer files: HTML files version their direct entry points,
entry modules version `viewer.js` and their helper imports, `viewer.js` versions
the catalog import, and the catalog versions `showcase.js`. When you edit a file,
bump the `?v=` at every place that imports it, then walk the bump up the chain to
the HTML — a stale module anywhere in the graph is a broken viewer, not just a
stale style.
