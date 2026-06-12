import type { RunnerSession } from './types.js';
import { FakeRunner } from './fake.runner.js';
import { PlaywrightRunner } from './playwright.js';

export type RunnerKind = 'fake' | 'playwright';

export function createRunnerSession(kind: RunnerKind): RunnerSession {
  if (kind === 'fake') {
    return new FakeRunner();
  }
  return new PlaywrightRunner();
}

export function defaultRunnerKind(): RunnerKind {
  const env = process.env['OPENUSER_RUNNER_KIND'];
  if (env === 'fake' || env === 'playwright') return env;
  // Default to playwright; set OPENUSER_RUNNER_KIND=fake in tests to avoid
  // launching a real browser (Plan 02 integration tests rely on this).
  return 'playwright';
}
