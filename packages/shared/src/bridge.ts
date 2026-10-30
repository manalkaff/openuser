import type { Severity } from './enums.js';

/** A medium finding is only filed once it has been seen this many times. */
export const BRIDGE_MEDIUM_MIN_OCCURRENCES = 3;

/** One deduped finding with the context the issue body needs. */
export interface BridgeCandidate {
  id: string;
  fingerprint: string;
  severity: Severity;
  title: string;
  description: string;
  occurrences: number;
  lastSeen: string;
  runId: string;
  personaName: string;
  steps: { idx: number; description: string; note: string | null }[];
  screenshotUrls: string[];
  /** Multica issue id once filed; null before. */
  issueId: string | null;
}

export type Priority = 'P1' | 'P2' | 'P3';

/** critical → P1, high → P2, medium → P3. Never P0; low is digest-only (null). */
export function priorityForSeverity(severity: Severity): Priority | null {
  if (severity === 'critical') return 'P1';
  if (severity === 'high') return 'P2';
  if (severity === 'medium') return 'P3';
  return null;
}

export function shouldFileFinding(f: Pick<BridgeCandidate, 'severity' | 'occurrences'>): boolean {
  if (f.severity === 'critical' || f.severity === 'high') return true;
  return f.severity === 'medium' && f.occurrences >= BRIDGE_MEDIUM_MIN_OCCURRENCES;
}

export function buildIssueTitle(f: BridgeCandidate, priority: Priority): string {
  return `[${priority}] ${f.title}`;
}

function describeStep(s: BridgeCandidate['steps'][number]): string {
  let text = s.description;
  try {
    const a = JSON.parse(s.description) as { kind?: string; ref?: string; url?: string; text?: string };
    text = [a.kind, a.ref ?? a.url ?? a.text].filter(Boolean).join(' ');
  } catch {
    // free text step
  }
  return s.note ? `${text} (${s.note})` : text;
}

export function buildIssueBody(f: BridgeCandidate, priority: Priority): string {
  const steps = f.steps.length > 0 ? f.steps.map((s, i) => `${i + 1}. ${describeStep(s)}`).join('\n') : '(no steps recorded)';
  const shots = f.screenshotUrls.length > 0 ? f.screenshotUrls.map((u) => `- ${u}`).join('\n') : '(none captured)';
  return [
    `Labels: kind:finding`,
    `Priority: ${priority}`,
    `Severity: ${f.severity}`,
    '',
    f.description,
    '',
    '## Steps',
    steps,
    '',
    '## Screenshots',
    shots,
    '',
    '## Context',
    `- Persona: ${f.personaName}`,
    `- Run: ${f.runId}`,
    `- Occurrences: ${f.occurrences}`,
    `- Fingerprint: ${f.fingerprint}`,
    '',
  ].join('\n');
}

export function buildOccurrenceComment(f: BridgeCandidate): string {
  return `Seen again by OpenUser: ${f.occurrences} occurrences, last seen ${f.lastSeen}.\n\nFingerprint: ${f.fingerprint}\n`;
}

/** Side effects the bridge needs, injected so shared stays free of node APIs. */
export interface BridgeExec {
  /** Create a Multica issue; returns its id. */
  createIssue(args: { title: string; body: string; priority: Priority }): string;
  commentIssue(issueId: string, body: string): void;
  /** Apply the kind:finding label; false when it could not be applied (never throws). */
  labelIssue(issueId: string): boolean;
  /** Persist the issue id on the finding so a re-run comments instead of filing. */
  recordIssue(findingId: string, issueId: string): Promise<void>;
}

export interface BridgeResult {
  filed: { findingId: string; issueId: string; priority: Priority }[];
  commented: { findingId: string; issueId: string }[];
  digestOnly: number;
  skipped: number;
  /** Issues that could not be labelled kind:finding; the next run retries them. */
  unlabelled: string[];
}

export async function runBridge(candidates: BridgeCandidate[], exec: BridgeExec): Promise<BridgeResult> {
  const result: BridgeResult = { filed: [], commented: [], digestOnly: 0, skipped: 0, unlabelled: [] };
  for (const f of candidates) {
    if (f.issueId) {
      exec.commentIssue(f.issueId, buildOccurrenceComment(f));
      if (!exec.labelIssue(f.issueId)) result.unlabelled.push(f.issueId);
      result.commented.push({ findingId: f.id, issueId: f.issueId });
      continue;
    }
    const priority = priorityForSeverity(f.severity);
    if (priority === null) {
      result.digestOnly++;
      continue;
    }
    if (!shouldFileFinding(f)) {
      result.skipped++;
      continue;
    }
    const issueId = exec.createIssue({ title: buildIssueTitle(f, priority), body: buildIssueBody(f, priority), priority });
    await exec.recordIssue(f.id, issueId);
    if (!exec.labelIssue(issueId)) result.unlabelled.push(issueId);
    result.filed.push({ findingId: f.id, issueId, priority });
  }
  return result;
}
