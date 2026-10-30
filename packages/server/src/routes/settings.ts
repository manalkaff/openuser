import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { ServerContext } from '../app.js';
import { GUARD_KEYS } from '../services/settings.service.js';

const PatchSettingsBody = z.object({
  watchdogMinutes: z.number().int().min(1).max(120).optional(),
  headed: z.boolean().optional(),
  browserChannel: z.string().min(1).optional(),
  maxSteps: z.number().int().min(1).optional(),
  maxMinutes: z.number().min(1).optional(),
  maxTokens: z.number().int().min(1).optional(),
});

export function settingsRouter(ctx: ServerContext) {
  const app = new Hono();

  // GET /api/settings
  app.get('/api/settings', (c) => {
    return c.json(ctx.settings.getAll());
  });

  // PATCH /api/settings. The guard settings run shell commands or switch off the production
  // deny list, so they are refused here and come only from config or CLI flags.
  app.patch('/api/settings', async (c, next) => {
    const body: unknown = await c.req.json().catch(() => null);
    const refused = body && typeof body === 'object' ? GUARD_KEYS.filter((k) => k in body) : [];
    if (refused.length > 0) {
      return c.json(
        { error: `${refused.join(', ')} can only be set from config or CLI flags, not through the API` },
        403,
      );
    }
    return next();
  });
  app.patch('/api/settings', zValidator('json', PatchSettingsBody), (c) => {
    const body = c.req.valid('json');
    // Build a clean partial with no undefined values (exactOptionalPropertyTypes)
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) patch[key] = value;
    }
    const updated = ctx.settings.patch(patch as Parameters<typeof ctx.settings.patch>[0]);
    return c.json(updated);
  });

  return app;
}
