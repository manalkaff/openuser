import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';
import { steps } from '../../db/schema.js';
import type { StepKind } from '../../db/schema.js';
import type { LogPipelineService } from '../../services/log-pipeline.service.js';
import { TesterActionRequestSchema } from '@openuser/shared';
import type { PageSnapshot, TesterAction } from '@openuser/shared';

export function actionRouter(
  ctx: ServerContext,
  activeSessions: ActiveSessions,
  logPipeline: LogPipelineService,
  watchdogReset: (runId: string) => void,
) {
  const app = new Hono<{ Variables: TesterVariables }>();
  const authMiddleware = makeTokenAuth(ctx.db, activeSessions);

  app.post('/api/tester/action', zValidator('json', TesterActionRequestSchema), authMiddleware, async (c) => {
    const run = c.get('run');

    if (run.status !== 'running') {
      return c.json({ error: 'Run is not in running state' }, 409);
    }

    const body = c.req.valid('json');
    const session = activeSessions.get(run.id);
    if (!session) {
      return c.json({ error: 'No active runner session for this run' }, 500);
    }

    // Reset watchdog on every tester call
    watchdogReset(run.id);

    const startMs = Date.now();
    const { note, ...action } = body as TesterAction & { note?: string };

    let result: { snapshot: PageSnapshot; screenshotPath: string; pageUrl: string } | null = null;
    let actionError: string | null = null;

    try {
      result = await session.act(action);
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - startMs;

    // Compute next step index
    const existingSteps = ctx.db.select({ idx: steps.idx }).from(steps).where(eq(steps.runId, run.id)).all();
    const nextIdx = existingSteps.length === 0 ? 0 : Math.max(...existingSteps.map((s) => s.idx)) + 1;

    // Persist step
    const stepId = `stp_${nanoid(12)}`;
    const kindFromAction = action.kind as StepKind;

    // Ensure steps dir exists
    const stepsDir = join(ctx.homeDir, 'artifacts', run.id, 'steps');
    mkdirSync(stepsDir, { recursive: true });
    const screenshotPath = result?.screenshotPath ?? null;

    ctx.db.insert(steps).values({
      id: stepId,
      runId: run.id,
      idx: nextIdx,
      kind: kindFromAction,
      description: JSON.stringify(action),
      pageUrl: result?.pageUrl ?? null,
      screenshotPath,
      status: actionError ? 'error' : 'ok',
      error: actionError,
      note: note ?? null,
      durationMs,
      createdAt: new Date(),
    }).run();

    const step = ctx.db.select().from(steps).where(eq(steps.id, stepId)).get()!;
    logPipeline.setCurrentStep(run.id, nextIdx);
    ctx.wsHub.broadcastRun(run.id, 'step.created', step);

    if (actionError) {
      return c.json({
        ok: false,
        error: actionError,
        snapshot: result?.snapshot ?? null,
      });
    }

    return c.json({ ok: true, snapshot: result!.snapshot });
  });

  return app;
}
