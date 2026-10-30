import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { ServerContext } from '../app.js';
import { listBridgeCandidates, recordFindingIssue } from '../services/bridge.service.js';

const RecordIssueBody = z.object({ issueId: z.string().min(1) });

export function bridgeRouter(ctx: ServerContext) {
  const app = new Hono();

  // GET /api/bridge/findings?projectId — deduped findings with the context an issue needs
  app.get('/api/bridge/findings', (c) => {
    const projectId = c.req.query('projectId');
    if (!projectId) return c.json({ error: 'projectId is required' }, 400);
    const origin = new URL(c.req.url).origin;
    return c.json(listBridgeCandidates(ctx.db, projectId, (rel) => `${origin}/artifacts/${rel}`));
  });

  // POST /api/findings/:id/issue — remember the Multica issue filed for this fingerprint
  app.post('/api/findings/:id/issue', zValidator('json', RecordIssueBody), (c) => {
    if (!recordFindingIssue(ctx.db, c.req.param('id'), c.req.valid('json').issueId)) {
      return c.json({ error: 'Finding not found' }, 404);
    }
    return c.json({ ok: true });
  });

  return app;
}
