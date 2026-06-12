import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Force FakeRunner in all server unit/integration tests so no real browser
    // is launched. Production default (PlaywrightRunner) is set in factory.ts.
    // Individual tests may override by setting OPENUSER_RUNNER_KIND=playwright.
    env: {
      OPENUSER_RUNNER_KIND: 'fake',
    },
  },
});
