// Entry point for the embedded viewer on the project page. The catalog is the
// shared examples.js; per-page framing is stage-tuning.js.
import { HIDDEN_CATEGORIES } from './viewer-presets.js?v=3';
import { EMBED_TUNING } from './stage-tuning.js?v=12';

window.UNIMATE_VIEWER_CONFIG = {
  hiddenCategories: HIDDEN_CATEGORIES,
  stageTuning: EMBED_TUNING,
};

await import('./viewer.js?v=200');
