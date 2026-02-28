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

Large binary files (`.zip`) are tracked via Git LFS (configured in `.gitattributes`).

## Architecture

**Single page**: All content lives in `index.html`. There is no templating, routing, or JavaScript framework.

**CSS hybrid**: The navbar uses a self-contained Bulma-inspired implementation (`static/custom-navbar.css`). The page layout uses Bootstrap 4 grid (loaded from CDN). Global link colors and highlight styles are in `static/styles.css`. Note that `index.html` sets `font-family: Palatino` inline, which overrides the Monda font in `styles.css`.

**JavaScript**:
- `burger.js` — toggles `.is-active` on `.navbar-burger` and `#navbar-main` for the mobile hamburger menu
- `rand_pics.js` — loaded but currently non-functional (called with wrong argument count); referenced by `#index-img-description`
- Inline JS in `index.html` — `toggle_vis(id)` shows/hides elements by CSS class; `display(id)` toggles individual abstract blocks per publication

**Publications pattern**: Each publication entry is a Bootstrap `.row` with a video/image thumbnail in `.col-md-3` and details in `.col-md-8/9`. Abstract text is hidden in a `<div id="*-abs" style="display:none">` block, toggled by `onclick="display('*-abs')"`.

**`dimo/`**: A separate self-contained project page (has its own `index.html`, `css/`, `js/`, `assets/`, `img/`).

**Media**: Videos and images for publications are in `images/`. Poster PDFs are also served from `images/`.
