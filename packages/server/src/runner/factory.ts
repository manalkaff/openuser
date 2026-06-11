import type { RunnerSession } from './types.js';
import { FakeRunner } from './fake.runner.js';

export type RunnerKind = 'fake' | 'playwright';

export function createRunnerSession(kind: RunnerKind): RunnerSession {
  if (kind === 'fake') {
    return new FakeRunner();
  }
  // playwright branch: Plan 03 will implement this
  throw new Error('not implemented — Plan 03');
}

export function defaultRunnerKind(): RunnerKind {
  const env = process.env['OPENUSER_RUNNER_KIND'];
  if (env === 'fake' || env === 'playwright') return env;
  return 'fake'; // Plan 03 flips this default to 'playwright'
}
