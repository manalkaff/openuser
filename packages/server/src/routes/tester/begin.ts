import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { ServerContext } from '../../app.js';
import type { ActiveSessions } from './auth.js';
import { makeTokenAuth } from './auth.js';
import type { TesterVariables } from './context.js';
import { personas, checkpoints } from '../../db/schema.js';
import { createRunnerSession, defaultRunnerKind } from '../../runner/factory.js';
import type { LogPipelineService } from '../../services/log-pipeline.service.js';
import { RunLifecycleService } from '../../services/run-lifecycle.service.js';

export function beginRouter(ctx: ServerContext, activeSessions: ActiveSessions, logPipeline: LogPipelineService) {
  const app = new Hono<{ Variables: TesterVariables }>();
  const authMiddleware = makeTokenAuth(ctx.db, activeSessions);
  const lifecycle = new RunLifecycleService(ctx.db, ctx.wsHub);

  app.post('/api/tester/begin', authMiddleware, async (c) => {
    const run = c.get('run');

    if (run.status !== 'pending') {
      return c.json({ error: 'Run is not in pending state' }, 409);
    }

    // Preflight: check baseUrl reachability
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(run.baseUrlResolved, { signal: controller.signal });
      clearTimeout(timeout);
      // Any HTTP response (even 4xx) means the server is up
      if (res.status >= 500) {
        return c.json({ error: `Target app returned ${res.status} — is it running at ${run.baseUrlResolved}?` }, 422);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        return c.json(
          { error: `Target app at ${run.baseUrlResolved} did not respond within the timeout` },
          422,
        );
      }
      return c.json(
        { error: `Target app unreachable at ${run.baseUrlResolved} — start your dev server first` },
        422,
      );
    }

    const persona = ctx.db.select().from(personas).where(eq(personas.id, run.personaId)).get();
    if (!persona) return c.json({ error: 'Persona not found' }, 500);

    // Resolve checkpoint storageState
    let storageStatePath: string | undefined;
    let journeyNotes: string | undefined;
    if (run.checkpointId) {
      const chk = ctx.db.select().from(checkpoints).where(eq(checkpoints.id, run.checkpointId)).get();
      if (chk) {
        storageStatePath = chk.storageStatePath;
        journeyNotes = chk.journey.notes;
      }
    }

    const settings = ctx.settings.getAll();
    const session = createRunnerSession(defaultRunnerKind());
    activeSessions.set(run.id, session);

    // Set up log pipeline callbacks
    logPipeline.setCurrentStep(run.id, 0);

    const videoDir = `${ctx.homeDir}/artifacts/${run.id}`;
    const viewport = persona.behavior.viewport;

    const snapshot = await session.begin({
      baseUrl: run.baseUrlResolved,
      viewport,
      ...(storageStatePath !== undefined ? { storageStatePath } : {}),
      videoDir,
      headed: settings.headed,
      onConsole: (e) => logPipeline.handleConsole(run.id, e),
      onNetwork: (e) => logPipeline.handleNetwork(run.id, e),
    });

    // Mark run as running and start watchdog
    lifecycle.updateStatus(run.id, 'running', { startedAt: new Date() });
    ctx.watchdogReset?.(run.id);

    const personaCard = lifecycle.buildPersonaCard(persona);
    const mission = lifecycle.buildMission(run);

    return c.json({
      personaCard,
      mission,
      journeyNotes,
      snapshot,
    });
  });

  return app;
}
