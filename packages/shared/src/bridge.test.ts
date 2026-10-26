import { describe, it, expect } from 'vitest';
import {
  priorityForSeverity,
  shouldFileFinding,
  buildIssueBody,
  runBridge,
  type BridgeCandidate,
  type BridgeExec,
} from './bridge.js';

const base: BridgeCandidate = {
  id: 'fnd_1',
  fingerprint: 'abc123',
  severity: 'high',
  title: 'Pay fails',
  description: 'Nothing happens',
  occurrences: 1,
  lastSeen: '2026-10-26T00:00:00.000Z',
  runId: 'run_x',
  personaName: 'Alice',
  steps: [{ idx: 0, description: JSON.stringify({ kind: 'click', ref: 'e7' }), note: 'pay' }],
  screenshotUrls: ['http://localhost:8737/artifacts/run_x/shots/1.png'],
  issueId: null,
};

describe('priorityForSeverity', () => {
  it('maps critical/high/medium to P1/P2/P3 and low to digest only', () => {
    expect(priorityForSeverity('critical')).toBe('P1');
    expect(priorityForSeverity('high')).toBe('P2');
    expect(priorityForSeverity('medium')).toBe('P3');
    expect(priorityForSeverity('low')).toBeNull();
  });
});

describe('shouldFileFinding', () => {
  it('files high and critical at once, medium from 3 occurrences, never low', () => {
    expect(shouldFileFinding({ severity: 'critical', occurrences: 1 })).toBe(true);
    expect(shouldFileFinding({ severity: 'high', occurrences: 1 })).toBe(true);
    expect(shouldFileFinding({ severity: 'medium', occurrences: 2 })).toBe(false);
    expect(shouldFileFinding({ severity: 'medium', occurrences: 3 })).toBe(true);
    expect(shouldFileFinding({ severity: 'low', occurrences: 50 })).toBe(false);
  });
});

describe('buildIssueBody', () => {
  it('carries steps, screenshots, persona, run id and fingerprint, and never P0', () => {
    const body = buildIssueBody(base, 'P2');
    expect(body).toContain('1. click e7 (pay)');
    expect(body).toContain('/artifacts/run_x/shots/1.png');
    expect(body).toContain('Persona: Alice');
    expect(body).toContain('Run: run_x');
    expect(body).toContain('Fingerprint: abc123');
    expect(body).toContain('kind:finding');
    expect(body).not.toMatch(/\bP0\b/);
  });
});

describe('runBridge', () => {
  it('files new qualifying findings, comments on filed ones, counts the rest', async () => {
    const created: string[] = [];
    const comments: string[] = [];
    const recorded: Record<string, string> = {};
    const exec: BridgeExec = {
      createIssue: ({ title }) => {
        created.push(title);
        return `iss-${created.length}`;
      },
      commentIssue: (id) => comments.push(id),
      recordIssue: async (fid, iid) => {
        recorded[fid] = iid;
      },
    };
    const res = await runBridge(
      [
        base,
        { ...base, id: 'fnd_2', severity: 'low' },
        { ...base, id: 'fnd_3', severity: 'medium', occurrences: 2 },
        { ...base, id: 'fnd_4', issueId: 'iss-old' },
      ],
      exec,
    );
    expect(created).toEqual(['[P2] Pay fails']);
    expect(comments).toEqual(['iss-old']);
    expect(recorded).toEqual({ fnd_1: 'iss-1' });
    expect(res.digestOnly).toBe(1);
    expect(res.skipped).toBe(1);
  });
});
