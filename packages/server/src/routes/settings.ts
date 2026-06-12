import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { ServerContext } from '../app.js';

const PatchSettingsBody = z.object({
  watchdogMinutes: z.number().int().min(1).max(120).optional(),
  headed: z.boolean().optional(),
  browserChannel: z.string().min(1).optional(),
});

export function settingsRouter(ctx: ServerContext) {
  const app = new Hono();

  // GET /api/settings
  app.get('/api/settings', (c) => {
    return c.json(ctx.settings.getAll());
  });

  // PATCH /api/settings
  app.patch('/api/settings', zValidator('json', PatchSettingsBody), (c) => {
    const body = c.req.valid('json');
    // Build a clean partial with no undefined values (exactOptionalPropertyTypes)
    const patch: Record<string, unknown> = {};
    if (body.watchdogMinutes !== undefined) patch['watchdogMinutes'] = body.watchdogMinutes;
    if (body.headed !== undefined) patch['headed'] = body.headed;
    if (body.browserChannel !== undefined) patch['browserChannel'] = body.browserChannel;
    const updated = ctx.settings.patch(patch as Parameters<typeof ctx.settings.patch>[0]);
    return c.json(updated);
  });

  return app;
}
