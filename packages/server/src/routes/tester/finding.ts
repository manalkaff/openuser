import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';
import { findings, steps } from '../../db/schema.js';
import type { FindingEvidence } from '../../db/schema.js';
import type { LogPipelineService } from '../../services/log-pipeline.service.js';
import { TesterFindingBodySchema } from '@openuser/shared';

export function findingRouter(
  ctx: ServerContext,
  activeSessions: ActiveSessions,
  logPipeline: LogPipelineService,
  watchdogReset: (runId: string) => void,
) {
  const app = new Hono<{ Variables: TesterVariables }>();
  const authMiddleware = makeTokenAuth(ctx.db, activeSessions);

  app.post('/api/tester/finding', zValidator('json', TesterFindingBodySchema), authMiddleware, async (c) => {
    const run = c.get('run');

    if (run.status !== 'running') {
      return c.json({ error: 'Run is not in running state' }, 409);
    }

    watchdogReset(run.id);

    const body = c.req.valid('json');
    const session = activeSessions.get(run.id);

    // Auto-attach current step
    const latestStep = ctx.db
      .select()
      .from(steps)
      .where(eq(steps.runId, run.id))
      .orderBy(steps.idx)
      .all()
      .at(-1);

    // Take auto-screenshot for evidence
    let screenshotPath: string | undefined;
    if (session) {
      const shotsDir = join(ctx.homeDir, 'artifacts', run.id, 'shots');
      mkdirSync(shotsDir, { recursive: true });
      try {
        const shot = await session.screenshot(shotsDir);
        // Store as relative path (same convention as /api/tester/screenshot)
        screenshotPath = shot.path.replace(join(ctx.homeDir, 'artifacts') + '/', '');
      } catch {
        // best-effort
      }
    }

    // Gather last 20 error-level log events
    const recentErrors = logPipeline.getRecentErrors(run.id, 20);
    const consoleExcerpt = recentErrors
      .filter((e) => e.kind === 'console')
      .map((e) => e.payload);
    const networkExcerpt = recentErrors
      .filter((e) => e.kind === 'network')
      .map((e) => {
        const p = e.payload as { kind?: string; method?: string; url?: string; status?: number; bodySnippet?: string };
        const entry: { method: string; url: string; status: number | 'failed'; bodySnippet?: string } = {
          method: String(p.method ?? ''),
          url: String(p.url ?? ''),
          status: p.kind === 'failed' ? ('failed' as const) : (p.status ?? 0),
        };
        if (p.bodySnippet !== undefined) {
          entry.bodySnippet = p.bodySnippet;
        }
        return entry;
      });

    const evidence: FindingEvidence = {};
    if (screenshotPath !== undefined) evidence.screenshotPath = screenshotPath;
    if (consoleExcerpt.length > 0) evidence.consoleExcerpt = consoleExcerpt;
    if (networkExcerpt.length > 0) evidence.networkExcerpt = networkExcerpt;

    const id = `fnd_${nanoid(12)}`;
    ctx.db.insert(findings).values({
      id,
      runId: run.id,
      stepId: latestStep?.id ?? null,
      projectId: run.projectId,
      type: body.type,
      severity: body.severity,
      title: body.title,
      description: body.description,
      evidence,
      status: 'open',
      createdAt: new Date(),
    }).run();

    const finding = ctx.db.select().from(findings).where(eq(findings.id, id)).get()!;
    ctx.wsHub.broadcastRun(run.id, 'finding.created', finding);

    return c.json(finding, 201);
  });

  return app;
}
