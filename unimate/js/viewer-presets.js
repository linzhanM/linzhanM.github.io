// Stages hidden from both entry points, by LABEL. The filter runs before
// anything else reads the catalog, so a hidden stage costs nothing — absent
// from the rail, rigs never fetched, Categories count one lower, its #slug
// falls back to the first visible stage. The trap: whatever stands first AFTER
// filtering is what both pages open on, and the lab's #stage-name first paint
// (interactive.html) has to move with it.
export const HIDDEN_CATEGORIES = Object.freeze(['Showcase']);
