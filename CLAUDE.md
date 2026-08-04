# CLAUDE.md

Guidance for Claude Code working in this repo. It records the **non-obvious** — constraints, traps, and decisions that would otherwise be re-litigated. Structure, file lists and rationale that are already legible in the source or its comments are deliberately not repeated here; read the files.

## Overview

Personal academic homepage for Linzhan Mou, served by GitHub Pages at `linzhanmou.com`. **No build system, no package manager, no server-side code** — the one build step is the LaTeX résumé. Preview with `python3 -m http.server 8000`. Deploy by pushing to `main`; a feature branch does not deploy. All media is committed directly (no LFS). Pages cannot set response headers, so `robots.txt` and `<meta>` are the only levers.

**Domain**: root `CNAME` holds `linzhanmou.com`; `www`, both `http` variants and `linzhanm.github.io` each 301 to it. Don't delete `CNAME`. **Every absolute self-link must use `linzhanmou.com`** — any other host costs a redundant DNS+TLS handshake (~2× load time).

## Layout and conventions

Five pages in two groups. `index.html`, `publications.html`, `resume.html` sit at the root and **share** `css/styles.css` + `css/custom-navbar.css` + `js/nav.js` **and the navbar markup itself**, so a difference between their navbars is a bug, not a variant. `dimo/` and `unimate/` are fully self-contained and share nothing with them or each other.

**Media convention, all three trees**: `assets/` is split by type — `videos/`, `images/`, `logos/`, `posters/` — and only the types a page has are present. New media goes in the folder for its type; never loose in an `assets/` root. Every file under `assets/**` is currently referenced, so an unreferenced file is a mistake, not spare inventory.

**Directory names are public URLs.** `/dimo/` and `/unimate/` are in `sitemap.xml`, carry `canonical` tags, and are linked off-site; the three root pages must stay at the root for Pages to serve them. Reorganize freely *inside* those directories — moving the directories breaks live links.

**Cache busting**: local `<link>`/`<script>` carry `?v=N`, because Pages caches aggressively.
- `styles.css`, `custom-navbar.css`, `nav.js` are referenced from **all three root pages — bump N in all three**, and keep the numbers equal so one URL means one cache entry. They drifted once and left the résumé on a stale stylesheet.
- `resume.css` and `publications.css` are single-page and carry their own counters. `dimo/` uses no `?v=` at all.
- `unimate/` versions **everything local, including every ES-module import** (entry → `viewer.js` → `examples.js` → `showcase.js`). Bump at each import site and walk the bump up to the HTML — a stale module is a broken viewer, not a stale style. See `unimate/README.md`.

**Styling**: `index.html` and `resume.html` carry **no inline `style=` and no `<br>` spacers** — both are at zero of each; keep it that way. Sections are `<section class="container page-section">`; the Bootstrap `.container` is required because `.row`'s −15px margins need its padding to cancel them.

## Root-page architecture

Hand-written HTML on a CDN Bootstrap 4 **CSS** grid — no Bootstrap/jQuery JS anywhere. Third-party loads on the homepage are exactly: Bootstrap CSS, Font Awesome 5, Academicons, Google Fonts, StatCounter, and four `img.shields.io` star badges. Those badges are **plain `<img>`** — don't re-add a script for star counts. `resume.html` and `publications.html` deliberately drop the two icon stylesheets (their links are words).

**Design tokens** (`:root` in `styles.css`) are a system — stay on them rather than hard-coding:
- **Radius** is three fixed-px steps on purpose; percentages resolve against the box and turn non-square elements into shape-shifting ellipses. A circle (the nav keypoint) is a shape, not a step, and stays `50%`.
- **Elevation** is two layers each (tight contact + diffuse ambient), so media reads as set *onto* paper.
- **Accent `#E77500` is for geometry only** — rules, borders, the keypoint, link underlines. Never the colour of running text: orange dark enough to pass AA on ivory is orange gone brown.

**Three CSS rules to keep in mind**:
- `styles.css` loads **after** `custom-navbar.css`, so a `.navbar` rule placed there silently wins. Keep navbar chrome in `custom-navbar.css`; `styles.css` currently has none.
- `resume.css` touches the navbar only to hide it in `@media print`. Don't reintroduce a per-page navbar layer — the pages share the markup.
- Bootstrap defines `.navbar` as flex with `0.5rem 1rem` padding; `custom-navbar.css` zeroes it and gives `.navbar-inner` `width: 100%`. Don't remove either without re-checking layout.

### Nav and the keypoint (`js/nav.js`)

The rail is a **section index**. Adding a link means adding a section with a matching `id`, or it is inert. `#About` is the `id` on `.hero` itself. Publications and Resume are *pages*, so nav.js skips them when tracking; each page marks its own link `is-active` + `aria-current` in markup, which is what the keypoint reads. The homepage and `publications.html` run About + Publications; **Resume is on neither** — only the résumé's own rail carries it (belt-and-braces alongside its `noindex`).

**Cross-page keypoint continuity** is the one piece spanning documents, and it is ordering-sensitive. Each page stores the **label text** (not an index) of the link the dot ended under; the next page places the dot there before moving it to its own, so the glide is just the existing CSS transition given a different start. Four things hold it up: the placement is wrapped in `.is-instant` (zeroing transitions) so arriving isn't itself animated; a **forced reflow** (`void rail.offsetWidth`) between the two writes is required or the browser coalesces them and nothing animates; the key is the label so it survives differing rails; and the whole block must stay **above** the `!targets.length` early return, since the résumé calls `moveKeypoint()` from inside that branch.

### Section reveal

Sections unfold as they reach the viewport; **nothing above the first section animates** — the hero and résumé masthead are what the visitor came for and the only blocks certain to be on screen. Timing is **derived, not picked**: it runs on the keypoint's clock (420ms travel / 220ms fade) with the overshoot removed, and 10px of travel rather than the 16px every template repeats. Retime it against the keypoint or the two visibly disagree.

Four load-bearing details, three of them about never showing a blank page:
- The hidden state is gated behind **`.js-anim`**, set by an inline script in each `<head>`. It must stay in the head, and it means the hidden state exists *only* when JS runs — an unconditional `opacity: 0` would leave a JS-off page permanently blank.
- Sections already in the viewport are revealed from their **own measured `getBoundingClientRect()`**, not the observer's first callback, so nothing above the fold depends on the observer firing.
- `animation-fill-mode: backwards` keeps the from-state in the keyframe only.
- A **3s failsafe**, plus no-`IntersectionObserver` / reduced-motion paths, reveal everything; `@media print` overrides the hidden state outright, since paper has no second chance.

Verify by finishing all animations and confirming `opacity: 1`, and by removing `.js-anim` and confirming nothing is hidden.

## Indexing

| Page | `robots` | `canonical` | In sitemap |
|---|---|---|---|
| `/`, `/publications.html`, `/dimo/`, `/unimate/` | indexable | yes | yes |
| `/unimate/interactive.html` | `noindex, follow` | none | no |
| `/resume.html` | `noindex, nofollow` | **none, on purpose** | no |

- `/resume.html` is kept out of results but stays **crawlable** in `robots.txt`. The two mechanisms conflict: a `Disallow` stops the fetch, so the `noindex` is never read and the URL can linger as a bare link. `resume.pdf` is the one path `Disallow`ed outright, because a PDF can't carry a meta tag.
- No `canonical` on `/resume.html` — it asserts "index this URL", contradicting `noindex`. Don't link `resume.pdf` from an indexable page.
- Keep `sitemap.xml` and the meta tags in agreement, and **update a page's `<lastmod>` when you change it** (take the date from `git log`) — a stale date says "settled", a date bumped without an edit trains Google to ignore the field. Two traps: XML comments **cannot contain a double hyphen**, and the date must be `YYYY-MM-DD`, not future. Validate with `xmllint --noout sitemap.xml`.

## Résumé

Two artifacts from one source. `resume.html` loads the shared trio then `resume.css`; its sections are headings, not nav targets. `resources/resume/` holds `resume.tex`, the served `resume.pdf`, and `build.sh` — **run `./resources/resume/build.sh` after editing `resume.tex`**, or the served PDF (and the URLs baked into its text layer) goes stale.

`css/resume.css` spends each face exactly once — Fraunces for the name, Source Serif for places/roles, Palatino for publication titles — so two similar 18px lines are telling you something true. `.resume-pdf` is a **control, not a link**: its fill is a 9% `color-mix` of `--accent`, *not* `--accent-bg` (that token on this page is ~1.02:1 and never appears), it takes `--radius-md`, and hover draws its ring with `box-shadow: inset` — a real border reflows the contact line on every hover. Its mark is inline SVG because this page drops the icon stylesheets.

## `dimo/`

Self-contained and custom-designed: dark "latent-space" hero over a light "paper" body, tokens split the same way, and a reserved blue→violet→pink `--spectrum` gradient used **only** on the title, the active nav node, the progress fill, and the favicon. The hero figure is an inline SVG whose limbs rotate via `transform-box: view-box`; reduced motion freezes them. The side nav is hidden below 1480px. Figure captions follow the paper's own form: a bold run-in naming the application, then the mechanism in one muted sentence.

## `unimate/`

Two pages over one viewer engine: the project page and `interactive.html` (a full-screen "Motion Lab", dark chrome, `noindex`, not in the sitemap). `css/style.css` is organized into numbered sections; `responsive.css` loads last.

**One measure**: `.main-content` is 960px and *nothing* is wider — `--column` is that measure as a value. Two gotchas: `--column` is off by a classic scrollbar's width (`100vw` counts it, layout doesn't), so anything exact takes a **percentage** instead; and `body` hard-codes its own background rather than using the tokens, so the page background is *not* `--ivory` — check which you mean before "fixing" one to match the other.

**Figure edges**: gallery clips carry a **1.5px `--slate-light` frame**; the teaser carries none. This is load-bearing, not decoration — the renders are white to the pixel at all four edges against a near-white page (~1.03:1), so only the drop shadow separates them, and it is offset 4px *down*: the bottom reads and the top dissolves. A `1px --rule` hairline (too faint) and `1.5px #000` (reads as a fence under the ink section plate) were both tried and rejected; an inset `box-shadow` ring does not paint over `<video>` at all.

**Experiments** run as four numbered subsections, all styled identically — §1 is the breadth gallery, §2–4 are controlled studies that are **two-up** (half the column each), so a strip always rests on two whole clips rather than showing half of a third. Clip sizes are given as **widths**, not heights: the clips are 1.75:1 and deriving one from the other drifted every time the border changed. §1 was twice given a treatment marking it as a lead-in and both read as broken; keep them uniform.

**Dataset** (`#dataset`) is the **last** content section, though the paper puts it at Sec. 4 — the visitor meets the model first and the corpus as supporting material. It is one real `<table>` set as a paper's algorithm float (caption above, rules top and bottom, numbered mono lines, no frame), because the content is genuinely tabular *words* that must stay selectable. Four things are load-bearing: the sigil (`−` `+` `→`) is **per line, not per pass**; `.algo-out` is **left-aligned** so every sigil stacks on one rail; the group headers are **function signatures** that chain, so numbering runs unbroken; and the five filtering stages come from **Appendix A.2, not §4**, which compresses them to four. Don't put numbers here that aren't in the paper.

**Application schematics** (`schematics.css` + inline SVG): each clip runs beside a portrait plate — the clip is the evidence, the drawing is the claim. **One convention across all three: ink is what you hand the model, accent is what it returns**, and accent here is *not* the page terracotta (`.app-row` re-points `--accent` at a slate blue, so the plates read as instruments). Each plate runs **one master clock** with every track an explicit window inside it — a track with a period of its own is what makes a plate come apart at the loop. On the expansion plate colour is a **state**, not a class (a figure is accent only while its motion is generating), which works only because its bones inherit the group `stroke`. Easing is **per keyframe**, not per track. The clips were rendered with their own titles baked in; a white patch covers them, and its geometry is **measured, not eyeballed** — re-measure before resizing, delete it if the videos are ever re-rendered without titles.

**The rig-drawing trap that cost a rebuild**: `transform-box: view-box` resolves `transform-origin` against the **root viewBox**, not the rig's local space, so inside a translated/scaled group every pivot lands off the body. Bones are therefore drawn so each joint *is* a corner of that bone's own box, with `transform-box: fill-box` pivots. Keep that true when editing a pose.

### Viewer engine

`examples.js` is the **data-only catalog, shared by both pages**; the two entry modules differ only in viewer config, and per-page framing goes in `stage-tuning.js` (keyed by stage label), **never a forked catalog**. `viewer-presets.js` holds `HIDDEN_CATEGORIES`. Hiding is **by label and filters the catalog before anything else reads it**, so a hidden stage costs nothing — but that is the trap: **hiding whatever stands first also changes what both pages open on**, and the lab's `#stage-name` first paint has to move with it. The Categories count is written from the data — don't maintain it by hand. Read the option vocabulary in the `examples.js` header before adding a stage; layout tuning belongs there, not in the engine. Every `.glb` is referenced — don't delete them.

**Prompts are content**, so they live in `unimate/resources/prompts.json`, keyed by glb filename; `examples.js` carries a `prompt` only to override (`''` suppresses). House style is the paper's own captioning format (Appendix A.5): `'An [object type] [action].'` — one sentence, under 12 words, one dominant action, no adverbs, the object named concretely. **Never invent a prompt from a filename.** Two ways to find out what a clip does, and `prompts.json` records which was used (`_from_caption` = the original): 23 rigs are captioned in `assets/videos/diverse-1..3.mp4` and the `prompt-*` clips (pull a frame with ffmpeg — the posters are t=0 and blank); for the rest, render the motion headlessly in Blender. That pass corrected real guesses (`ironman-walk` and `quadruped` walk **in place**, `whale` never travels, `dragon-fire` hovers). A render shows the motion but **not the dataset's word for it**, which is the failure mode that actually bit — reach for a verb already attested in `_from_caption` before coining a precise one.

**The label solver** places each chip in one of four slots scored by how much *model* it would cover (the toolbar counts as an obstacle, or a chip under it picks "above" and gets shoved across the frame), then resolves collisions near→far along the chip's own axis, snaps near-equal chips to a shared baseline, eases toward the target, and recedes with depth measured as a **fraction** of the nearest chip's distance. The leader is load-bearing, not decoration: chips dodge each other, so without it a lifted chip reads as belonging to whatever it ended up over. Both ends are **static** under a still camera — a version tracking the live pose was tried and removed, since a marker twitching with the animation reads as noise. Box sizes are **cached**, so anything changing a chip's size must re-measure; the anchor rides the **75th-percentile** per-frame mesh top, not the max, which one extreme frame would set.

**The lab shows one prompt at a time instead**, as a tooltip beside the cursor (`hoverPrompts`). Three pieces must agree: a `pointermove` listener raycasts and stores the rig index; `applyLabels()` hides every other chip; and `updateLabels()` takes an **early-return branch** that places the survivor beside the cursor and hides the pins. That branch returns before the anchored solver runs, so **none of the machinery above executes in the lab** — don't add lab behaviour below it expecting to be reached.

> **Known gap (not implemented).** The pick runs *only* on `pointermove`, but rigs walk and auto orbit sweeps the stage past a still cursor, so the prompt goes stale until the pointer moves again. Fixing it means driving the pick from the render loop with some hysteresis, testing against `localBoxFull` (it spans every frame, so it covers a travelling rig's whole corridor).

**The stage rail** is a **ruled register** — full-bleed rows with a hairline above each, which is what keeps a row from reading as a prompt chip. It replaced a sheet of framed cells that read as an unfinished table. The selected row's plate is drawn by **`::before` inset inside the row, never a border or margin**, both of which change the row's main-axis size and would re-cut all fifteen lines on every selection. Below 720px it becomes a horizontal strip and **keeps the pill** — none of the register survives being laid on its side.

**Galleries and TOC**: `gallery.js` navigates by *live* item position (a video's intrinsic size isn't known early), plays only on-screen clips, and gives the three **Application clips only** a π0.5-style control bar — the Experiments strips are comparison figures and chrome on six clips at once is noise. Full screen goes on the **container**, not the video, so the bar stays usable. Scroll targets are **left-aligned, not centred** (centring the middle of three would cut both neighbours in half). Auto-cycling strips always yield to the visitor, and the yield signal is the container's own `scroll`, not `wheel`/`touchstart`, which also fire when merely scrolling the page past the gallery.

## Verification gotchas

An automated tab often isn't painting, so **`IntersectionObserver` never fires there** — below-fold sections look stuck until the 3s failsafe, and gallery clips won't autoplay. A synthetic click carries no user activation, so `requestFullscreen` can reject. For the nav keypoint, read `getAnimations()[0].effect.getKeyframes()` rather than sampling `getComputedStyle().transform`, which sits frozen at the start value and looks like a bug that isn't there. In all three cases: the harness, not the code.
