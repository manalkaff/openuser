import type { runs } from '../../db/schema.js';
import type { RunnerSession } from '../../runner/types.js';

/** Variables stored on the Hono context by the Bearer auth middleware */
export interface TesterVariables {
  run: typeof runs.$inferSelect;
  runnerSession: RunnerSession | null;
}
