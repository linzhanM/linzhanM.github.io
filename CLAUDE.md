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

`.gitattributes` routes any `.zip` through Git LFS, but the repo tracks no binary archives — all media is committed directly (videos, images, PDFs, `.glb` models).

## Layout

```
index.html              Main homepage (the only page with publication content)
static/                 Front-end assets for the homepage (CSS + JS)
images/                 Homepage media: publication thumbnails, logos, profile photo
assets/                 Homepage poster PDFs
dimo/                   Self-contained DIMO project page
unimate/                Self-contained UniMate project page
```

## Architecture

**Single page**: All homepage content lives in `index.html`. There is no templating, routing, or JavaScript framework. The two project pages (`dimo/`, `unimate/`) are independent and share nothing with the homepage or each other.

**CSS hybrid** (homepage): The navbar uses a self-contained Bulma-inspired implementation (`static/custom-navbar.css`). The page layout uses Bootstrap 4 grid (loaded from CDN). Global link colors and highlight styles are in `static/styles.css`. Note that `index.html` sets `font-family: Palatino` inline, which overrides the Monda font in `styles.css`.

**JavaScript** (homepage):
- `static/burger.js` — toggles `.is-active` on `.navbar-burger` and `#navbar-main` for the mobile hamburger menu
- Inline JS in `index.html` — `toggle_vis(id)` shows/hides elements by CSS class; `display(id)` toggles individual abstract blocks per publication

**Publications pattern**: Each publication entry is a Bootstrap `.row` with a video/image thumbnail in `.col-md-3` and details in `.col-md-9`. Abstract text is hidden in a `<div id="*-abs" class="pub-abstract">` block, toggled by `onclick="display('*-abs')"`. Entries beyond the first few are marked `class="pub-extra" style="display:none"` and revealed by the "[Show more]" toggle (`toggle_vis('pub-extra')`).

**Homepage media**: Publication thumbnails (videos/images) live in `images/`, each named after the work it represents (e.g. `dimo.mp4`, `letoccflow.mp4`, `ttt-parkour.mp4`, `vr-robo.mp4`, `instruct-4d-to-4d.mp4`). Affiliation/company logos carry a `-logo` suffix (`meta-logo.png`); `princeton-logo.jpg` doubles as the favicon. Poster PDFs live in `assets/`.

**`dimo/`**: Self-contained, custom-designed project page for the DIMO paper — no Bootstrap, no shared assets. All styling is in `dimo/css/style.css` (design tokens at `:root`); markup is in `dimo/index.html`; the only script is `dimo/js/nav.js`. Loads Academicons, Font Awesome 4, and the Space Grotesk / Inter / Space Mono fonts from CDNs. Assets live in `dimo/img/` (videos, teaser/pipeline figures, `favicon.svg`) and `dimo/assets/` (the paper PDF).
  - **Design system**: a dark "latent-space" hero over a light "paper" body, with a reserved blue→violet→pink spectrum (`--spectrum`) used only on the title, the active nav node, the nav progress fill, and `favicon.svg`. Sections (`#demo`, `#applications`, `#abstract`, `#method`, `#poster`, `#cite`) alternate white / `--paper-2` tint for separation (no borders). Each section header is a mono `.kicker` + a `.section-title`.
  - **Signature**: the hero figure is an inline SVG (`.field`) where one origin keypoint fans into five trajectories ending in CSS/SMIL-animated stick-figure skeletons (wave/walk/kick/jump/turn). Skeleton limbs rotate via `transform-box: view-box` with per-limb `transform-origin`; `prefers-reduced-motion` freezes them and hides the traveling `.kp` dots.
  - **Side nav** (`.sidenav`): a fixed vertical "trajectory" rail in the left gutter, right-anchored so labels never crowd the content; hidden under 1440px. `nav.js` uses `IntersectionObserver` to reveal it past the hero, set the `.is-active` node, and drive the `--nav-progress` spectrum fill. Links are plain anchors, so it degrades without JS.

**`unimate/`**: Self-contained project page for the UniMate paper, currently a "coming soon" placeholder (`<meta robots="noindex, nofollow">`). It shows the title and affiliation logos (`unimate/assets/{princeton,mit,bair}.png`). The page contains a fully built but **commented-out** Three.js model viewer (importmap + module script) that loads the rigs in `unimate/glbs/*.glb`; it is intentionally disabled WIP with a "Re-enable later" marker. The `.glb` files exist solely to feed that viewer when it is re-enabled — do not delete them while the block is meant to come back.
