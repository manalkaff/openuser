import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';
import { checkpoints, steps } from '../../db/schema.js';
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

    const checkpointId = `chk_${nanoid(12)}`;
    const checkpointDir = join(ctx.homeDir, 'checkpoints', checkpointId);
    mkdirSync(checkpointDir, { recursive: true });

    const storageStatePath = join(checkpointDir, 'storageState.json');
    await session.saveStorageState(storageStatePath);

    // Determine current step idx and URL
    const latestStep = ctx.db
      .select()
      .from(steps)
      .where(eq(steps.runId, run.id))
      .orderBy(steps.idx)
      .all()
      .at(-1);

    const savedAtStep = latestStep?.idx ?? 0;
    const url = latestStep?.pageUrl ?? run.baseUrlResolved;

    const journey = { notes: body.journeyNotes, savedAtStep, url };
    writeFileSync(join(checkpointDir, 'journey.json'), JSON.stringify(journey, null, 2));

    ctx.db.insert(checkpoints).values({
      id: checkpointId,
      projectId: run.projectId,
      personaId: run.personaId,
      name: body.name,
      description: body.description ?? null,
      storageStatePath,
      journey,
      createdFromRunId: run.id,
      createdAt: new Date(),
    }).run();

    const checkpoint = ctx.db.select().from(checkpoints).where(eq(checkpoints.id, checkpointId)).get()!;
    return c.json(checkpoint, 201);
  });

  return app;
}
