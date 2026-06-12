# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a personal academic homepage for Linzhan Mou, deployed as a GitHub Pages static site at `linzhanm.github.io`. It is a single-page site with no build system, no package manager, and no server-side code.

## Development

To preview locally, serve the directory with any static file server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

To deploy, commit changes and push to `main` — GitHub Pages serves the branch automatically.

`.gitattributes` routes any `.zip` through Git LFS, but the repo currently tracks no binary archives — all media is committed directly (videos, images, PDFs).

## Architecture

**Single page**: All content lives in `index.html`. There is no templating, routing, or JavaScript framework.

**CSS hybrid**: The navbar uses a self-contained Bulma-inspired implementation (`static/custom-navbar.css`). The page layout uses Bootstrap 4 grid (loaded from CDN). Global link colors and highlight styles are in `static/styles.css`. Note that `index.html` sets `font-family: Palatino` inline, which overrides the Monda font in `styles.css`.

**JavaScript**:
- `burger.js` — toggles `.is-active` on `.navbar-burger` and `#navbar-main` for the mobile hamburger menu
- Inline JS in `index.html` — `toggle_vis(id)` shows/hides elements by CSS class; `display(id)` toggles individual abstract blocks per publication

**Publications pattern**: Each publication entry is a Bootstrap `.row` with a video/image thumbnail in `.col-md-3` and details in `.col-md-9`. Abstract text is hidden in a `<div id="*-abs" class="pub-abstract">` block, toggled by `onclick="display('*-abs')"`. Entries beyond the first few are marked `class="pub-extra" style="display:none"` and revealed by the "[Show more]" toggle (`toggle_vis('pub-extra')`).

**`dimo/`**: A separate self-contained project page for the DIMO paper. It is plain HTML + CSS only — no JavaScript. It loads Bootstrap 4 grid/components CSS locally (`dimo/css/bootstrap-4.4.1.css`) plus Academicons, Font Awesome 4, and the Jost font from CDNs. Assets live in `dimo/img/` (videos, teaser/pipeline figures, favicon) and `dimo/assets/` (the paper PDF). Note: `dimo/img/demo1–3.mp4` are currently unreferenced (left over from a removed demo carousel).

**Media**: Publication thumbnails (videos/images) live in `images/`, each named after the work it represents (e.g. `dimo.mp4`, `letoccflow.mp4`, `ttt-parkour.mp4`, `vr-robo.mp4`, `instruct-4d-to-4d.mp4`). Company/affiliation logos use a `-logo` suffix (`meta-logo.png`, `kling-logo.png`, `princeton-logo.jpg`). Poster PDFs live in `assets/`.
