// Side navigation: reveal once the hero scrolls away, highlight the section
// in view, and grow the progress fill to it. Pure enhancement — the links are
// plain anchors and work without JS.
(function () {
  const sidenav = document.querySelector('.sidenav');
  const hero = document.querySelector('.hero');
  if (!sidenav) return;

  // Section element -> its nav link; a link whose id is missing is not tracked.
  const links = new Map();
  sidenav.querySelectorAll('a[href^="#"]').forEach((a) => {
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (el) links.set(el, a);
  });
  if (!links.size) return;

  const list = sidenav.querySelector('ul');

  // Grow the progress fill (.sidenav ul::after) to the active node's centre.
  // 17 is that rule's `top` offset — change them together.
  const setProgress = (link) => {
    if (!list) return;
    const center = link.offsetTop + link.offsetHeight / 2;
    list.style.setProperty('--nav-progress', `${Math.max(0, center - 17)}px`);
  };

  // The active section is the one crossing a thin band at the viewport's
  // vertical middle (the rootMargin below).
  const spy = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const active = links.get(e.target);
      if (!active) return;
      links.forEach((a) => a.classList.toggle('is-active', a === active));
      setProgress(active);
    });
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

  links.forEach((_, section) => spy.observe(section));

  // Reveal the nav only once the hero has left the viewport.
  if (hero) {
    new IntersectionObserver((entries) => {
      sidenav.classList.toggle('is-visible', !entries[0].isIntersecting);
    }, { threshold: 0.12 }).observe(hero);
  } else {
    sidenav.classList.add('is-visible');
  }
})();
