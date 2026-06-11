import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, sql, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { ServerContext } from '../app.js';
import { projects, findings, runs } from '../db/schema.js';

const CreateProjectBody = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  baseUrl: z.string().url(),
  environments: z
    .array(z.object({ name: z.string(), url: z.string().url() }))
    .optional()
    .default([]),
  defaultViewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .optional()
    .default({ width: 1280, height: 720 }),
});

const UpdateProjectBody = z.object({
  name: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  environments: z.array(z.object({ name: z.string(), url: z.string().url() })).optional(),
  defaultViewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
});

export function projectsRouter(ctx: ServerContext) {
  const app = new Hono();

  // POST /api/projects
  app.post('/api/projects', zValidator('json', CreateProjectBody), async (c) => {
    const body = c.req.valid('json');
    const existing = ctx.db.select().from(projects).where(eq(projects.path, body.path)).get();
    if (existing) {
      return c.json({ error: 'A project with this path already exists' }, 409);
    }
    const id = `prj_${nanoid(12)}`;
    const now = Date.now();
    const row = {
      id,
      name: body.name,
      path: body.path,
      baseUrl: body.baseUrl,
      environments: body.environments,
      defaultViewport: body.defaultViewport,
      createdAt: new Date(now),
    };
    ctx.db.insert(projects).values(row).run();
    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get()!;
    return c.json(project, 201);
  });

  // GET /api/projects
  app.get('/api/projects', (c) => {
    const allProjects = ctx.db.select().from(projects).all();
    const result = allProjects.map((p) => {
      const openFindingsRow = ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(findings)
        .where(and(eq(findings.projectId, p.id), eq(findings.status, 'open')))
        .get();
      const lastRunRow = ctx.db
        .select({ finishedAt: runs.finishedAt })
        .from(runs)
        .where(eq(runs.projectId, p.id))
        .orderBy(desc(runs.createdAt))
        .limit(1)
        .get();
      return {
        ...p,
        openFindings: openFindingsRow?.count ?? 0,
        lastRunAt: lastRunRow?.finishedAt ?? null,
      };
    });
    return c.json(result);
  });

  // GET /api/projects/:id
  app.get('/api/projects/:id', (c) => {
    const project = ctx.db.select().from(projects).where(eq(projects.id, c.req.param('id'))).get();
    if (!project) return c.json({ error: 'Project not found' }, 404);
    return c.json(project);
  });

  // PATCH /api/projects/:id
  app.patch('/api/projects/:id', zValidator('json', UpdateProjectBody), (c) => {
    const id = c.req.param('id');
    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get();
    if (!project) return c.json({ error: 'Project not found' }, 404);
    const body = c.req.valid('json');
    const updates: Partial<typeof projects.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.baseUrl !== undefined) updates.baseUrl = body.baseUrl;
    if (body.environments !== undefined) updates.environments = body.environments;
    if (body.defaultViewport !== undefined) updates.defaultViewport = body.defaultViewport;
    if (Object.keys(updates).length > 0) {
      ctx.db.update(projects).set(updates).where(eq(projects.id, id)).run();
    }
    const updated = ctx.db.select().from(projects).where(eq(projects.id, id)).get()!;
    return c.json(updated);
  });

  return app;
}
