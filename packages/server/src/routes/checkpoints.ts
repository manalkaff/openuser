import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerContext } from '../app.js';
import { checkpoints, projects } from '../db/schema.js';

export function checkpointsRouter(ctx: ServerContext) {
  const app = new Hono();

  // GET /api/projects/:id/checkpoints
  app.get('/api/projects/:id/checkpoints', (c) => {
    const projectId = c.req.param('id');
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) return c.json({ error: 'Project not found' }, 404);

    const result = ctx.db.select().from(checkpoints).where(eq(checkpoints.projectId, projectId)).all();
    return c.json(result);
  });

  // DELETE /api/checkpoints/:id
  app.delete('/api/checkpoints/:id', (c) => {
    const id = c.req.param('id');
    const checkpoint = ctx.db.select().from(checkpoints).where(eq(checkpoints.id, id)).get();
    if (!checkpoint) return c.json({ error: 'Checkpoint not found' }, 404);

    // Remove files from disk (best-effort)
    const checkpointDir = join(ctx.homeDir, 'checkpoints', id);
    try {
      rmSync(checkpointDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }

    ctx.db.delete(checkpoints).where(eq(checkpoints.id, id)).run();
    return c.json({ ok: true });
  });

  return app;
}
