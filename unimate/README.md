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
  glbs/                 Runtime 3D model files
  prompts.json          Prompt labels keyed by model filename
  unimate.pdf           Paper PDF (linked from the site's resume page)
```

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
