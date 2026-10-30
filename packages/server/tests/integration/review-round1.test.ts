// BISNIS-41 review round 1: R1-F1, F3, F4 (server behaviour) and F8 (legacy findings).
import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHarness, api, type Harness } from '../acceptance/helpers.js';
import { backfillFingerprints, openDatabase } from '../../src/db/client.js';
import { listBridgeCandidates } from '../../src/services/bridge.service.js';

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

  it('R2-F2 an overdue completion keeps its reported tokens, verdict summary and the digest total', async () => {
    h = await startHarness();
    await api(h.port, 'PATCH', '/api/settings', { maxMinutes: 1, watchdogMinutes: 120 });
    const sqlite = new Database(join(h.homeDir, 'openuser.db'));
    try {
      const r = await h.startRun();
      sqlite.prepare('UPDATE runs SET started_at = ? WHERE id = ?').run(Date.now() - 61_000, r.runId);
      const done = await h.complete(r.token, { verdict: 'goal_achieved', summary: 'finished late', tokens: 777 });
      expect(done.body.status).toBe('budget_exhausted');
      const run = await api(h.port, 'GET', `/api/runs/${r.runId}`);
      expect(run.body.status).toBe('budget_exhausted');
      expect(run.body.telemetry.tokens).toBe(777);
      expect(run.body.summary).toContain('finished late');
      const sum = await api(h.port, 'GET', `/api/telemetry/summary?projectId=${h.projectId}`);
      expect(sum.body.tokens).toBe(777);
    } finally {
      sqlite.close();
    }
  });
});

describe('BISNIS-41 review round 2: legacy findings (R2-F1)', () => {
  function legacyDb() {
    const home = mkdtempSync(join(tmpdir(), 'legacy-'));
    const handle = openDatabase(home);
    const now = Date.now();
    handle.sqlite.exec(`
      INSERT INTO projects (id,name,path,base_url,environments,default_viewport,created_at) VALUES ('p','P','/p','http://x','[]','{"width":1,"height":1}',${now});
      INSERT INTO personas (id,project_id,name,role,identity,behavior,knowledge,archived,created_at) VALUES ('u','p','A','r','{}','{}','{}',0,${now});
      INSERT INTO runs (id,project_id,persona_id,base_url_resolved,status,token_hash,created_at) VALUES ('r1','p','u','http://x','failed','h1',${now}),('r2','p','u','http://x','failed','h2',${now});
    `);
    return { ...handle, now };
  }

  it('(a) same title on different pages stays two findings with different fingerprints', () => {
    const { db, sqlite, now } = legacyDb();
    sqlite.exec(`
      INSERT INTO steps (id,run_id,idx,kind,description,page_url,status,created_at) VALUES
        ('s1','r1',0,'click','{}','http://x/catalog','ok',${now}),
        ('s2','r2',0,'click','{}','http://x/billing','ok',${now});
      INSERT INTO findings (id,run_id,step_id,project_id,type,severity,title,description,evidence,status,created_at) VALUES
        ('f1','r1','s1','p','functional','high','Button does nothing','catalog desc','{}','open',${now}),
        ('f2','r2','s2','p','functional','high','Button does nothing','billing desc','{}','open',${now + 1});
    `);
    backfillFingerprints(db);
    const rows = sqlite.prepare('SELECT id, fingerprint, description FROM findings ORDER BY id').all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].fingerprint).toBeTruthy();
    expect(rows[1].fingerprint).toBeTruthy();
    expect(rows[0].fingerprint).not.toBe(rows[1].fingerprint);
    expect(rows.map((r) => r.description)).toEqual(['catalog desc', 'billing desc']);
    sqlite.close();
  });

  it('(b) identical legacy rows are never merged or deleted; the later one keeps a NULL fingerprint', () => {
    const { db, sqlite, now } = legacyDb();
    sqlite.exec(`
      INSERT INTO findings (id,run_id,project_id,type,severity,title,description,evidence,status,created_at) VALUES
        ('f1','r1','p','functional','high','Pay fails','d','{}','open',${now}),
        ('f2','r2','p','functional','high','Pay fails','d','{}','open',${now + 1});
    `);
    sqlite.exec(`DELETE FROM run_findings; INSERT INTO run_findings (run_id,finding_id,created_at) VALUES ('r1','f1',${now}),('r2','f2',${now + 1});`);
    backfillFingerprints(db);
    backfillFingerprints(db); // idempotent
    const rows = sqlite.prepare('SELECT id, fingerprint, occurrences FROM findings ORDER BY id').all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].fingerprint).toBeTruthy();
    expect(rows[1].fingerprint).toBeNull();
    expect(rows.map((r) => r.occurrences)).toEqual([1, 1]);
    const links = sqlite.prepare('SELECT run_id, finding_id FROM run_findings ORDER BY run_id').all() as any[];
    expect(links).toEqual([
      { run_id: 'r1', finding_id: 'f1' },
      { run_id: 'r2', finding_id: 'f2' },
    ]);
    sqlite.close();
  });

  it('(c) a legacy high finding is a bridge candidate after the backfill', () => {
    const { db, sqlite, now } = legacyDb();
    sqlite.exec(`
      INSERT INTO findings (id,run_id,project_id,type,severity,title,description,evidence,status,created_at) VALUES
        ('f1','r1','p','functional','high','Button does nothing','d','{}','open',${now});
    `);
    expect(listBridgeCandidates(db, 'p', (r) => r)).toHaveLength(0);
    backfillFingerprints(db);
    const cands = listBridgeCandidates(db, 'p', (r) => r);
    expect(cands.map((c) => c.id)).toEqual(['f1']);
    sqlite.close();
  });
});
