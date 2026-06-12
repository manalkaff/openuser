#!/usr/bin/env node
// scripts/copy-ui.mjs — copies packages/ui/build → packages/cli/dist/ui
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const src = path.join(repoRoot, 'packages', 'ui', 'build');
const dest = path.join(repoRoot, 'packages', 'cli', 'dist', 'ui');

if (!fs.existsSync(src)) {
  console.error(`[copy-ui] ERROR: source not found: ${src}`);
  console.error('[copy-ui] Run `pnpm --filter @openuser/ui build` first.');
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[copy-ui] ${src} → ${dest} (done)`);
