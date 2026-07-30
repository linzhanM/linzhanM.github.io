// Side navigation: reveal once the hero scrolls away, and highlight the
// section currently in view. Links work without JS; this is pure enhancement.
(function () {
  const sidenav = document.querySelector('.sidenav');
  const hero = document.querySelector('.hero');
  if (!sidenav) return;

  // Each tracked section element -> its nav link, kept in document order.
  const links = new Map();
  sidenav.querySelectorAll('a[href^="#"]').forEach((a) => {
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (el) links.set(el, a);
  });
  if (!links.size) return;

  const list = sidenav.querySelector('ul');

  // Grow the spectrum progress fill down to the active node's centre.
  const setProgress = (link) => {
    if (!list) return;
    const center = link.offsetTop + link.offsetHeight / 2;
    list.style.setProperty('--nav-progress', `${Math.max(0, center - 17)}px`);
  };

  // Highlight the section nearest the viewport's vertical middle.
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

  // Reveal the nav only after the hero leaves the viewport.
  if (hero) {
    new IntersectionObserver((entries) => {
      sidenav.classList.toggle('is-visible', !entries[0].isIntersecting);
    }, { threshold: 0.12 }).observe(hero);
  } else {
    sidenav.classList.add('is-visible');
  }
})();
