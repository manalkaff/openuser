import type { Context, MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { runs } from '../../db/schema.js';
import type { RunnerSession } from '../../runner/types.js';

export type ActiveSessions = Map<string, RunnerSession>;

export function makeTokenAuth(db: DB, activeSessions: ActiveSessions): MiddlewareHandler {
  return async (c: Context, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }
    const token = authHeader.slice(7).trim();
    if (!token.startsWith('rt_')) {
      return c.json({ error: 'Invalid token format' }, 401);
    }

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const run = db.select().from(runs).where(eq(runs.tokenHash, tokenHash)).get();

    if (!run) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    // Tokens are only valid while the run is pending or running
    if (run.status !== 'pending' && run.status !== 'running') {
      return c.json({ error: 'Token has expired (run is no longer active)' }, 401);
    }

    const session = activeSessions.get(run.id);

    c.set('run', run);
    c.set('runnerSession', session ?? null);
    await next();
  };
}
