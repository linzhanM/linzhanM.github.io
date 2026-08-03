// Embedded viewer entry point for the project page.
import { HIDDEN_CATEGORIES } from './viewer-presets.js';

window.UNIMATE_VIEWER_CONFIG = {
  hiddenCategories: HIDDEN_CATEGORIES,
};

await import('./viewer.js?v=109');
