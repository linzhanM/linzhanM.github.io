# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a personal academic homepage for Linzhan Mou, deployed as a GitHub Pages static site at the custom domain `linzhanmou.com`. There is no build system, no package manager, and no server-side code — the one build step in the repo is the LaTeX résumé (see `resume/latex/`).

**Domain**: the root `CNAME` holds `linzhanmou.com`. Five hostnames — `www`, both `http` variants, and `linzhanm.github.io` — each single-hop 301 to it with the path preserved, so old links keep working. `linzhanmou.com` is the only host that serves content. **Every absolute self-link must use it** (`index.html`, `resume/`, `dimo/`, `unimate/`, `sitemap.xml`, `robots.txt`, `resume/latex/resume.tex`), otherwise internal navigation pays for a redundant DNS+TLS handshake (~2× the load time). Don't delete `CNAME` — it is the switch for the whole redirect setup.

## Development

To preview locally, serve the directory with any static file server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

To deploy, commit changes and push to `main` — GitHub Pages serves the branch automatically, usually live within ~1–2 minutes. `main` **is** the deploy branch, so a feature branch does not deploy.

There is no Git LFS setup and no `.gitattributes` — all media is committed directly (videos, images, PDFs, `.glb` models). GitHub Pages cannot set response headers here, so anything header-based (HSTS, `X-Robots-Tag`) is not available; `robots.txt` and `<meta>` tags are the only levers.

## Layout

```
CNAME                       linzhanmou.com — the custom-domain switch
index.html                  Homepage — the only page with publication content
static/styles.css           Design tokens + homepage styles (hero, sections, pubs, footer)
static/custom-navbar.css    Navbar chrome only
static/nav.js               Navbar behaviour: burger toggle + section keypoint
static/resume.css           Resume-page layer (loaded by resume/index.html, incl. print sheet)
assets/                     Flat — all homepage media: thumbnails, logos, profile photo, poster PDFs
resume/index.html           Résumé page (/resume/) — unlisted, noindex
resume/resume.pdf           The served PDF; built from resume/latex/, not edited by hand
resume/latex/               resume.tex + build.sh (the only build step in the repo)
dimo/                       Self-contained DIMO project page
unimate/                    Self-contained UniMate project page
robots.txt, sitemap.xml     Search-engine metadata — see "Indexing" below
```

Four pages, in two groups. `index.html` and `resume/index.html` **share** `styles.css` + `custom-navbar.css` (so a token change reaches both); `dimo/` and `unimate/` are fully independent and share nothing with them or with each other.

The homepage renders top to bottom as: `<nav>` → `.hero` (photo + bio) → three `<section class="container page-section">` blocks (`#Publications`, `#Experience`, `#Service`) → `.site-footer`.

## Architecture

**No framework**: no templating, routing, or JS framework anywhere. Every page is hand-written HTML.

**CSS hybrid** (homepage + résumé): local stylesheets layered on a CDN-loaded Bootstrap 4 **CSS** grid (no Bootstrap/jQuery JS — neither page loads any). `static/custom-navbar.css` owns *all* navbar chrome: the sticky bar, the mobile burger, the ≥1024px flex layout, the `.nav-section` eyebrow labels, and the `.nav-keypoint` accent dot. `static/styles.css` holds the design system: a `:root` block of design tokens, base typography, and the hero / section / publication / experience / footer styles. Fonts are Fraunces (display — name and section headers) and Source Serif 4 (body), from Google Fonts; `.pub-title` overrides to Palatino Linotype. The homepage's third-party loads are exactly: Bootstrap 4 CSS, Font Awesome 5 (`.fab`/`.fas` icons in `.hero-links`), Academicons (`.ai-google-scholar`), Google Fonts, StatCounter, and four `img.shields.io` GitHub-star badges — nothing else. The star counts are **plain `<img>` badges**, which is why the old `buttons.github.io/buttons.js` was removed: it acts only on `class="github-button"` elements, and shields.io had already replaced it. Don't re-add a script for star counts. `resume/index.html` deliberately drops the two icon stylesheets, because its contact links say "Scholar"/"GitHub" in words and the icons were labelling what was already labelled.

The `:root` tokens are a system, not a loose bag — stay on them rather than hard-coding a value:
- **Surfaces** `--ivory-light/-medium/-dark`, `--accent-bg`.
- **Ink, four tiers** `--text-primary/-secondary/-tertiary`, each documented with its contrast ratio (all ≥4.5:1 AA on `--ivory-light`).
- **Radius, three steps** `--radius-sm/-md/-lg`, all fixed px on purpose — percentages resolve against the box and turn non-square elements into shape-shifting ellipses. A circle (the nav keypoint) is a shape, not a step, and stays `50%`.
- **Elevation, two layers each** `--shadow-plate` / `--shadow-lift` — a tight contact shadow plus a diffuse ambient one, so media reads as set *onto* paper rather than floating.
- **Accent** `--accent: #E77500` (Princeton orange) is for **geometry only** — rules, borders, the keypoint, link underlines. Never the colour of running text: orange dark enough to pass AA on ivory is orange gone brown.

Three rules to keep in mind when editing CSS here:
- `styles.css` loads **after** `custom-navbar.css`, so a `.navbar` rule placed in `styles.css` silently wins. Keep navbar rules in `custom-navbar.css`. `styles.css` currently has none — verify before adding.
- The one sanctioned exception: `static/resume.css` re-declares `.navbar-inner` (and hides `.navbar` in print). That is not navbar chrome, it is the résumé page *opting out* of it — it has a single link and no burger, so the flex row has to hold at every width instead of only ≥1024px. The file documents this at the rule.
- Bootstrap defines `.navbar` as `display: flex` with `padding: 0.5rem 1rem`; `custom-navbar.css` zeroes that padding and gives `.navbar-inner` `width: 100%` so it doesn't collapse to its content. Don't remove either without re-checking the layout.

**Cache busting**: the local `<link>`/`<script>` tags carry a `?v=N` query, because GitHub Pages caches aggressively. **`styles.css` and `custom-navbar.css` are referenced from two files — `index.html` and `resume/index.html` — so bump `N` in BOTH** whenever you edit either stylesheet or `nav.js`, or returning visitors keep the old file. Keep the two files' numbers **equal** for a given stylesheet: same file at the same URL means one shared cache entry instead of two fetches. Both are at `v=37`; they had drifted to 37/34 once, which left `/resume/` serving a stale `styles.css`. `resume.css` is loaded only by the résumé page and carries its own counter (`v=4`). `dimo/` and `unimate/` deliberately carry no `?v=` at all; their CSS/JS is per-page, so renaming isn't needed.

**Styling convention**: `index.html` and `resume/index.html` carry **no inline `style=` attributes and no `<br>` spacers** — every rule lives in a stylesheet behind a named class (`.hero*`, `.page-section`, `.exp-*`, `.resume-*`, `.site-footer`). Both files are currently at zero of each; keep it that way. Sections are `<section class="container page-section">`: the Bootstrap `.container` is required, because `.row` uses −15px side margins that need the container's padding to cancel them.

**JavaScript** (homepage):
- `static/nav.js` — toggles `.is-active` on `.navbar-burger` / `#navbar-main` for the mobile menu, and drives the navbar keypoint by writing `--kp-x` / `--kp-o` onto `.navbar-sections` (easing stays in CSS). Three non-obvious details, each commented at the code: the "current section" probe line **sweeps downward** as you near the bottom of the page rather than sitting under the navbar, because `#Experience` is too close to the end for its heading to ever climb that high; a document-level click listener re-measures on a `setTimeout` (not rAF, which is suspended in background tabs) because expanding an abstract moves every section below it; and the mobile menu closes itself after a jump. Nav links are plain anchors, so navigation degrades without JS.
- Inline JS in `index.html` — `display(id)` toggles a publication's abstract; an `IntersectionObserver` (`rootMargin: 200px`) plays/pauses `video.lazy-video`; a one-liner fills `#copyright-year`. StatCounter (project `12925377`) loads at the end of `<body>` — the same project also loads on `unimate/`, but not on `dimo/` or `resume/`.

**Homepage nav**: the rail holds three links — About, Research, Experience. `#About` is not a section; it is the `id` on `.hero` itself (`<div class="container hero" id="About">`). `#Publications` is labelled "Research". `#Service` exists as a section but is deliberately **not** in the nav, and the Resume link is commented out with a note explaining that it isn't a section on this page so `nav.js` would skip it.

**Publications pattern**: Publications live under `#Publications` (headed "Recent Research"; the `id` is still `Publications`), split into `.section-h3` subsections `#Vision` ("Vision & Graphics") and `#Robotics` ("Robotics & RL"). Each entry is a `.pub-row.row`: a video/image thumbnail in `.col-md-3` and details (`.pub-title` / `.pub-authors` / `.pub-venue` / `.pub-links`) in `.col-md-9`. Abstract text is hidden in a `<div id="*-abs" class="pub-abstract">` block, toggled by `onclick="display('*-abs')"`. All four live thumbnails carry `class="lazy-video"`, so the observer plays them only while on screen; the Robotics pair (`ttt-parkour`, `vr-robo`) additionally sets `preload="none"` so they don't fetch until then, while the two above the fold (`unimate`, `dimo`) keep `preload="metadata"` and `autoplay`. "Let Occ Flow" is isolated in a `<template>` (parsed but never rendered, and its video has no `lazy-video` class since it never displays); its `assets/letoccflow.mp4` stays in the repo.

**Homepage media**: Publication thumbnails live flat in `assets/`, each named after the work (e.g. `dimo.mp4`, `unimate.mp4`, `ttt-parkour.mp4`, `vr-robo.mp4`). Affiliation/company logos carry a `-logo` suffix (`meta-logo.png`); `princeton-logo.jpg` doubles as the favicon and the navbar brand mark. Poster PDFs sit alongside them. Every file in `assets/`, `dimo/assets/`, `unimate/assets/` and `unimate/assets/posters/` is currently referenced — there are no orphans, so an unreferenced file is a mistake, not spare inventory.

## Indexing

Search-engine visibility is set **per page**, and the pieces interact — read this before touching `robots.txt`, `sitemap.xml`, or a `robots` meta tag.

| Page | `robots` | `canonical` | In sitemap |
|---|---|---|---|
| `/` | (none — indexable) | `linzhanmou.com/` | yes |
| `/dimo/` | `index, follow` | `linzhanmou.com/dimo/` | yes |
| `/unimate/` | `index, follow` | `linzhanmou.com/unimate/` | yes |
| `/resume/` | `noindex, nofollow` | **none, on purpose** | no |

- **`/resume/` is kept out of search results, but stays crawlable in `robots.txt`.** These two mechanisms conflict if combined: a `Disallow` stops the fetch, so the `noindex` is never read, and the URL can linger in the index as a bare link. Crawling must be allowed for the tag to work. `resume.pdf` is the one path `Disallow`ed outright, because a PDF cannot carry a meta tag and Pages cannot send `X-Robots-Tag`.
- **No `canonical` on `/resume/`** — `canonical` asserts "index this URL", which contradicts `noindex`.
- `/resume/` and `resume.pdf` are **unlinked from the entire site** (the homepage's Resume nav link is commented out, and nothing links the PDF). They are URLs you have to know.
- The `google-site-verification` meta lives in `index.html`.
- Keep `sitemap.xml` and the meta tags in agreement: a `noindex` page must not be listed.
- **Update a page's `<lastmod>` when you change that page.** It is a recrawl signal: a stale date says "settled, don't bother", which is exactly wrong after an edit, and a date bumped without a real edit trains Google to ignore the field. Take it from `git log` on the page's file. Two traps: XML comments **cannot contain a double hyphen** (so no git flags pasted into them — this silently broke the file once), and the date must be `YYYY-MM-DD` and not in the future. Validate with `xmllint --noout sitemap.xml` before pushing.

## Résumé page (`resume/`)

Two artifacts from one source of truth, plus a shared design layer:

- **`resume/index.html`** — the HTML résumé. Loads `custom-navbar.css` + `styles.css` (shared with the homepage) then `resume.css` on top. Sections: `#education`, `#internship`, `#experience`, `#publications`, `#awards`, and Professional Service. No `nav.js`: the page is one document read top to bottom, so there is no section index, no burger, and nothing for the keypoint to track — the navbar is only the way home.
- **`static/resume.css`** — the document layer: the two-sided `.resume-row` (role left, dates right), the masthead, section rules, and a **`@media print` sheet** so Cmd-P yields the résumé rather than a screenshot of a website (chrome hidden, background flattened, `break-inside: avoid` on entries). `.resume-page` is `max-width: 60rem` — wider than a prose measure because the two-sided rows need it; the header comment explains why 47rem broke them. Its type rules deliberately spend each face once: Fraunces for the name only, Source Serif for places/roles, Palatino for publication titles — so two similar-looking 18px lines are telling you something true.
- **`resume/latex/`** — `resume.tex` (pdflatex, `libertine` + `fontawesome`) and `build.sh`, which compiles, moves the result to `resume/resume.pdf` (the served copy), then cleans every intermediate. **Run `./resume/latex/build.sh` after editing `resume.tex`** — `resume.pdf` is a build artifact and editing the `.tex` alone leaves the served PDF stale, including any URLs baked into its text layer. `resume/latex/.gitignore` ignores `*.pdf` and the latexmk intermediates as a safety net for interrupted builds, which is why only the moved `../resume.pdf` is tracked.

## `dimo/`

Self-contained, custom-designed project page for the DIMO paper — no Bootstrap, no shared assets, no `?v=` cache busting. All styling is in `dimo/css/style.css` (design tokens at `:root`); markup is in `dimo/index.html`; the only script is `dimo/js/nav.js`. Loads Academicons, Font Awesome 4, and the Inter / Newsreader / Space Grotesk / Space Mono fonts from CDNs. All media lives flat under `dimo/assets/` — `teaser.png`, `pipeline.png`, `interpolation.mp4`, `language.mp4`, `spinner.svg` (used as the two videos' `poster`), `favicon.svg`. There is no `dimo/img/` dir and no paper PDF in the repo: the arXiv, poster, and video buttons all point off-site, and `#demo` is a YouTube `<iframe>`.

- **Design system**: a dark "latent-space" hero over a light "paper" body. Tokens split the same way — `--space*` / `--on-space*` for the hero, `--paper*` / `--ink*` / `--line` for the body — plus a reserved blue→violet→pink `--spectrum` gradient used **only** on the title, the active nav node, the nav progress fill, and `favicon.svg`. Sections (`#demo`, `#applications`, `#abstract`, `#method`, `#poster`, `#cite`, in DOM order) alternate `.section` / `.section--alt` for a white / `--paper-2` tint (no borders). Each header is a mono `.kicker` + a `.section-title`.
- **Signature**: the hero figure is an inline SVG (`.field`) where one origin keypoint fans into five trajectories ending in CSS/SMIL-animated stick-figure skeletons (wave/walk/kick/jump/turn). Limbs rotate via `transform-box: view-box` with per-limb `transform-origin`; `prefers-reduced-motion` freezes them and hides the traveling `.kp` dots.
- **Side nav** (`.sidenav`): a fixed vertical "trajectory" rail in the left gutter, right-anchored so labels never crowd the content; **hidden below 1480px** (`@media (max-width: 1480px)`). `nav.js` uses one `IntersectionObserver` to reveal it once the hero leaves the viewport and another (`rootMargin: -45%/-50%`) to set the `.is-active` node and drive the `--nav-progress` spectrum fill. Links are plain anchors, so it degrades without JS.

## `unimate/`

Self-contained project page for the UniMate paper ("One Unified Model to Animate Diverse Skeletons", SIGGRAPH Asia 2026). No Bootstrap and no `?v=`; all styling is in `unimate/style.css`, markup in `unimate/index.html`. Public and indexable (see the Indexing table); `[arXiv]`, `[Dataset]`, and `[Twitter]` are present but `class="disabled"` placeholders, and there is **no** paper PDF in the repo.

- **Design system**: ivory paper body over slate text with a terracotta accent. Palette tokens (`--ivory*`, `--slate-dark/-light`, `--accent: #d97757`) live in the `:root` block near the **top** of `style.css`, which is organized into 11 numbered sections. Gotcha: `body` hard-codes `#fdfaf4` and `#1b1b1b` rather than using the tokens, so the page background is *not* `--ivory` — check which you mean before "fixing" one to match the other. `style.css` `@import`s Playfair Display (headings) + Roboto Mono (labels/mono) over a Georgia serif body.
- **TOC** (`.toc`): a fixed left-gutter rail, `display: none` until `@media (min-width: 1400px)`. It is a live progress rail, not just anchors — an inline scroll-spy adds `.active` to the link for the topmost visible section. Anchors: `#examples`, `#abstract`, `#experiments` (+ `#one-prompt-diverse-skeletons`, `#diverse-prompts`, `#diverse-motions`), `#application` (+ `#motion-editing`, `#motion-inbetweening`, `#motion-expansion`).
- **JavaScript** is split: the viewer is two external ES modules loaded via an importmap — `unimate/js/viewer.js` (the three@0.160.0 engine, from jsDelivr) imports `EXAMPLES` from `unimate/js/examples.js` (data only). But **two inline `<script>` blocks remain** at the end of `index.html`, and they are where the page's own behaviour lives. The first carries two things in one `DOMContentLoaded`: the gallery horizontal-scroll buttons, which navigate by *live* item position rather than a cached width because a video's intrinsic size isn't known that early, and an `IntersectionObserver` (`threshold: 0.15`) that plays only on-screen videos and switches every video to `controls` under `prefers-reduced-motion`. The second is the TOC scroll-spy. Then StatCounter (project `12925377`, shared with the homepage).
- **Media**: affiliation logos are `princeton.png`, `ucb.svg`, `mit.png` (Princeton / UC Berkeley / MIT, in that DOM order); demo/result/application clips are `unimate/assets/*.mp4`, each paired with a poster frame in `unimate/assets/posters/*.jpg` used as the `<video poster>`.
- **Three.js viewer**: a live interactive viewer whose scene list is a stage catalog in `examples.js` (`EXAMPLES`) — labelled stages "Bipedal", "Articulated", "Flower", "Zoo", "Humanoid Robot", "Quadruped Robot", "Baymax Robot", "Eagle", "Shark", "Michelle", each laying out one or more of the 40 rigs in `unimate/glbs/*.glb`. `examples.js` has a documented per-stage option vocabulary (`spacing`, `rowSpacing`, `scale`, `pad`, `lighting`, `evenGaps`, `sizeBy`, `stagger`, …) — read its header comment before adding a stage; layout tuning belongs there, not in the engine. `viewer.js` normalizes, grounds (a port of a Blender pipeline), and renders them, exposes a lil-gui toolbar (time scale / wireframe / lighting / shadow), and accepts drag-and-drop of `.fbx`/`.glb`/`.gltf`. Every `.glb` is referenced — do not delete them.
- **Favicon**: `unimate/assets/favicon-baymax.png`, served as both `rel="icon"` and `rel="apple-touch-icon"` (no favicon SVG, no PNG-fallback `<link>`).
