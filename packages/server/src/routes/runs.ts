import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { ServerContext } from '../app.js';
import { RunLifecycleService, NotFoundError } from '../services/run-lifecycle.service.js';
import { ReportService } from '../services/report.service.js';
import { runs, steps, findings, tests, logEvents } from '../db/schema.js';

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

const PromoteRunBody = z.object({
  title: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  tags: z.array(z.string()).optional().default([]),
});

export function runsRouter(ctx: ServerContext) {
  const app = new Hono();
  const lifecycle = new RunLifecycleService(ctx.db, ctx.wsHub);
  const reportService = new ReportService(ctx.db);

  // POST /api/runs — prepare
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
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof NotFoundError) return c.json({ error: msg }, 404);
      return c.json({ error: msg }, 400);
    }
  });

  // GET /api/runs?projectId&status&limit
  app.get('/api/runs', (c) => {
    const projectId = c.req.query('projectId');
    const status = c.req.query('status');
    const rawLimit = parseInt(c.req.query('limit') ?? '50', 10);
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 500);

    const conditions = [];
    if (projectId) conditions.push(eq(runs.projectId, projectId));
    if (status) conditions.push(eq(runs.status, status as typeof runs.$inferSelect['status']));
    const allRuns = conditions.length > 0
      ? ctx.db.select().from(runs).where(and(...conditions)).orderBy(sql`${runs.createdAt} DESC`).limit(limit).all()
      : ctx.db.select().from(runs).orderBy(sql`${runs.createdAt} DESC`).limit(limit).all();

    return c.json(allRuns);
  });

  // GET /api/runs/:id
  app.get('/api/runs/:id', (c) => {
    const id = c.req.param('id');
    const run = ctx.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: 'Run not found' }, 404);

    const allSteps = ctx.db.select().from(steps).where(eq(steps.runId, id)).orderBy(steps.idx).all();
    const allFindings = ctx.db.select().from(findings).where(eq(findings.runId, id)).orderBy(findings.createdAt).all();

    return c.json({ ...run, steps: allSteps, findings: allFindings });
  });

  // GET /api/runs/:id/events
  app.get('/api/runs/:id/events', (c) => {
    const id = c.req.param('id');
    const run = ctx.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: 'Run not found' }, 404);

    const events = ctx.db
      .select()
      .from(logEvents)
      .where(eq(logEvents.runId, id))
      .orderBy(logEvents.createdAt)
      .all();

    return c.json(events);
  });

  // GET /api/runs/:id/report
  app.get('/api/runs/:id/report', (c) => {
    const id = c.req.param('id');
    const run = ctx.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: 'Run not found' }, 404);

    const markdown = reportService.generateMarkdown(id);
    return new Response(markdown, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
  });

  // POST /api/runs/:id/promote
  app.post('/api/runs/:id/promote', zValidator('json', PromoteRunBody), (c) => {
    const id = c.req.param('id');
    const run = ctx.db.select().from(runs).where(eq(runs.id, id)).get();
    if (!run) return c.json({ error: 'Run not found' }, 404);

    const terminal = ['passed', 'failed', 'blocked', 'aborted'];
    if (!terminal.includes(run.status)) {
      return c.json({ error: 'Run must be in a terminal state to promote' }, 409);
    }

    const body = c.req.valid('json');

    // Derive goal from adhocGoal or from the run's linked test
    let goal = run.adhocGoal ?? '';
    if (!goal && run.testId) {
      const test = ctx.db.select().from(tests).where(eq(tests.id, run.testId)).get();
      if (test) goal = test.goal;
    }
    if (!goal) return c.json({ error: 'Run has no goal to promote from' }, 400);

    const testId = `tst_${nanoid(12)}`;
    ctx.db.insert(tests).values({
      id: testId,
      projectId: run.projectId,
      title: body.title,
      goal,
      preconditions: null,
      expectedOutcome: null,
      defaultPersonaId: run.personaId,
      priority: body.priority,
      tags: body.tags,
      source: 'promoted_from_run',
      archived: false,
      createdAt: new Date(),
    }).run();

    const test = ctx.db.select().from(tests).where(eq(tests.id, testId)).get()!;
    return c.json(test, 201);
  });

  return app;
}

export { RunLifecycleService };
