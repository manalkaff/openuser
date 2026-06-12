#!/usr/bin/env node
// scripts/copy-skills.mjs — copies skills/ → packages/cli/skills
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const src = path.join(repoRoot, 'skills');
const dest = path.join(repoRoot, 'packages', 'cli', 'skills');

if (!fs.existsSync(src)) {
  console.error(`[copy-skills] ERROR: source not found: ${src}`);
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`[copy-skills] ${src} → ${dest} (done)`);
