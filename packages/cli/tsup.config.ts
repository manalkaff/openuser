import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  bundle: true,
  sourcemap: true,
  clean: true,
  external: ['better-sqlite3', 'playwright'],
  noExternal: ['commander', 'open', 'picocolors', '@openuser/server', '@openuser/mcp', '@openuser/shared'],
  esbuildOptions(options) {
    options.banner = { js: '#!/usr/bin/env node' };
  },
});
