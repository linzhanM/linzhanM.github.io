/* Navbar behaviour: the mobile burger toggle, plus the keypoint that marks
   which section you're reading. The keypoint is positioned by writing --kp-x
   (its offset along the rail) and --kp-o (its opacity) onto .navbar-sections,
   so all the easing stays in CSS. Links are plain anchors — without JS the nav
   still navigates, it just doesn't track. */
document.addEventListener('DOMContentLoaded', function () {
	var burger = document.querySelector('.navbar-burger');
	var menu = document.querySelector('.navbar-menu');

	if (burger && menu) {
		burger.addEventListener('click', function () {
			var open = burger.classList.toggle('is-active');
			menu.classList.toggle('is-active', open);
			burger.setAttribute('aria-expanded', String(open));
		});
	}

	var rail = document.querySelector('.navbar-sections');
	if (!rail) return;

	var links = Array.prototype.slice.call(rail.querySelectorAll('.nav-section'));
	var targets = links
		.map(function (link) {
			var id = link.getAttribute('href').slice(1);
			return { link: link, section: document.getElementById(id) };
		})
		.filter(function (t) { return t.section; });

	if (!targets.length) return;

	var active = null;

	function moveKeypoint(link) {
		// Park the dot under the label's centre, measured relative to the rail.
		var x = link.offsetLeft + link.offsetWidth / 2;
		rail.style.setProperty('--kp-x', x + 'px');
		rail.style.setProperty('--kp-o', '1');
	}

	function setActive(link) {
		if (link === active) return;
		if (active) active.classList.remove('is-active');
		active = link;

		if (!link) {
			rail.style.setProperty('--kp-o', '0');
			return;
		}
		link.classList.add('is-active');
		moveKeypoint(link);
	}

	function update() {
		var navHeight = document.querySelector('.navbar').offsetHeight;
		var viewport = window.innerHeight;
		var maxScroll = document.documentElement.scrollHeight - viewport;
		var offset = navHeight + 24;

		// A section is "current" once its heading passes the probe line. A line
		// fixed under the navbar only works while there's page left to scroll:
		// Experience sits close enough to the bottom that its heading can never
		// climb that high, so it would never activate. Instead the line sweeps
		// down as you approach the end — parked under the navbar at the top of
		// the page, at the viewport's bottom edge once you've hit the last
		// scroll position — giving each section a window roughly proportional
		// to its height.
		var progress = maxScroll > 0 ? Math.min(window.scrollY / maxScroll, 1) : 1;
		var probe = window.scrollY + offset + progress * (viewport - offset);
		var current = null;

		targets.forEach(function (t) {
			// offsetTop is relative to the offsetParent, so walk up to the page.
			var top = 0, el = t.section;
			while (el) { top += el.offsetTop; el = el.offsetParent; }
			if (top <= probe) current = t.link;
		});

		setActive(current);
	}

	var ticking = false;
	function onScroll() {
		if (ticking) return;
		ticking = true;
		window.requestAnimationFrame(function () {
			update();
			ticking = false;
		});
	}

	window.addEventListener('scroll', onScroll, { passive: true });
	window.addEventListener('resize', function () {
		if (active) moveKeypoint(active);
		update();
	});

	// Expanding an abstract changes the page height, which moves every section
	// below it — the dot would otherwise stay wrong until the next scroll.
	// Those toggles are clicks, so re-measure after any click. This is a
	// timeout rather than requestAnimationFrame on purpose: rAF is suspended
	// in background tabs, and update() forces its own layout read regardless.
	document.addEventListener('click', function () {
		window.setTimeout(update, 0);
	}, true);

	// Close the mobile menu after a jump, so the destination is visible.
	links.forEach(function (link) {
		link.addEventListener('click', function () {
			if (menu && menu.classList.contains('is-active')) {
				burger.classList.remove('is-active');
				menu.classList.remove('is-active');
				burger.setAttribute('aria-expanded', 'false');
			}
		});
	});

	update();
});
