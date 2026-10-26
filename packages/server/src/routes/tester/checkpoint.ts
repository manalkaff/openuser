import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';
import { saveRunCheckpoint } from '../../services/checkpoint.service.js';
import { TesterCheckpointBodySchema } from '@openuser/shared';

export function checkpointTesterRouter(
  ctx: ServerContext,
  activeSessions: ActiveSessions,
  watchdogReset: (runId: string) => void,
) {
  const app = new Hono<{ Variables: TesterVariables }>();
  const authMiddleware = makeTokenAuth(ctx.db, activeSessions);

  app.post('/api/tester/checkpoint', zValidator('json', TesterCheckpointBodySchema), authMiddleware, async (c) => {
    const run = c.get('run');

    if (run.status !== 'running') {
      return c.json({ error: 'Run is not in running state' }, 409);
    }

    watchdogReset(run.id);

    const body = c.req.valid('json');
    const session = activeSessions.get(run.id);
    if (!session) {
      return c.json({ error: 'No active runner session for this run' }, 500);
    }

    const checkpoint = await saveRunCheckpoint(ctx.db, ctx.homeDir, run, session, body);

    return c.json(checkpoint, 201);
  });

  return app;
}
