import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { ServerContext } from '../app.js';
import { tests, projects, runs } from '../db/schema.js';

const CreateTestBody = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  preconditions: z.string().optional(),
  expectedOutcome: z.string().optional(),
  defaultPersonaId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional().default('medium'),
  tags: z.array(z.string()).optional().default([]),
  source: z.enum(['manual', 'agent', 'promoted_from_run']).optional().default('manual'),
});

const UpdateTestBody = z.object({
  title: z.string().min(1).optional(),
  goal: z.string().min(1).optional(),
  preconditions: z.string().optional(),
  expectedOutcome: z.string().optional(),
  defaultPersonaId: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string()).optional(),
  source: z.enum(['manual', 'agent', 'promoted_from_run']).optional(),
  archived: z.boolean().optional(),
});

export function testsRouter(ctx: ServerContext) {
  const app = new Hono();

  // POST /api/projects/:id/tests
  app.post('/api/projects/:id/tests', zValidator('json', CreateTestBody), (c) => {
    const projectId = c.req.param('id');
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const body = c.req.valid('json');
    const id = `tst_${nanoid(12)}`;
    const row = {
      id,
      projectId,
      title: body.title,
      goal: body.goal,
      preconditions: body.preconditions ?? null,
      expectedOutcome: body.expectedOutcome ?? null,
      defaultPersonaId: body.defaultPersonaId ?? null,
      priority: body.priority,
      tags: body.tags,
      source: body.source,
      archived: false,
      createdAt: new Date(),
    };
    ctx.db.insert(tests).values(row).run();
    const test = ctx.db.select().from(tests).where(eq(tests.id, id)).get()!;
    return c.json(test, 201);
  });

  // GET /api/projects/:id/tests — each test includes lastRun: {id,status,finishedAt}|null
  app.get('/api/projects/:id/tests', (c) => {
    const projectId = c.req.param('id');
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const allTests = ctx.db.select().from(tests).where(eq(tests.projectId, projectId)).all();
    const result = allTests.map((t) => {
      const lastRunRow = ctx.db
        .select({ id: runs.id, status: runs.status, finishedAt: runs.finishedAt })
        .from(runs)
        .where(eq(runs.testId, t.id))
        .orderBy(sql`${runs.createdAt} DESC`)
        .limit(1)
        .get();
      return {
        ...t,
        lastRun: lastRunRow ?? null,
      };
    });
    return c.json(result);
  });

  // PATCH /api/tests/:id
  app.patch('/api/tests/:id', zValidator('json', UpdateTestBody), (c) => {
    const id = c.req.param('id');
    const test = ctx.db.select().from(tests).where(eq(tests.id, id)).get();
    if (!test) return c.json({ error: 'Test not found' }, 404);

    const body = c.req.valid('json');
    const updates: Partial<typeof tests.$inferInsert> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.goal !== undefined) updates.goal = body.goal;
    if (body.preconditions !== undefined) updates.preconditions = body.preconditions;
    if (body.expectedOutcome !== undefined) updates.expectedOutcome = body.expectedOutcome;
    if (body.defaultPersonaId !== undefined) updates.defaultPersonaId = body.defaultPersonaId;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.source !== undefined) updates.source = body.source;
    if (body.archived !== undefined) updates.archived = body.archived;

    if (Object.keys(updates).length > 0) {
      ctx.db.update(tests).set(updates).where(eq(tests.id, id)).run();
    }
    const updated = ctx.db.select().from(tests).where(eq(tests.id, id)).get()!;
    return c.json(updated);
  });

  return app;
}
