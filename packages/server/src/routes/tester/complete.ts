import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';
import { findingsForRun } from '../../services/run-findings.js';
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

    // A run past its wall-clock limit, or reporting tokens at the limit, ends as budget_exhausted
    // through the common path (checkpoint first), whatever verdict the tester gives.
    const limit =
      (await ctx.runEnd.enforceDeadline(run)) ??
      (body.tokens !== undefined && body.tokens >= ctx.settings.get('maxTokens')
        ? ({ kind: 'tokens', reason: `${ctx.settings.get('maxTokens')} tokens` } as const)
        : null);
    if (limit) {
      if (limit.kind === 'tokens') {
        await ctx.runEnd.exhaust(run, limit, { tokens: body.tokens ?? 0, verdict: body.verdict, summary: body.summary });
      }
      return c.json({ status: 'budget_exhausted', findings: findingsForRun(ctx.db, run.id) });
    }

    watchdogCancel(run.id);
    ctx.runEnd.clearDeadline(run.id);

    const session = activeSessions.get(run.id);
    let videoPath: string | undefined;
    if (session) {
      const closeResult = await session.close();
      videoPath = closeResult.videoPath;
      activeSessions.delete(run.id);
    }

    const status = lifecycle.finalize(run.id, body.verdict, body.summary, videoPath, {
      ...(body.tokens !== undefined ? { tokens: body.tokens } : {}),
    });
    await ctx.guards.release(run.id);

    const allFindings = findingsForRun(ctx.db, run.id);

    return c.json({ status, findings: allFindings });
  });

  return app;
}
