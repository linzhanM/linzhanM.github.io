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
assets/images/          Homepage media: publication thumbnails, logos, profile photo
assets/pdf/             Homepage poster PDFs and CV
dimo/                   Self-contained DIMO project page
unimate/                Self-contained UniMate project page
```

## Architecture

**Single page**: All homepage content lives in `index.html`. There is no templating, routing, or JavaScript framework. The two project pages (`dimo/`, `unimate/`) are independent and share nothing with the homepage or each other.

**CSS hybrid** (homepage): Two local stylesheets layered on a CDN-loaded Bootstrap 4 grid. `static/custom-navbar.css` is a minimal Bulma-derived navbar, trimmed to only the rules this navbar actually uses (the mobile burger toggle and the ≥1024px flex layout). `static/styles.css` holds the design system: a `:root` block of design tokens (ivory/slate surfaces with a Princeton-orange accent `#E77500`, a type scale, weights), base typography, and all publication styles. Fonts are Fraunces (display — name and section headers) and Source Serif 4 (body), from Google Fonts; `.pub-title` overrides to Palatino Linotype. Other CDN assets: Font Awesome 5, Academicons, and GitHub `buttons.js`.

**JavaScript** (homepage):
- `static/burger.js` — toggles `.is-active` on `.navbar-burger` and `#navbar-main` for the mobile hamburger menu
- Inline JS in `index.html` — `display(id)` toggles a publication's abstract block; an `IntersectionObserver` lazy-plays the Robotics `video.lazy-video` thumbnails (which set `preload="none"`) only while on screen; a one-liner fills the footer copyright year. StatCounter analytics load at the end of `<body>`.

**Publications pattern**: Publications live under `#Publications` ("Recent Publications"), split into `.section-h3` subsections — "Vision & Graphics" and "Robotics & RL". Each entry is a `.pub-row.row`: a video/image thumbnail in `.col-md-3` and details (`.pub-title` / `.pub-authors` / `.pub-venue` / `.pub-links`) in `.col-md-9`. Abstract text is hidden in a `<div id="*-abs" class="pub-abstract">` block, toggled by `onclick="display('*-abs')"`. Robotics thumbnails additionally carry `class="lazy-video"` with `preload="none"` so they only fetch and play when scrolled into view. **Currently the entire "Recent Publications" and "Experience" blocks are wrapped in HTML comments ("temporarily hidden"), so only `#Service` renders live** — the markup (and all its media) is kept intact for when it is restored. Within the commented Publications block, "Let Occ Flow" is further isolated in a `<template>`, and its `assets/images/letoccflow.mp4` likewise stays in the repo.

**Homepage media**: Publication thumbnails (videos/images) live in `assets/images/`, each named after the work it represents (e.g. `dimo.mp4`, `unimate.mp4`, `ttt-parkour.mp4`, `vr-robo.mp4`). Affiliation/company logos carry a `-logo` suffix (`meta-logo.png`); `princeton-logo.jpg` doubles as the favicon. Poster PDFs and the CV live in `assets/pdf/`.

**`dimo/`**: Self-contained, custom-designed project page for the DIMO paper — no Bootstrap, no shared assets. All styling is in `dimo/css/style.css` (design tokens at `:root`); markup is in `dimo/index.html`; the only script is `dimo/js/nav.js`. Loads Academicons, Font Awesome 4, and the Inter / Newsreader / Space Grotesk / Space Mono fonts from CDNs. All media and assets live flat under `dimo/assets/` — `teaser.png`, `pipeline.png`, `interpolation.mp4`, `language.mp4`, `spinner.svg`, `favicon.svg` (there is no `dimo/img/` dir and no paper PDF in the repo; the poster link points off-site).
  - **Design system**: a dark "latent-space" hero over a light "paper" body, with a reserved blue→violet→pink spectrum (`--spectrum`) used only on the title, the active nav node, the nav progress fill, and `favicon.svg`. Sections (`#demo`, `#applications`, `#abstract`, `#method`, `#poster`, `#cite`) alternate white / `--paper-2` tint for separation (no borders). Each section header is a mono `.kicker` + a `.section-title`.
  - **Signature**: the hero figure is an inline SVG (`.field`) where one origin keypoint fans into five trajectories ending in CSS/SMIL-animated stick-figure skeletons (wave/walk/kick/jump/turn). Skeleton limbs rotate via `transform-box: view-box` with per-limb `transform-origin`; `prefers-reduced-motion` freezes them and hides the traveling `.kp` dots.
  - **Side nav** (`.sidenav`): a fixed vertical "trajectory" rail in the left gutter, right-anchored so labels never crowd the content; hidden under 1440px. `nav.js` uses `IntersectionObserver` to reveal it past the hero, set the `.is-active` node, and drive the `--nav-progress` spectrum fill. Links are plain anchors, so it degrades without JS.

**`unimate/`**: Self-contained project page for the UniMate paper ("One Unified Model to Animate Diverse Skeletons"), still `<meta robots="noindex, nofollow">` (not yet public). No Bootstrap — all styling is in `unimate/style.css`; markup is in `unimate/index.html`. The interactive viewer is **no longer inline**: it is two external ES modules loaded via an importmap — `unimate/js/viewer.js` (the three@0.160.0 rendering engine) imports `EXAMPLES` from `unimate/js/examples.js` (a data-only scene catalog). `style.css` `@import`s Playfair Display (headings) + Roboto Mono (labels/mono) from Google Fonts, over a Georgia serif body.
  - **Design system**: ivory paper body background (`#fdfaf4`) with slate text and a terracotta accent (`--accent: #d97757`); palette tokens (`--ivory*`, `--slate-dark/-light`, `--accent`) live in the `:root` block near the **top** of `style.css`. A fixed left-gutter `.toc` (shown only ≥1400px) mirrors the section anchors: `#abstract`, `#examples`, `#experiments` (one-prompt-diverse-skeletons / diverse-prompts / diverse-motions), `#application` (motion-editing / -inbetweening / -expansion).
  - **Media**: affiliation logos are `unimate/assets/princeton2.png`, `mit.png`, and `ucb.svg` (Princeton / MIT / UC Berkeley); demo/result/application clips are `unimate/assets/*.mp4`, each paired with a poster frame in `unimate/assets/posters/*.jpg` (used as the `<video poster>`). There is **no** paper PDF in the repo and no `[pdf]` link. `unimate/assets/princeton.png` and `baymax.jpg` are present but currently unreferenced.
  - **Three.js viewer**: a live interactive model viewer whose scene list is a stage catalog in `examples.js` (`EXAMPLES`) — labeled stages "Bipedal", "Articulated", "Flower", "Zoo", "Humanoid Robot", "Quadruped Robot", "Baymax Robot", "Eagle", "Shark", "Michelle", each laying out one or more rigs from the ~40 files in `unimate/glbs/*.glb`; `viewer.js` normalizes, grounds, and renders them and accepts drag-and-drop of `.fbx`/`.glb`/`.gltf`. Do not delete the `.glb` files; they feed this viewer.
  - **Favicon**: `unimate/assets/favicon-baymax.png` — a Baymax raster, served as both `rel="icon"` and `rel="apple-touch-icon"` (there is no favicon SVG and no PNG-fallback `<link>`).
