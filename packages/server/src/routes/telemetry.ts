import { Hono } from 'hono';
import type { ServerContext } from '../app.js';
import { telemetrySummary } from '../services/telemetry.service.js';

export function telemetryRouter(ctx: ServerContext) {
  const app = new Hono();

  // GET /api/telemetry/summary?projectId — totals for the daily digest
  app.get('/api/telemetry/summary', (c) => {
    return c.json(telemetrySummary(ctx.db, c.req.query('projectId')));
  });

  return app;
}
