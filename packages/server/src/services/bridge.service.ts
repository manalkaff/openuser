import { and, eq, ne } from 'drizzle-orm';
import type { BridgeCandidate } from '@openuser/shared';
import type { DB } from '../db/client.js';
import { findings, personas, runs, steps } from '../db/schema.js';

/**
 * Deduped, undismissed findings of a project with the context a Multica issue needs.
 * `artifactUrl` turns an artifact path (relative to the artifacts dir) into a link.
 */
export function listBridgeCandidates(db: DB, projectId: string, artifactUrl: (relPath: string) => string): BridgeCandidate[] {
  const rows = db
    .select()
    .from(findings)
    .where(and(eq(findings.projectId, projectId), ne(findings.status, 'dismissed')))
    .all();

  const out: BridgeCandidate[] = [];
  for (const f of rows) {
    if (!f.fingerprint) continue; // legacy row from before dedupe
    const run = db.select().from(runs).where(eq(runs.id, f.runId)).get();
    const persona = run ? db.select().from(personas).where(eq(personas.id, run.personaId)).get() : undefined;
    const runSteps = db.select().from(steps).where(eq(steps.runId, f.runId)).orderBy(steps.idx).all();
    const shots = [
      ...(f.evidence.screenshotPath ? [f.evidence.screenshotPath] : []),
      ...runSteps.map((s) => s.screenshotPath).filter((p): p is string => Boolean(p)),
    ];
    out.push({
      id: f.id,
      fingerprint: f.fingerprint,
      severity: f.severity,
      title: f.title,
      description: f.description,
      occurrences: f.occurrences,
      lastSeen: (f.lastSeen ?? f.createdAt).toISOString(),
      runId: f.runId,
      personaName: persona?.name ?? 'unknown',
      steps: runSteps.map((s) => ({ idx: s.idx, description: s.description, note: s.note })),
      screenshotUrls: [...new Set(shots)].map((p) => artifactUrl(p.replace(/^\/+/, ''))),
      issueId: f.issueId,
    });
  }
  return out;
}

/** Remember the Multica issue filed for a finding's fingerprint. False when the finding does not exist. */
export function recordFindingIssue(db: DB, findingId: string, issueId: string): boolean {
  const found = db.select({ id: findings.id }).from(findings).where(eq(findings.id, findingId)).get();
  if (!found) return false;
  db.update(findings).set({ issueId }).where(eq(findings.id, findingId)).run();
  return true;
}
