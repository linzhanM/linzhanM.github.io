// Shared page-level viewer policy. Keep work-in-progress stages available in the
// catalog source while hiding them consistently from both public entry points.
//
// Hiding is by LABEL and it filters the catalog before anything else reads it,
// so a hidden stage costs nothing at runtime: it is not in the rail, its rigs
// are never fetched, the Categories count drops by one, and — because the lab
// resolves #slugs against the filtered list — its deep link stops resolving and
// falls back to the first visible stage. Which also means whatever stands first
// in EXAMPLES *after* filtering is what both pages open on.
// 'Welcome' stands first in EXAMPLES, so un-hiding it is also what both pages
// now open on — the lab's #stage-name first paint moved with it.
export const HIDDEN_CATEGORIES = Object.freeze(['Showcase']);
