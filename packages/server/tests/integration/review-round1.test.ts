// BISNIS-41 review round 1: R1-F1, F3, F4 (server behaviour) and F8 (legacy findings).
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, api, type Harness } from '../acceptance/helpers.js';
import { backfillFingerprints, openDatabase } from '../../src/db/client.js';

describe('BISNIS-41 review round 1', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  const high = { type: 'functional', severity: 'high', title: 'Pay fails', description: 'x', route: '/pay' };

  it('R1-F1 a repeated defect still fails the verdict and shows in the current run', async () => {
    h = await startHarness();
    const a = await h.startRun();
    await h.finding(a.token, high);
    const ca = await h.complete(a.token, { verdict: 'goal_achieved' });
    expect(ca.body.status).toBe('failed');

    const b = await h.startRun();
    await h.finding(b.token, high);
    const cb = await h.complete(b.token, { verdict: 'goal_achieved' });
    expect(cb.body.status).toBe('failed');
    expect(cb.body.findings).toHaveLength(1);

    const detail = await api(h.port, 'GET', `/api/runs/${b.runId}`);
    expect(detail.body.findings).toHaveLength(1);
    const report = await fetch(`http://127.0.0.1:${h.port}/api/runs/${b.runId}/report`).then((r) => r.text());
    expect(report).toContain('Pay fails');

    // still one project-level row
    const list = await api(h.port, 'GET', `/api/findings?projectId=${h.projectId}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].occurrences).toBe(2);
  });

  it('R1-F3 token exhaustion saves a checkpoint and keeps the reported tokens', async () => {
    h = await startHarness();
    await api(h.port, 'PATCH', '/api/settings', { maxTokens: 10 });
    const r = await h.startRun();
    const done = await h.complete(r.token, { tokens: 10 });
    expect(done.body.status).toBe('budget_exhausted');
    const chk = await api(h.port, 'GET', `/api/projects/${h.projectId}/checkpoints`);
    expect((chk.body as any[]).some((c) => c.createdFromRunId === r.runId)).toBe(true);
    const run = await api(h.port, 'GET', `/api/runs/${r.runId}`);
    expect(run.body.telemetry.tokens).toBe(10);
  });

  it('R1-F4 the wall-clock limit ends the run on any tester call and on complete', async () => {
    h = await startHarness();
    await api(h.port, 'PATCH', '/api/settings', { maxMinutes: 1, watchdogMinutes: 120 });
    const sqlite = new Database(join(h.homeDir, 'openuser.db'));
    const age = (runId: string) =>
      sqlite.prepare('UPDATE runs SET started_at = ? WHERE id = ?').run(Date.now() - 61_000, runId);
    try {
      const a = await h.startRun();
      age(a.runId);
      const snap = await api(h.port, 'POST', '/api/tester/snapshot', {}, a.token);
      expect(snap.status).toBe(409);
      const ra = await api(h.port, 'GET', `/api/runs/${a.runId}`);
      expect(ra.body.status).toBe('budget_exhausted');
      const chk = await api(h.port, 'GET', `/api/projects/${h.projectId}/checkpoints`);
      expect((chk.body as any[]).some((c) => c.createdFromRunId === a.runId)).toBe(true);

      const b = await h.startRun();
      age(b.runId);
      const done = await h.complete(b.token, { verdict: 'goal_achieved' });
      expect(done.body.status ?? done.body.error).toMatch(/budget_exhausted|budget exhausted/);
      const rb = await api(h.port, 'GET', `/api/runs/${b.runId}`);
      expect(rb.body.status).toBe('budget_exhausted');
    } finally {
      sqlite.close();
    }
  });
});

describe('BISNIS-41 review round 1: legacy findings (R1-F8)', () => {
  it('backfills fingerprints and merges historical duplicates', () => {
    const home = mkdtempSync(join(tmpdir(), 'legacy-'));
    const { db, sqlite } = openDatabase(home);
    const now = Date.now();
    sqlite.exec(`
      INSERT INTO projects (id,name,path,base_url,environments,default_viewport,created_at) VALUES ('p','P','/p','http://x','[]','{"width":1,"height":1}',${now});
      INSERT INTO personas (id,project_id,name,role,identity,behavior,knowledge,archived,created_at) VALUES ('u','p','A','r','{}','{}','{}',0,${now});
      INSERT INTO runs (id,project_id,persona_id,base_url_resolved,status,token_hash,created_at) VALUES ('r1','p','u','http://x','failed','h1',${now}),('r2','p','u','http://x','failed','h2',${now});
      INSERT INTO findings (id,run_id,project_id,type,severity,title,description,evidence,status,created_at) VALUES
        ('f1','r1','p','functional','high','Pay fails','d','{}','open',${now}),
        ('f2','r2','p','functional','high','  pay FAILS ','d','{}','open',${now + 1});
      DELETE FROM run_findings;
      INSERT INTO run_findings (run_id,finding_id,created_at) VALUES ('r1','f1',${now}),('r2','f2',${now + 1});
    `);
    backfillFingerprints(db);
    const rows = sqlite.prepare('SELECT id, fingerprint, occurrences FROM findings').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('f1');
    expect(rows[0].fingerprint).toBeTruthy();
    expect(rows[0].occurrences).toBe(2);
    const links = sqlite.prepare('SELECT run_id FROM run_findings WHERE finding_id = ? ORDER BY run_id').all('f1') as any[];
    expect(links.map((l) => l.run_id)).toEqual(['r1', 'r2']);
    sqlite.close();
  });
});
