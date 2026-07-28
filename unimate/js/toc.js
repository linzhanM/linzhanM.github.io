// ─────────────────────────────────────────────────────────────────────────────
// TOC rail (.toc) — two independent jobs, both keyed to scroll position.
// Neither is required to navigate: the rail's links are plain anchors, and the
// rail itself is hidden below 1400px.
//
//   1. scrollSpy()        — light up the link beside the section being read
//   2. collisionWatcher() — fade the rail out while a full-bleed gallery runs
//                           underneath it
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  const toc = document.querySelector('.toc');
  if (!toc) return;

  /* 1. Scroll-spy — light up the link beside the section being read. */
  (function scrollSpy() {
    const links = [...toc.querySelectorAll('a')];
    // Each tracked section element -> its link, kept in document order.
    const sections = new Map();
    links.forEach((a) => {
      const el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) sections.set(el, a);
    });
    if (!sections.size) return;

    const visible = new Set();
    const setActive = (a) => {
      if (a) links.forEach((l) => l.classList.toggle('active', l === a));
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
      // Active = the topmost section whose heading sits in the upper viewport band.
      for (const [el, a] of sections) {
        if (visible.has(el)) { setActive(a); return; }
      }
    }, { rootMargin: '0px 0px -78% 0px', threshold: 0 });

    sections.forEach((_, el) => observer.observe(el));
    setActive(sections.values().next().value);   // default to the first section
  })();

  /* 2. Collision watcher — the galleries are full-bleed (100vw) while the
     rail is fixed in the left gutter, so a wide strip ends up running
     underneath it. Fade the rail out (.toc.is-eclipsed) while that lasts.
     Measured rather than breakpointed: whether a gallery reaches the
     gutter depends on how wide its clips are, and they differ. */
  (function collisionWatcher() {
    const strips = [...document.querySelectorAll('.video-gallery-container')]
      .map((el) => ({ frame: el, clips: [...el.querySelectorAll('.gallery-video')] }))
      .filter((strip) => strip.clips.length);
    if (!strips.length) return;

    // Grow each strip vertically so the rail doesn't blink back on in the
    // short caption/heading gap between two consecutive galleries.
    const BLEED = 90;
    // getBoundingClientRect stops at the border box, but the clips' 12px
    // drop shadow is just as visible over the rail.
    const SHADOW = 12;

    // What a strip actually paints. NOT its frame: that is a fixed 1150px
    // centred box, so on the single-clip Applications galleries the frame
    // reaches the gutter while the clip itself is nowhere near it. Measure
    // the clips, then clamp to the frame, which is what crops them once
    // the strip is scrolled horizontally.
    function paintedRect(strip) {
      const frame = strip.frame.getBoundingClientRect();
      let left = Infinity, right = -Infinity;
      for (const clip of strip.clips) {
        const r = clip.getBoundingClientRect();
        if (!r.width) continue;            // not laid out yet
        left = Math.min(left, r.left);
        right = Math.max(right, r.right);
      }
      if (left === Infinity) return null;
      return {
        left: Math.max(left - SHADOW, frame.left),
        right: Math.min(right + SHADOW, frame.right),
        top: frame.top - BLEED,
        bottom: frame.bottom + BLEED,
      };
    }

    const overlaps = (a, b) =>
      a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;

    let queued = false;
    function update() {
      queued = false;
      if (getComputedStyle(toc).display === 'none') return;   // rail is off below 1400px
      const rail = toc.getBoundingClientRect();
      toc.classList.toggle('is-eclipsed', strips.some((strip) => {
        const painted = paintedRect(strip);
        return painted !== null && overlaps(painted, rail);
      }));
    }
    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(update);
    }

    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    addEventListener('load', schedule);        // posters settle the clips' widths
    // rAF is suspended in a background tab, so a scroll that lands while
    // the tab is hidden leaves the rail stale. Re-check on the way back.
    addEventListener('visibilitychange', schedule);
    update();
  })();
});
