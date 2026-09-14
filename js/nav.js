/* Shared by the three root pages: the appearance switch, the mobile burger,
   the section reveal, and the keypoint that marks the section you're reading. The keypoint is driven
   by writing --kp-x (offset along the rail) and --kp-o (opacity) onto
   .navbar-sections, so all easing stays in CSS. Links are plain anchors —
   without JS the nav still navigates, it just doesn't track. */

/* Unfold each .page-section as it comes on screen. The hidden state is CSS
   (styles.css, gated behind .js-anim); this only decides *when* each one is
   let go.

   The split is the important part. Sections already in the viewport at load
   are revealed here, from their own measured position, stepped 90ms apart so
   the page assembles top-down (the first at 0 — nothing above it animates, so
   there is nothing to wait behind). Only what starts below the fold goes to
   the observer.

   Not "let the observer's first callback handle whatever is visible": that
   makes every pixel above the fold depend on the observer firing, and if
   anything ever stops it the cost is a blank page. Below the fold nothing is
   on screen to be missing, and by the time it is, the page is demonstrably
   rendering.

   Nothing may stay hidden. JS-off is already safe (the CSS hides only under
   .js-anim); the guards below cover an observer that can't be trusted —
   unsupported, reduced motion, or simply never firing. */
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

	// --- Appearance switch ------------------------------------------------
	// html[data-theme] is stamped in each page's <head> before first paint;
	// this only turns the switch and keeps the choice in localStorage, which
	// the DIMO lab reads too (UniMate's full lab keeps its own). The system
	// is followed until a choice is made and not after — there is no
	// "system" state. The framed labs watch the attribute themselves.
	var THEME_KEY = 'theme';
	var root = document.documentElement;
	var themeSwitch = document.querySelector('.theme-switch');

	function chosen() {
		try {
			var t = localStorage.getItem(THEME_KEY);
			return t === 'light' || t === 'dark' ? t : null;
		} catch (e) { return null; }
	}

	function reflectTheme() {
		var dark = root.dataset.theme === 'dark';
		if (themeSwitch) themeSwitch.setAttribute('aria-checked', String(dark));
		// Safari's toolbar tint: --ivory-light of the current palette.
		var tint = document.querySelector('meta[name="theme-color"]');
		if (tint) tint.content = dark ? '#1e2120' : '#faf9f5';
	}

	reflectTheme();

	if (themeSwitch) {
		themeSwitch.addEventListener('click', function () {
			var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
			root.dataset.theme = next;
			try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
			reflectTheme();
		});
	}

	if (window.matchMedia) {
		var scheme = window.matchMedia('(prefers-color-scheme: dark)');
		var follow = function (e) {
			if (chosen()) return;
			root.dataset.theme = e.matches ? 'dark' : 'light';
			reflectTheme();
		};
		if (scheme.addEventListener) scheme.addEventListener('change', follow);
		else if (scheme.addListener) scheme.addListener(follow);
	}

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
	// All three root pages carry the same rail (the résumé's adds a third link),
	// so moving between pages should read as one dot travelling along it, not
	// separate dots blinking on and off. Each page records the label the dot
	// ended under; the next page starts the dot there and lets its own first
	// move glide it across. The animation is the ordinary CSS transition with a
	// different starting point.
	//
	// Stored by label text, not index: an index means the wrong link as soon as
	// one rail differs from another. sessionStorage, not localStorage: this is
	// continuity within one visit — a dot sliding in from yesterday's click is
	// noise.
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
			// Where the dot comes *from*. No history (first visit, or a reload of
			// this page) falls back to the destination: no travel, no flicker.
			var from = recall() || link;

			// .is-instant zeroes the transitions for this placement only, so
			// arriving at the start point isn't itself animated. The forced
			// reflow between the two writes is load-bearing: without it the
			// browser coalesces them into one style change and nothing animates.
			// Opacity is forced only when there is a journey; otherwise it stays
			// 0 and fades in below, so a page with no history still introduces
			// the dot rather than snapping it on. Under reduced motion the CSS
			// transitions are off and all of this collapses to a plain placement.
			rail.classList.add('is-instant');
			place(from);
			if (from !== link) rail.style.setProperty('--kp-o', '1');
			void rail.offsetWidth;
			rail.classList.remove('is-instant');
		}

		place(link);
		rail.style.setProperty('--kp-o', '1');
		try { sessionStorage.setItem(KP_KEY, label(link)); } catch (e) {}
	}

	// --- Scroll spy -------------------------------------------------------
	// Only for a rail whose links resolve to sections of *this* document.
	var targets = links
		.map(function (link) {
			var id = link.getAttribute('href').slice(1);
			return { link: link, section: document.getElementById(id) };
		})
		.filter(function (t) { return t.section; });

	var active = null;

	// Off the homepage every rail link points at another page, so there is
	// nothing to track: the page marks its own link `is-active` in the markup
	// and the dot parks there. Re-measured on load and resize because the rail
	// moves when the webfont lands and when the row rewraps; only the first
	// measurement runs the cross-page glide, the rest are corrections. This
	// branch calls moveKeypoint(), so the keypoint block must stay above it.
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
		// fixed under the navbar would never activate the last section — its
		// heading can't climb that high — so the line sweeps down as you near
		// the end: under the navbar at the top of the page, at the viewport's
		// bottom edge at the last scroll position. Each section gets a window
		// roughly proportional to its height.
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

	// Expanding an abstract changes the page height and moves every section
	// below it, so re-measure after any click or the dot stays wrong until the
	// next scroll. A timeout, not requestAnimationFrame, on purpose: rAF is
	// suspended in background tabs, and update() forces its own layout read.
	document.addEventListener('click', function () {
		window.setTimeout(update, 0);
	}, true);

	update();
});
