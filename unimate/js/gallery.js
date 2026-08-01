// ─────────────────────────────────────────────────────────────────────────────
// Video galleries — the horizontal strips under Experiments and Applications.
//
// Three jobs, all keyed to what is on screen:
//   1. scroll buttons on the galleries wide enough to overflow (VideoMimic pattern)
//   2. a ping-pong auto-cycle on the multi-clip Experiments strips, so the row
//      shows that it holds more than what is on screen — it yields to the
//      visitor for USER_PAUSE_MS whenever they drive it themselves
//   3. an IntersectionObserver that plays only the clips currently in view
//
// None of it is required to see the content: the strips scroll natively, and the
// clips carry `poster` frames, so this degrades to a plain scrollable row.
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Only galleries with enough videos to overflow keep scroll buttons.
  // Listed in DOM order. `autoCycle` opts a strip into the auto-cycle below:
  // §1, §3 and §4, the Experiments rows that hold more clips than fit. §2 is the
  // one three-clip-wide row that isn't — it has exactly two, so there is nothing
  // for a cycle to reveal (advance() bails on that too).
  const galleries = [
    {
      sectionId: 'demoGallerySection',
      galleryInnerId: 'videoGalleryDemo',
      scrollLeftBtnId: 'scrollLeftBtnDemo',
      scrollRightBtnId: 'scrollRightBtnDemo',
      autoCycle: true
    },
    {
      sectionId: 'promptGallerySection',
      galleryInnerId: 'videoGalleryPrompt',
      scrollLeftBtnId: 'scrollLeftBtnPrompt',
      scrollRightBtnId: 'scrollRightBtnPrompt',
      autoCycle: true
    },
    {
      sectionId: 'motionGallerySection',
      galleryInnerId: 'videoGalleryMotion',
      scrollLeftBtnId: 'scrollLeftBtnMotion',
      scrollRightBtnId: 'scrollRightBtnMotion',
      autoCycle: true
    }
  ];

  const AUTO_CYCLE_MS = 6000; // one page's worth of watching before the strip moves on
  const USER_PAUSE_MS = 6000; // hands off for this long after the visitor drives

  galleries.forEach((cfg) => {
    const section = document.getElementById(cfg.sectionId);
    if (!section) return;
    const container = section.querySelector('.video-gallery-container');
    const inner = document.getElementById(cfg.galleryInnerId);
    const leftBtn = document.getElementById(cfg.scrollLeftBtnId);
    const rightBtn = document.getElementById(cfg.scrollRightBtnId);
    if (!(container && inner && leftBtn && rightBtn)) return;

    const items = [...inner.querySelectorAll('.gallery-video')];
    if (!items.length) return;

    // Do not cache a video's width here: at DOMContentLoaded its intrinsic
    // dimensions may not be known yet, so width:auto can briefly measure as
    // only a few pixels. Navigate to the live position of a specific item
    // instead, which also handles galleries whose videos have different widths.
    let targetIndex = 0;
    let programmaticScroll = false;
    let scrollTimer;

    // Position of an item inside the container's scrollable content. Measure
    // it from the rects, not offsetLeft: the videos' offsetParent is the
    // position:relative .video-gallery-section, so offsetLeft is relative to
    // that box rather than to the scroller, and any difference between the two
    // (the section was 100vw at one point) lands in every scroll target.
    const itemLeft = (item) =>
      item.getBoundingClientRect().left
      - container.getBoundingClientRect().left
      + container.scrollLeft;

    // The clip currently leading the view — the one whose left edge the strip
    // is parked on.
    const leadItemIndex = () => {
      let lead = 0;
      let leadDistance = Infinity;
      items.forEach((item, index) => {
        const distance = Math.abs(itemLeft(item) - container.scrollLeft);
        if (distance < leadDistance) {
          lead = index;
          leadDistance = distance;
        }
      });
      return lead;
    };

    // Where the track has to sit for `index` to lead the view, clamped to the
    // ends. Left-aligned, not centred: §2-4 fit exactly two clips in the column
    // (see the two-up rule in css §7), and centring the middle one of three
    // would cut both its neighbours in half — a comparison strip has to rest on
    // whole clips. On the wider §1 clips it is the same trade, one clip whole
    // instead of two halves.
    const scrollTargetFor = (index) => {
      const item = items[Math.max(0, Math.min(items.length - 1, index))];
      const maxScroll = container.scrollWidth - container.clientWidth;
      return Math.max(0, Math.min(maxScroll, itemLeft(item)));
    };

    // The next index in `dir` that actually moves the strip. At the end of a row
    // the last clips share one clamped position — a two-up strip of three rests
    // on clips 2 and 3 for both index 1 and index 2 — and stepping onto one of
    // those would spend a click, or an auto-cycle beat, going nowhere.
    const stepIndex = (from, dir) => {
      const here = scrollTargetFor(from);
      for (let i = from + dir; i >= 0 && i < items.length; i += dir) {
        if (Math.abs(scrollTargetFor(i) - here) >= 1) return i;
      }
      return from;
    };

    const showItem = (index) => {
      targetIndex = Math.max(0, Math.min(items.length - 1, index));
      programmaticScroll = true;
      container.scrollTo({
        left: scrollTargetFor(targetIndex),
        behavior: reduceMotion ? 'auto' : 'smooth'
      });
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => { programmaticScroll = false; }, 500);
    };

    // A row whose clips run past the edge doesn't always read as scrollable, so
    // while one of these strips is on screen it walks itself to the far end and
    // back, on a loop, a page every AUTO_CYCLE_MS. The visitor always outranks
    // it: any manual input — a nav button, a scroll of the strip — takes the
    // wheel and the cycle waits USER_PAUSE_MS from the last one before picking
    // up again, from wherever they left it. Under prefers-reduced-motion it
    // never starts.
    let autoTimer = 0;       // the running cycle, 0 while idle
    let resumeTimer = 0;     // pending restart after the visitor's turn
    let autoStep = 1;        // ping-pong direction; flips at either end of the row
    let autoQuietUntil = 0;  // scrolls before this are the tail of our own glide
    let onScreen = false;
    const autoCycles = cfg.autoCycle && !reduceMotion && items.length > 1;

    const runCycle = () => {
      if (autoCycles && onScreen && !autoTimer && !resumeTimer) {
        autoTimer = window.setInterval(advance, AUTO_CYCLE_MS);
      }
    };
    const haltCycle = () => {
      window.clearInterval(autoTimer);
      autoTimer = 0;
    };
    // Hand the strip to the visitor. Each new input re-arms the wait, so a burst
    // of clicks buys one pause, not one per click.
    const yieldToUser = () => {
      if (!autoCycles) return;
      haltCycle();
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => { resumeTimer = 0; runCycle(); }, USER_PAUSE_MS);
    };

    function advance() {
      if (container.scrollWidth - container.clientWidth < 1) return;  // nothing to reveal
      // stepIndex already skips the positions that would not move; when it
      // has nothing left in this direction we are at an end, so turn round.
      let next = stepIndex(targetIndex, autoStep);
      if (next === targetIndex) {
        autoStep = -autoStep;
        next = stepIndex(targetIndex, autoStep);
      }
      if (next === targetIndex) return;
      autoQuietUntil = performance.now() + 1500;
      showItem(next);
    }

    // Establish the initial item after layout, then keep an explicit target
    // so rapid clicks during a smooth scroll advance rather than reselecting
    // the item that is still leading the view.
    requestAnimationFrame(() => { targetIndex = leadItemIndex(); });
    leftBtn.addEventListener('click', () => { yieldToUser(); showItem(stepIndex(targetIndex, -1)); });
    rightBtn.addEventListener('click', () => { yieldToUser(); showItem(stepIndex(targetIndex, 1)); });
    // The container's scrollLeft is the one signal that means "the visitor took
    // the strip over" — a swipe, a trackpad shove, a horizontal wheel all land
    // here, while merely scrolling the page past the gallery does not. Ignore it
    // during our own glide: `programmaticScroll` gives up after 500ms, which a
    // smooth scroll can outlast, so autoQuietUntil covers the rest.
    container.addEventListener('scroll', () => {
      if (programmaticScroll) return;
      if (performance.now() > autoQuietUntil) yieldToUser();
      targetIndex = leadItemIndex();
    }, { passive: true });

    if (autoCycles) {
      // Run only while the strip is on screen: the hint is for someone looking
      // at it, and a visitor scrolling back should not find it parked somewhere
      // they never saw it travel to.
      const viewObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          onScreen = entry.isIntersecting;
          if (onScreen) runCycle(); else haltCycle();
        });
      }, { threshold: 0.35 });
      viewObserver.observe(container);
    }
  });

  // Load and play only videos that are actually visible. Off-screen clips
  // pause immediately, avoiding simultaneous downloads and decoding work.
  const videoObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const video = entry.target;
      if (entry.isIntersecting && !reduceMotion) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('video').forEach((video) => {
    if (reduceMotion) video.controls = true;
    videoObserver.observe(video);
  });

  // Application diagrams are explanations, not ambient decoration. Start each
  // one at the beginning when it enters the viewport so the reader always sees
  // the task in order: input first, generated motion second. Off-screen clocks
  // stay paused instead of consuming work or drifting to an arbitrary phase.
  if (!reduceMotion) {
    const diagramObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const animations = entry.target.getAnimations({ subtree: true });
        if (entry.isIntersecting) {
          animations.forEach((animation) => {
            animation.currentTime = 0;
            animation.play();
          });
        } else {
          animations.forEach((animation) => animation.pause());
        }
      });
    }, { threshold: 0.2 });

    document.querySelectorAll('.app-diagram').forEach((diagram) => {
      // CSS animations begin running as soon as styles resolve. Pause them
      // immediately; the observer above owns their visible lifecycle.
      diagram.getAnimations({ subtree: true }).forEach((animation) => animation.pause());
      diagramObserver.observe(diagram);
    });
  }
});
