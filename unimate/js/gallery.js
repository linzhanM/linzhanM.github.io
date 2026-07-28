// ─────────────────────────────────────────────────────────────────────────────
// Video galleries — the horizontal strips under Experiments and Applications.
//
// Two jobs, both keyed to what is on screen:
//   1. scroll buttons on the galleries wide enough to overflow (VideoMimic pattern)
//   2. an IntersectionObserver that plays only the clips currently in view
//
// Neither is required to see the content: the strips scroll natively, and the
// clips carry `poster` frames, so this degrades to a plain scrollable row.
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Only galleries with enough videos to overflow keep scroll buttons.
  // Listed in DOM order.
  const galleries = [
    {
      sectionId: 'demoGallerySection',
      galleryInnerId: 'videoGalleryDemo',
      scrollLeftBtnId: 'scrollLeftBtnDemo',
      scrollRightBtnId: 'scrollRightBtnDemo'
    },
    {
      sectionId: 'promptGallerySection',
      galleryInnerId: 'videoGalleryPrompt',
      scrollLeftBtnId: 'scrollLeftBtnPrompt',
      scrollRightBtnId: 'scrollRightBtnPrompt'
    },
    {
      sectionId: 'motionGallerySection',
      galleryInnerId: 'videoGalleryMotion',
      scrollLeftBtnId: 'scrollLeftBtnMotion',
      scrollRightBtnId: 'scrollRightBtnMotion'
    }
  ];

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
    // position:relative .video-gallery-section, which is 100vw wide, while the
    // scroller below it is capped and centered — so offsetLeft carries the side
    // gutter and every target overshoots by it.
    const itemLeft = (item) =>
      item.getBoundingClientRect().left
      - container.getBoundingClientRect().left
      + container.scrollLeft;

    const nearestItemIndex = () => {
      const viewportCenter = container.scrollLeft + container.clientWidth / 2;
      let nearest = 0;
      let nearestDistance = Infinity;
      items.forEach((item, index) => {
        const itemCenter = itemLeft(item) + item.offsetWidth / 2;
        const distance = Math.abs(itemCenter - viewportCenter);
        if (distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      });
      return nearest;
    };

    const showItem = (index) => {
      targetIndex = Math.max(0, Math.min(items.length - 1, index));
      const item = items[targetIndex];
      const maxScroll = container.scrollWidth - container.clientWidth;
      const centeredLeft = itemLeft(item) - (container.clientWidth - item.offsetWidth) / 2;
      programmaticScroll = true;
      container.scrollTo({
        left: Math.max(0, Math.min(maxScroll, centeredLeft)),
        behavior: reduceMotion ? 'auto' : 'smooth'
      });
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => { programmaticScroll = false; }, 500);
    };

    // Establish the initial item after layout, then keep an explicit target
    // so rapid clicks during a smooth scroll advance rather than reselecting
    // the item that is still visually nearest.
    requestAnimationFrame(() => { targetIndex = nearestItemIndex(); });
    leftBtn.addEventListener('click', () => showItem(targetIndex - 1));
    rightBtn.addEventListener('click', () => showItem(targetIndex + 1));
    container.addEventListener('scroll', () => {
      if (!programmaticScroll) targetIndex = nearestItemIndex();
    }, { passive: true });
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
});
