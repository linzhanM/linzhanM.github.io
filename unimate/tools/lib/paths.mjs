// Where this tool sits relative to the site it renders.

import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');   // lib -> tools
export const REPO_ROOT = resolve(TOOLS_DIR, '..', '..');                    // tools -> repo root
export const LAB_PATH = '/unimate/interactive.html';

// Renders land outside the repo on purpose: every file under assets/** is
// referenced by a page, so a stray clip in there reads as a mistake.
export const DEFAULT_OUT_DIR = join(homedir(), 'Downloads', 'lab_renders');
