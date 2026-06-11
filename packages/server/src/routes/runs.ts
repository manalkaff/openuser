import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { ServerContext } from '../app.js';
import { RunLifecycleService, NotFoundError } from '../services/run-lifecycle.service.js';

const PrepareRunBody = z.object({
  projectId: z.string().min(1),
  testId: z.string().optional(),
  adhocGoal: z.string().optional(),
  personaId: z.string().min(1),
  checkpointId: z.string().optional(),
  environment: z.string().optional(),
  agentLabel: z.string().optional(),
}).refine(
  (b) => Boolean(b.testId) !== Boolean(b.adhocGoal),
  { message: 'Provide exactly one of testId or adhocGoal' },
);

export function runsRouter(ctx: ServerContext) {
  const app = new Hono();
  const lifecycle = new RunLifecycleService(ctx.db, ctx.wsHub);

  // POST /api/runs — prepare a new run
  app.post('/api/runs', zValidator('json', PrepareRunBody), (c) => {
    const body = c.req.valid('json');
    try {
      const result = lifecycle.prepare({
        projectId: body.projectId,
        testId: body.testId ?? null,
        adhocGoal: body.adhocGoal ?? null,
        personaId: body.personaId,
        checkpointId: body.checkpointId ?? null,
        environment: body.environment ?? null,
        agentLabel: body.agentLabel ?? null,
      });
      return c.json({ runId: result.runId, token: result.token, testerPrompt: result.testerPrompt }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bad request';
      if (err instanceof NotFoundError) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  return app;
}

export { RunLifecycleService };
