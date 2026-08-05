/* Navbar behaviour: the mobile burger toggle, plus the keypoint that marks
   which section you're reading. The keypoint is positioned by writing --kp-x
   (its offset along the rail) and --kp-o (its opacity) onto .navbar-sections,
   so all the easing stays in CSS. Links are plain anchors — without JS the nav
   still navigates, it just doesn't track.

   Also the section reveal shared by all three root pages — see
   revealSections(). */

/* Unfold each .page-section as it comes on screen. The hidden state is CSS
   (styles.css, gated behind .js-anim); this only decides *when* each one is
   let go.

   The split between the two halves is the important part. Sections already in
   the viewport at load are revealed **here, from their own measured position**,
   stepped 90ms apart so the page assembles top-down. Only what starts below
   the fold is handed to the observer, where it unfolds the moment it is
   scrolled to.

   The first one starts at 0. It used to wait 140ms for the hero's own entrance
   to get clear; the hero doesn't animate any more, so there is nothing left to
   wait behind and the delay was pure latency on the first thing under the fold
   line.

   That split is deliberately not "let the observer's first callback handle
   whatever is visible", which is the obvious way to write this and makes every
   pixel above the fold depend on the observer firing. It does fire, in a real
   visible tab — but if anything ever stops it, the cost of being wrong is a
   blank page, and there is no reason for the content someone is already
   looking at to depend on it at all. Below the fold the stakes are different:
   nothing is on screen to be missing, and by the time it is, the page is
   demonstrably rendering.

   Nothing may stay hidden. The CSS only hides under .js-anim, so JS-off is
   already safe; the guards below cover JS running with an observer that can't
   be trusted — unsupported, reduced motion, or simply never firing. */
function revealSections() {
	var sections = Array.prototype.slice.call(document.querySelectorAll('.page-section'));
	if (!sections.length) return;
	if (!document.documentElement.classList.contains('js-anim')) return;

	function reveal(el, delay) {
		if (delay) { window.setTimeout(function () { el.classList.add('is-in'); }, delay); }
		else { el.classList.add('is-in'); }
	}

	var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (reduced || !('IntersectionObserver' in window)) {
		sections.forEach(function (s) { reveal(s, 0); });
		return;
	}

	// Split on measured position, not on what the observer reports back.
	var below = [];
	var shown = 0;
	sections.forEach(function (s) {
		if (s.getBoundingClientRect().top < window.innerHeight * 0.92) {
			reveal(s, shown * 90);
			shown++;
		} else {
			below.push(s);
		}
	});

	if (!below.length) return;

	// The rest are off screen, so if the observer never delivers, this shows
	// them well before anyone could scroll far enough to notice.
	var everFired = false;
	window.setTimeout(function () {
		if (!everFired) { below.forEach(function (s) { reveal(s, 0); }); }
	}, 3000);

	var io = new IntersectionObserver(function (entries) {
		entries.forEach(function (entry) {
			if (!entry.isIntersecting) return;
			everFired = true;
			reveal(entry.target, 0);
			io.unobserve(entry.target);
		});
	}, {
		// Start the unfold a little before the section's top edge reaches the
		// bottom of the viewport, so it is finishing as it is read rather than
		// starting once it is already in the way.
		rootMargin: '0px 0px -10% 0px',
		threshold: 0.04
	});

	below.forEach(function (s) { io.observe(s); });
}

document.addEventListener('DOMContentLoaded', function () {
	revealSections();

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

	// --- Keypoint ---------------------------------------------------------
	// All three root pages carry the same rail, so moving between them should
	// read as the one dot travelling along it rather than as separate dots
	// blinking on and off. Each page records the label the dot ended under; the
	// next page starts the dot there and then lets its own first move glide it
	// across, which is the whole trick — the animation is the ordinary CSS
	// transition, it just gets a different starting point.
	//
	// Stored by **label text**, not by index: an index silently means the wrong
	// link the moment one page's rail differs from another's, and the label is
	// what the visitor was actually looking at. sessionStorage rather than
	// localStorage, because this is continuity within one visit — a dot sliding
	// in from a link you clicked yesterday is noise, not motion.
	var KP_KEY = 'nav-keypoint';
	var entered = false;

	function label(link) {
		return (link.textContent || '').trim();
	}

	function recall() {
		var name;
		try { name = sessionStorage.getItem(KP_KEY); } catch (e) { return null; }
		if (!name) return null;
		for (var i = 0; i < links.length; i++) {
			if (label(links[i]) === name) return links[i];
		}
		return null;
	}

	// Park the dot under the label's centre, measured relative to the rail.
	function place(link) {
		rail.style.setProperty('--kp-x', (link.offsetLeft + link.offsetWidth / 2) + 'px');
	}

	function moveKeypoint(link) {
		if (!entered) {
			entered = true;
			// Where the dot should come *from*. Falling back to the destination
			// means no travel — a first visit, or a reload of the page it is
			// already on, where a zero-length glide would just be a flicker.
			var from = recall() || link;

			// .is-instant kills the dot's transitions for this placement only,
			// so arriving at the start point isn't itself animated. The forced
			// reflow between the two writes is load-bearing: without it the
			// browser coalesces them into one style change and there is nothing
			// left for the transition to run between. Opacity is only forced
			// when there *is* a journey — otherwise it stays 0 here and fades
			// in below, which is how a page with no history still introduces
			// the dot rather than snapping it on.
			rail.classList.add('is-instant');
			place(from);
			if (from !== link) rail.style.setProperty('--kp-o', '1');
			void rail.offsetWidth;
			rail.classList.remove('is-instant');
			// Under prefers-reduced-motion the transitions are off in CSS, so
			// all of the above collapses to placing the dot at its destination.
		}

		place(link);
		rail.style.setProperty('--kp-o', '1');
		try { sessionStorage.setItem(KP_KEY, label(link)); } catch (e) {}
	}

	// --- Scroll spy -------------------------------------------------------
	// Everything above is per-page; what follows only applies to a rail whose
	// links resolve to sections of *this* document.
	var targets = links
		.map(function (link) {
			var id = link.getAttribute('href').slice(1);
			return { link: link, section: document.getElementById(id) };
		})
		.filter(function (t) { return t.section; });

	var active = null;

	// Pages other than the homepage carry the same rail, but every link on it
	// points at a section of *another* page — nothing here to scroll past. The
	// current page marks its own link `is-active` in the markup instead, and the
	// dot parks there and stays. Re-measured on load and resize because the rail
	// moves when the webfont lands and when the row rewraps; only the first of
	// those measurements runs the cross-page glide, the rest are corrections.
	if (!targets.length) {
		var here = rail.querySelector('.nav-section.is-active');
		if (!here) return;
		var park = function () { moveKeypoint(here); };
		park();
		window.addEventListener('load', park);
		window.addEventListener('resize', park);
		return;
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
		// the last section sits close enough to the bottom that its heading can
		// never climb that high, so it would never activate. Instead the line
		// sweeps down as you approach the end — parked under the navbar at the
		// top of the page, at the viewport's bottom edge once you've hit the
		// last scroll position — giving each section a window roughly
		// proportional to its height.
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

	update();
});
