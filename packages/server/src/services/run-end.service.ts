import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { steps, type runs } from '../db/schema.js';
import type { ActiveSessions } from '../routes/tester/auth.js';
import type { WsHub } from '../ws/hub.js';
import { saveRunCheckpoint } from './checkpoint.service.js';
import type { GuardsService } from './guards.service.js';
import { RunLifecycleService } from './run-lifecycle.service.js';
import type { SettingsService } from './settings.service.js';

type Run = typeof runs.$inferSelect;

export type BudgetLimit = { kind: 'steps' | 'minutes' | 'tokens'; reason: string };

/** Which per-run limit, if any, the run has reached. Pure so it can be unit tested. */
export function budgetLimitHit(
  usage: { steps: number; elapsedMs: number; tokens: number },
  limits: { maxSteps: number; maxMinutes: number; maxTokens: number },
): BudgetLimit | null {
  if (usage.steps >= limits.maxSteps) return { kind: 'steps', reason: `${limits.maxSteps} steps` };
  if (usage.elapsedMs >= limits.maxMinutes * 60_000) return { kind: 'minutes', reason: `${limits.maxMinutes} minutes` };
  if (usage.tokens >= limits.maxTokens) return { kind: 'tokens', reason: `${limits.maxTokens} tokens` };
  return null;
}

/** Ends a running run because of a budget limit: checkpoint, close, mark, release tenant and lock. */
export class RunEndService {
  constructor(
    private readonly db: DB,
    private readonly homeDir: string,
    private readonly wsHub: WsHub,
    private readonly settings: SettingsService,
    private readonly activeSessions: ActiveSessions,
    private readonly guards: GuardsService,
    private readonly watchdogCancel: (runId: string) => void,
  ) {}

  /** Limit reached by the steps and time recorded so far (tokens are reported at complete). */
  checkRun(run: Run): BudgetLimit | null {
    const stepCount = this.db.select({ id: steps.id }).from(steps).where(eq(steps.runId, run.id)).all().length;
    return budgetLimitHit(
      {
        steps: stepCount,
        elapsedMs: run.startedAt ? Date.now() - run.startedAt.getTime() : 0,
        tokens: 0,
      },
      {
        maxSteps: this.settings.get('maxSteps'),
        maxMinutes: this.settings.get('maxMinutes'),
        maxTokens: this.settings.get('maxTokens'),
      },
    );
  }

  async exhaust(run: Run, limit: BudgetLimit): Promise<void> {
    this.watchdogCancel(run.id);
    const session = this.activeSessions.get(run.id);
    let videoPath: string | undefined;
    if (session) {
      try {
        await saveRunCheckpoint(this.db, this.homeDir, run, session, {
          name: `Budget checkpoint — run ${run.id}`,
          description: `Saved automatically when the run hit its ${limit.reason} limit`,
          journeyNotes: `Run stopped at the ${limit.reason} budget; resume from here.`,
        });
      } catch {
        // best-effort: the run must still end
      }
      try {
        videoPath = (await session.close()).videoPath;
      } catch {
        // best-effort
      }
      this.activeSessions.delete(run.id);
    }
    new RunLifecycleService(this.db, this.wsHub).budgetExhausted(run.id, limit.reason, videoPath);
    await this.guards.release(run.id);
  }
}
