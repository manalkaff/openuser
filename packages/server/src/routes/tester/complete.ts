import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';
import { findings } from '../../db/schema.js';
import { RunLifecycleService } from '../../services/run-lifecycle.service.js';
import { TesterCompleteBodySchema } from '@openuser/shared';

export function completeRouter(
  ctx: ServerContext,
  activeSessions: ActiveSessions,
  watchdogCancel: (runId: string) => void,
) {
  const app = new Hono<{ Variables: TesterVariables }>();
  const authMiddleware = makeTokenAuth(ctx.db, activeSessions);
  const lifecycle = new RunLifecycleService(ctx.db, ctx.wsHub);

  app.post('/api/tester/complete', zValidator('json', TesterCompleteBodySchema), authMiddleware, async (c) => {
    const run = c.get('run');

    if (run.status !== 'running') {
      return c.json({ error: 'Run is not in running state' }, 409);
    }

    const body = c.req.valid('json');
    watchdogCancel(run.id);

    const session = activeSessions.get(run.id);
    let videoPath: string | undefined;
    if (session) {
      const closeResult = await session.close();
      videoPath = closeResult.videoPath;
      activeSessions.delete(run.id);
    }

    const status = lifecycle.finalize(run.id, body.verdict, body.summary, videoPath);

    const allFindings = ctx.db.select().from(findings).where(eq(findings.runId, run.id)).all();

    return c.json({ status, findings: allFindings });
  });

  return app;
}
