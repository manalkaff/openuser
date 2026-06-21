#!/usr/bin/env node
// scripts/copy-readme.mjs — copies root README.md → packages/cli/README.md
// so the published openuser-cli package shows the project README on npm.
// The repo root README is the single source of truth; this keeps the
// published copy in sync at release time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const src = path.join(repoRoot, 'README.md');
const dest = path.join(repoRoot, 'packages', 'cli', 'README.md');

if (!fs.existsSync(src)) {
  console.error(`[copy-readme] ERROR: source not found: ${src}`);
  process.exit(1);
}
fs.copyFileSync(src, dest);
console.log(`[copy-readme] ${src} → ${dest} (done)`);
