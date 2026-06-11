import type { runs } from '../../db/schema.js';

/** Variables stored on the Hono context by the Bearer auth middleware */
export interface TesterVariables {
  run: typeof runs.$inferSelect;
}
