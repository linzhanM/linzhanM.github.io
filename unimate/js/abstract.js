// ─────────────────────────────────────────────────────────────────────────────
// Abstract fold — the phone-width "Read full abstract" toggle.
//
// The whole abstract is always in the document; this folds only its
// presentation. The button ships `hidden` and the fold styles are gated behind
// `.has-abstract-toggle` (css/responsive.css), both set here — so with JS off
// the abstract is a plain paragraph, never a clipped one.
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  var button = document.querySelector('.abstract-toggle');
  var copy = document.querySelector('.abstract-copy');
  if (!(button && copy)) return;

  document.body.classList.add('has-abstract-toggle');
  button.hidden = false;
  button.addEventListener('click', function () {
    var expanded = button.getAttribute('aria-expanded') === 'true';
    copy.classList.toggle('is-expanded', !expanded);
    button.setAttribute('aria-expanded', String(!expanded));
    button.innerHTML = expanded
      ? 'Read full abstract <span aria-hidden="true">↓</span>'
      : 'Collapse abstract <span aria-hidden="true">↑</span>';
  });
});
