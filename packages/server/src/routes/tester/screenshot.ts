import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';

export function screenshotRouter(ctx: ServerContext, activeSessions: ActiveSessions) {
  const app = new Hono<{ Variables: TesterVariables }>();
  const authMiddleware = makeTokenAuth(ctx.db, activeSessions);

  app.post('/api/tester/screenshot', authMiddleware, async (c) => {
    const run = c.get('run');

    if (run.status !== 'running') {
      return c.json({ error: 'Run is not in running state' }, 409);
    }

    const session = activeSessions.get(run.id);
    if (!session) {
      return c.json({ error: 'No active runner session for this run' }, 500);
    }

    const shotsDir = join(ctx.homeDir, 'artifacts', run.id, 'shots');
    mkdirSync(shotsDir, { recursive: true });

    const { path: absPath } = await session.screenshot(shotsDir);
    // Return path RELATIVE to the artifacts root so MCP can build the URL as:
    //   GET /artifacts/<relativePath>  (e.g. "run_abc/shots/xyz.png")
    const relativePath = absPath.replace(join(ctx.homeDir, 'artifacts') + '/', '');
    return c.json({ path: relativePath });
  });

  return app;
}
