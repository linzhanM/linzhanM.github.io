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
assets/                 Images, posters, videos, logos, and favicon
css/                    Project-page, schematic, and motion-lab styles
js/
  examples.js           Public scene catalog and layout metadata
  showcase.js           Hidden work-in-progress Showcase stage
  catalog-runtime.js    Full-screen-only catalog transformations
  viewer-presets.js     Policy shared by both viewer entry points
  viewer.js             Shared Three.js scene engine
resources/
  glbs/                 Runtime 3D model files
  prompts.json          Prompt labels keyed by model filename
  unimate.pdf           Paper PDF
```

## Showcase workflow

The Showcase stage remains available in `js/showcase.js`, but both public entry
points hide it through `HIDDEN_CATEGORIES` in `js/viewer-presets.js`. Remove
`Showcase` from that list to resume visual debugging on both pages.

## Cache versions

HTML files version their direct CSS/JavaScript entry points. Viewer entry modules
version `viewer.js`, and `viewer.js` versions the catalog import. Increment the
relevant entry version whenever a deployed static asset changes.
