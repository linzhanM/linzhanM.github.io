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

  // Only galleries with enough videos to overflow keep scroll buttons, in DOM
  // order. `autoCycle` opts a strip into the cycle below: §1, §3 and §4, the
  // Experiments rows holding more clips than fit. §2 has exactly two, so a cycle
  // has nothing to reveal (advance() bails on that too).
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

    // Position of an item inside the container's scrollable content. From the
    // rects, not offsetLeft: the videos' offsetParent is the position:relative
    // .video-gallery-section, so any difference between that box and the
    // scroller would land in every scroll target.
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
    // (the two-up rule, css §7), and centring the middle of three would cut both
    // neighbours in half — a comparison strip has to rest on whole clips.
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
    // an on-screen strip walks itself to the far end and back, a page every
    // AUTO_CYCLE_MS. The visitor always outranks it: any manual input takes the
    // wheel, and the cycle waits USER_PAUSE_MS from the last one before picking
    // up from wherever they left it. Never starts under reduced motion.
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
    // The container's scrollLeft is the one signal meaning "the visitor took the
    // strip over" — swipe, trackpad shove, horizontal wheel all land here, while
    // scrolling the page past the gallery does not. Ignore our own glide:
    // `programmaticScroll` gives up after 500ms, autoQuietUntil covers the rest.
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
      // dataset.userPaused is set by the Application control bars below: a
      // clip the visitor paused stays paused when it scrolls back into view.
      if (entry.isIntersecting && !reduceMotion && !video.dataset.userPaused) {
        video.play().catch(() => {});
      } else if (!entry.isIntersecting) {
        video.pause();
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('video').forEach((video) => {
    if (reduceMotion) video.controls = true;
    videoObserver.observe(video);
  });

  // π0.5-style figure controls (pi.website/blog/pi05) on the three Application
  // clips and only there: hovering fades in a bar along the bottom (play/pause,
  // seek, full screen), and clicking the clip toggles play/pause. The
  // Experiments strips are half-column comparison figures, where a bar each
  // would put chrome on six clips at once. Full screen goes on the CONTAINER,
  // not the video, so the bar stays usable inside it; iPhone has no element
  // fullscreen and falls back to the video's native player. Skipped under
  // reduced motion, where every video already carries native controls.
  if (!reduceMotion) {
    const fmt = (t) => (isFinite(t) && t > 0)
      ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0')
      : '0:00';
    const PLAY_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.3 10.7 6 2.5 10.7z"/></svg>';
    const PAUSE_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.4 1.5h2.4v9H2.4zM7.2 1.5h2.4v9H7.2z"/></svg>';
    const EXPAND_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true" class="app-video-stroke"><path d="M7.2 1.8h3v3M4.8 10.2h-3v-3M10.2 1.8 6.9 5.1M1.8 10.2l3.3-3.3"/></svg>';

    document.querySelectorAll('.app-row .video-gallery-container').forEach((wrap) => {
      const video = wrap.querySelector('.gallery-video');
      if (!video) return;

      const bar = document.createElement('div');
      bar.className = 'app-video-bar';
      bar.innerHTML =
        '<button class="app-video-toggle" type="button" aria-label="Play or pause">' + PAUSE_ICON + '</button>' +
        '<input class="app-video-seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Seek">' +
        '<span class="app-video-time">0:00 / 0:00</span>' +
        '<button class="app-video-fs" type="button" aria-label="Full screen">' + EXPAND_ICON + '</button>';
      wrap.appendChild(bar);

      const toggleBtn = bar.querySelector('.app-video-toggle');
      const seek = bar.querySelector('.app-video-seek');
      const time = bar.querySelector('.app-video-time');
      const fsBtn = bar.querySelector('.app-video-fs');

      // A pause the visitor asked for outranks the play-what-is-visible
      // observer above, which would otherwise restart the clip the next time
      // it scrolled into view. The flag is only ever set here.
      const togglePlay = () => {
        if (video.paused) {
          delete video.dataset.userPaused;
          video.play().catch(() => {});
        } else {
          video.dataset.userPaused = '1';
          video.pause();
        }
      };
      toggleBtn.addEventListener('click', togglePlay);
      video.addEventListener('click', togglePlay);
      video.title = 'Click to play or pause';

      video.addEventListener('play', () => { toggleBtn.innerHTML = PAUSE_ICON; });
      video.addEventListener('pause', () => { toggleBtn.innerHTML = PLAY_ICON; });

      // The thumb rides requestAnimationFrame, not `timeupdate` — that fires
      // ~4×/s, which steps it across a 25s clip in visible jumps. The loop runs
      // only between play and pause, and leaves the thumb alone while the
      // visitor scrubs, so the two never fight over it.
      let scrubbing = false;
      let rafId = 0;
      const paint = () => {
        if (!scrubbing && video.duration) {
          seek.value = (video.currentTime / video.duration) * 100;
          time.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
        }
      };
      const loop = () => { paint(); rafId = requestAnimationFrame(loop); };
      video.addEventListener('play', () => { cancelAnimationFrame(rafId); loop(); });
      video.addEventListener('pause', () => { cancelAnimationFrame(rafId); rafId = 0; paint(); });
      video.addEventListener('loadedmetadata', paint);
      // Mid-drag seeks take fastSeek where the browser has it: landing on the
      // nearest keyframe is what keeps the picture moving under the thumb.
      // The release (change) seeks precisely.
      seek.addEventListener('pointerdown', () => { scrubbing = true; });
      seek.addEventListener('input', () => {
        if (!video.duration) return;
        const t = (seek.value / 100) * video.duration;
        if (scrubbing && video.fastSeek) video.fastSeek(t);
        else video.currentTime = t;
        time.textContent = fmt(t) + ' / ' + fmt(video.duration);
      });
      const endScrub = () => {
        if (!scrubbing) return;
        scrubbing = false;
        if (video.duration) video.currentTime = (seek.value / 100) * video.duration;
      };
      seek.addEventListener('pointerup', endScrub);
      seek.addEventListener('pointercancel', endScrub);
      seek.addEventListener('change', endScrub);

      fsBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else if (wrap.requestFullscreen) {
          wrap.requestFullscreen().catch(() => {});
        } else if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      });
    });
  }

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
