import { Hono } from 'hono';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';

export function snapshotRouter(ctx: ServerContext, activeSessions: ActiveSessions) {
  const app = new Hono<{ Variables: TesterVariables }>();
  const authMiddleware = makeTokenAuth(ctx.db, activeSessions);

  app.post('/api/tester/snapshot', authMiddleware, async (c) => {
    const run = c.get('run');

    if (run.status !== 'running') {
      return c.json({ error: 'Run is not in running state' }, 409);
    }

    const session = activeSessions.get(run.id);
    if (!session) {
      return c.json({ error: 'No active runner session for this run' }, 500);
    }

    const snapshot = await session.snapshot();
    return c.json(snapshot);
  });

  return app;
}
