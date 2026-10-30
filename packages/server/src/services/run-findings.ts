import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { findings, runFindings } from '../db/schema.js';

/** Findings a run hit, including known defects it re-found (deduped rows are shared across runs). */
export function findingsForRun(db: DB, runId: string): (typeof findings.$inferSelect)[] {
  return db
    .select({ f: findings })
    .from(runFindings)
    .innerJoin(findings, eq(runFindings.findingId, findings.id))
    .where(eq(runFindings.runId, runId))
    .orderBy(findings.createdAt)
    .all()
    .map((r) => r.f);
}

export function linkRunFinding(db: DB, runId: string, findingId: string): void {
  db.insert(runFindings).values({ runId, findingId, createdAt: new Date() }).onConflictDoNothing().run();
}
