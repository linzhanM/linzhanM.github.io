// blog.js — loaded at the foot of resources/blog/index.html and every post.
// Three jobs, none of which the page depends on to read:
//   1. the appearance switch (the same contract as js/nav.js: html[data-theme]
//      is stamped in the head before first paint; this flips it, stores the
//      choice under localStorage "theme", the key the root pages and the DIMO
//      lab share, and follows the system only until a choice is made);
//   2. the footer year;
//   3. on a post, the contents rail's keypoint, moved to the heading in view.
(function () {
	'use strict';

	// --- Appearance switch --------------------------------------------------
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

	// --- Footer year --------------------------------------------------------
	var year = document.getElementById('copyright-year');
	if (year) year.textContent = String(new Date().getFullYear());

	// --- Contents rail keypoint ---------------------------------------------
	// The rail lists the post's h2s by id. The dot sits beside the link of the
	// last heading that has crossed the top third of the window; on a narrow
	// window the rail is in the flow and the dot is display:none, but the
	// is-current class still marks the link. Measured on scroll, not by an
	// IntersectionObserver: the answer is "the last heading above a line",
	// which one observer threshold can't express.
	var contents = document.querySelector('.contents');
	if (!contents) return;
	var links = Array.prototype.slice.call(contents.querySelectorAll('a[href^="#"]'));
	var dot = contents.querySelector('.contents-keypoint');
	var headings = links.map(function (a) {
		return document.getElementById(a.getAttribute('href').slice(1));
	});
	if (!links.length || headings.some(function (h) { return !h; })) return;

	var current = -1;

	function place(i) {
		if (i === current) return;
		current = i;
		links.forEach(function (a, k) { a.classList.toggle('is-current', k === i); });
		if (dot) {
			var a = links[i].getBoundingClientRect();
			var c = contents.getBoundingClientRect();
			dot.style.transform = 'translateY(' + (a.top - c.top + a.height / 2 - 3) + 'px)';
		}
	}

	function update() {
		var line = window.innerHeight / 3;
		var i = 0;
		for (var k = 0; k < headings.length; k++) {
			if (headings[k].getBoundingClientRect().top <= line) i = k;
		}
		place(i);
	}

	var ticking = false;
	window.addEventListener('scroll', function () {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(function () { ticking = false; update(); });
	}, { passive: true });
	window.addEventListener('resize', update);
	update();
})();
