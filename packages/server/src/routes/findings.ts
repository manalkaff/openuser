import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { ServerContext } from '../app.js';
import { findings } from '../db/schema.js';

const PatchFindingBody = z.object({
  status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']),
});

export function findingsRouter(ctx: ServerContext) {
  const app = new Hono();

  // GET /api/findings?projectId&severity&type&status
  app.get('/api/findings', (c) => {
    const projectId = c.req.query('projectId');
    const severity = c.req.query('severity');
    const type = c.req.query('type');
    const status = c.req.query('status');

    const conditions = [];
    if (projectId) conditions.push(eq(findings.projectId, projectId));
    if (severity) conditions.push(eq(findings.severity, severity as typeof findings.$inferSelect['severity']));
    if (type) conditions.push(eq(findings.type, type as typeof findings.$inferSelect['type']));
    if (status) conditions.push(eq(findings.status, status as typeof findings.$inferSelect['status']));

    const result = conditions.length > 0
      ? ctx.db.select().from(findings).where(and(...conditions)).all()
      : ctx.db.select().from(findings).all();

    return c.json(result);
  });

  // PATCH /api/findings/:id
  app.patch('/api/findings/:id', zValidator('json', PatchFindingBody), (c) => {
    const id = c.req.param('id');
    const finding = ctx.db.select().from(findings).where(eq(findings.id, id)).get();
    if (!finding) return c.json({ error: 'Finding not found' }, 404);

    const body = c.req.valid('json');
    ctx.db.update(findings).set({ status: body.status }).where(eq(findings.id, id)).run();
    const updated = ctx.db.select().from(findings).where(eq(findings.id, id)).get()!;
    return c.json(updated);
  });

  return app;
}
