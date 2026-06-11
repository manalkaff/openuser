import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration test spawns the daemon in-process with FakeRunner via this env;
    // the unit test (mock Hono) ignores it. Harmless either way.
    env: { OPENUSER_RUNNER_KIND: 'fake' },
  },
});
