import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { runs, steps } from '../db/schema.js';

type Run = typeof runs.$inferSelect;

export interface RunTelemetry {
  steps: number;
  wallClockMs: number;
  tokens: number;
  newFindings: number;
  duplicateFindings: number;
}

/** Telemetry for one run record; wall clock runs to now while the run is still going. */
export function runTelemetry(run: Run, stepCount: number, now: number = Date.now()): RunTelemetry {
  const start = run.startedAt?.getTime();
  const end = run.finishedAt?.getTime() ?? now;
  return {
    steps: stepCount,
    wallClockMs: start === undefined ? 0 : Math.max(0, end - start),
    tokens: run.tokens,
    newFindings: run.newFindings,
    duplicateFindings: run.duplicateFindings,
  };
}

export interface TelemetrySummary extends RunTelemetry {
  runs: number;
  budgetExhausted: number;
}

/** Totals over a project's runs (or all runs), for the daily digest. */
export function telemetrySummary(db: DB, projectId?: string): TelemetrySummary {
  const all = projectId
    ? db.select().from(runs).where(eq(runs.projectId, projectId)).all()
    : db.select().from(runs).all();
  const sum: TelemetrySummary = {
    runs: all.length,
    budgetExhausted: 0,
    steps: 0,
    wallClockMs: 0,
    tokens: 0,
    newFindings: 0,
    duplicateFindings: 0,
  };
  for (const run of all) {
    const stepCount = db.select({ id: steps.id }).from(steps).where(eq(steps.runId, run.id)).all().length;
    const t = runTelemetry(run, stepCount);
    sum.steps += t.steps;
    sum.wallClockMs += t.wallClockMs;
    sum.tokens += t.tokens;
    sum.newFindings += t.newFindings;
    sum.duplicateFindings += t.duplicateFindings;
    if (run.status === 'budget_exhausted') sum.budgetExhausted++;
  }
  return sum;
}
