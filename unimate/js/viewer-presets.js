// Shared page-level viewer policy: work-in-progress stages stay in the catalog
// source and are hidden consistently from both public entry points.
//
// Hiding is by LABEL and filters the catalog before anything else reads it, so a
// hidden stage costs nothing — absent from the rail, rigs never fetched,
// Categories count one lower, and its #slug no longer resolves (the lab falls
// back to the first visible stage). The trap: whatever stands first AFTER
// filtering is what both pages open on, and the lab's #stage-name first paint
// has to move with it.
export const HIDDEN_CATEGORIES = Object.freeze(['Showcase']);
