// Embedded viewer entry point for the project page. The catalog is the shared
// examples.js; page-specific layout tweaks live in stage-tuning.js.
import { HIDDEN_CATEGORIES } from './viewer-presets.js?v=2';
import { EMBED_TUNING } from './stage-tuning.js?v=1';

window.UNIMATE_VIEWER_CONFIG = {
  hiddenCategories: HIDDEN_CATEGORIES,
  stageTuning: EMBED_TUNING,
};

await import('./viewer.js?v=144');
