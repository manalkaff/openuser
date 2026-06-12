import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  bundle: true,
  sourcemap: true,
  clean: true,
  // INVARIANT: keep code splitting OFF. src/lib/paths.ts resolves bundled
  // assets (ui/, migrations/, skills/) relative to import.meta.url, which is
  // only correct while everything is inlined into a single dist/index.js.
  // Enabling `splitting` would emit separate chunks with different
  // import.meta.url values and break bundledSkillsDir()/bundledUiDir().
  splitting: false,
  // commander has a CJS main that does dynamic require('events'), which breaks
  // when esbuild tries to inline it into an ESM bundle. Keep it external so
  // Node's module resolver picks up commander's own ESM export (esm.mjs) at
  // runtime. All other deps are bundled for portability.
  external: ['better-sqlite3', 'playwright', 'commander'],
  noExternal: ['open', 'picocolors', '@openuser/server', '@openuser/mcp', '@openuser/shared'],
  esbuildOptions(options) {
    options.banner = { js: '#!/usr/bin/env node' };
  },
});
