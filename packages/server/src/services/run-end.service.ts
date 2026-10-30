import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { runs, steps, type Verdict } from '../db/schema.js';
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
  private readonly deadlines = new Map<string, ReturnType<typeof setTimeout>>();

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

  /** Start the wall-clock deadline timer for a run that began at `startedAtMs`. */
  scheduleDeadline(runId: string, startedAtMs: number = Date.now()): void {
    this.clearDeadline(runId);
    const ms = Math.max(0, startedAtMs + this.settings.get('maxMinutes') * 60_000 - Date.now());
    const timer = setTimeout(() => {
      void this.onDeadline(runId);
    }, ms);
    if (typeof timer.unref === 'function') timer.unref();
    this.deadlines.set(runId, timer);
  }

  clearDeadline(runId: string): void {
    const timer = this.deadlines.get(runId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.deadlines.delete(runId);
    }
  }

  /** The deadline timer fired: end the run if it is still going. */
  async onDeadline(runId: string): Promise<void> {
    this.deadlines.delete(runId);
    const run = this.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run || run.status !== 'running') return;
    await this.exhaust(run, { kind: 'minutes', reason: `${this.settings.get('maxMinutes')} minutes` });
  }

  /** Called before accepting any tester operation: ends the run when its wall-clock limit has passed. */
  async enforceDeadline(
    run: Run,
    extra: { tokens?: number; verdict?: Verdict; summary?: string } = {},
  ): Promise<BudgetLimit | null> {
    const limit = this.checkRun(run);
    if (limit?.kind !== 'minutes') return null;
    await this.exhaust(run, limit, extra);
    return limit;
  }

  async exhaust(
    run: Run,
    limit: BudgetLimit,
    extra: { tokens?: number; verdict?: Verdict; summary?: string } = {},
  ): Promise<void> {
    this.clearDeadline(run.id);
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
    new RunLifecycleService(this.db, this.wsHub).budgetExhausted(run.id, limit.reason, videoPath, extra);
    await this.guards.release(run.id);
  }
}
