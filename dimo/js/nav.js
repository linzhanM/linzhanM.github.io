// Side navigation: reveal once the hero scrolls away, and highlight the
// section currently in view. Links work without JS; this is pure enhancement.
(function () {
  var sidenav = document.querySelector('.sidenav');
  var hero = document.querySelector('.hero');
  if (!sidenav) return;

  var links = {};
  sidenav.querySelectorAll('a[href^="#"]').forEach(function (a) {
    links[a.getAttribute('href').slice(1)] = a;
  });

  var sections = Object.keys(links)
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);

  var list = sidenav.querySelector('ul');

  // Grow the spectrum progress fill down to the active node's centre.
  function setProgress(link) {
    if (!list) return;
    var center = link.offsetTop + link.offsetHeight / 2;
    list.style.setProperty('--nav-progress', Math.max(0, center - 17) + 'px');
  }

  // Highlight the section nearest the viewport's vertical middle.
  var spy = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      Object.keys(links).forEach(function (id) { links[id].classList.remove('is-active'); });
      var active = links[e.target.id];
      if (active) {
        active.classList.add('is-active');
        setProgress(active);
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });

  sections.forEach(function (s) { spy.observe(s); });

  // Reveal the nav only after the hero leaves the viewport.
  if (hero) {
    new IntersectionObserver(function (entries) {
      sidenav.classList.toggle('is-visible', !entries[0].isIntersecting);
    }, { threshold: 0.12 }).observe(hero);
  } else {
    sidenav.classList.add('is-visible');
  }
})();
