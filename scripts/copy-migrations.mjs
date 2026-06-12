#!/usr/bin/env node
// scripts/copy-migrations.mjs
// Copies packages/server/src/db/migrations → packages/cli/dist/migrations (recursive).
// The bundled server (inlined into packages/cli/dist/index.js) resolves its
// migrations folder as ./migrations relative to dist/index.js, so they must
// land in dist/migrations — INCLUDING the meta/ subdir Drizzle needs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const src = path.join(repoRoot, 'packages', 'server', 'src', 'db', 'migrations');
const dest = path.join(repoRoot, 'packages', 'cli', 'dist', 'migrations');

if (!fs.existsSync(src)) {
  console.error(`[copy-migrations] ERROR: ${src} not found.`);
  process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
const count = fs.readdirSync(dest).length;
console.log(`[copy-migrations] ${count} entr(ies) copied: ${src} → ${dest}`);
