// BISNIS-41 AC3 isolation, AC4 budget, AC6 run lock, AC7 production deny list.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startHarness, api, type Harness } from './helpers.js';

describe('BISNIS-41 acceptance', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('AC3 each run seeds its own tenant before it starts and deletes it afterwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acc-seed-'));
    const log = join(dir, 'tenants.log');
    // The seed and teardown commands come from config, never PATCH /api/settings (PR #6 security P1).
    h = await startHarness(undefined, {
      guards: {
        seedCommand: `echo "seed {tenant}" >> ${log}`,
        teardownCommand: `echo "delete {tenant}" >> ${log}`,
      },
    });
    const settings = await api(h.port, 'GET', '/api/settings');
    expect(settings.body.seedCommand).toContain('{tenant}');

    const r1 = await h.prepare();
    const r2 = await h.prepare();
    const t1 = `run-${r1.body.runId}`;
    const t2 = `run-${r2.body.runId}`;
    expect(t1).not.toBe(t2);

    // Seed has finished by the time begin answers.
    await h.begin(r1.body.token);
    expect(readFileSync(log, 'utf8').split('\n')).toContain(`seed ${t1}`);
    expect(readFileSync(log, 'utf8')).not.toContain(t2);

    await h.complete(r1.body.token);
    await h.begin(r2.body.token);
    await h.complete(r2.body.token);

    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toEqual([`seed ${t1}`, `delete ${t1}`, `seed ${t2}`, `delete ${t2}`]);
  });

  it('AC4 budget defaults are 150 steps, 20 minutes, 400k tokens, and a hit ends the run as budget_exhausted with a checkpoint', async () => {
    h = await startHarness();
    const s = await api(h.port, 'GET', '/api/settings');
    expect(s.body.maxSteps).toBe(150);
    expect(s.body.maxMinutes).toBe(20);
    expect(s.body.maxTokens).toBe(400000);

    await api(h.port, 'PATCH', '/api/settings', { maxSteps: 3 });
    const { runId, token } = await h.startRun();
    for (let i = 0; i < 5; i++) await h.action(token);

    const run = await api(h.port, 'GET', `/api/runs/${runId}`);
    expect(run.body.status).toBe('budget_exhausted');
    expect(run.body.status).not.toBe('failed');
    expect(run.body.steps.length).toBeLessThanOrEqual(3);

    const chk = await api(h.port, 'GET', `/api/projects/${h.projectId}/checkpoints`);
    expect((chk.body as any[]).some((c) => c.createdFromRunId === runId)).toBe(true);
  });

  it('AC6 a held lock file makes a second begin_run refuse until the first run ends', async () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'acc-lock-')), 'ui-sweep.lock');
    // The lock file comes from config, never PATCH /api/settings (PR #6 security P1).
    h = await startHarness(undefined, { guards: { lockFile: lock } });
    const settings = await api(h.port, 'GET', '/api/settings');
    expect(settings.body.lockFile).toBe(lock);

    const first = await h.startRun();
    expect(first.beginStatus).toBe(200);
    expect(existsSync(lock)).toBe(true);

    const second = await h.prepare();
    const refused = await h.begin(second.body.token);
    expect(refused.status).toBe(409);
    const stillPending = await api(h.port, 'GET', `/api/runs/${second.body.runId}`);
    expect(stillPending.body.status).toBe('pending');

    await h.complete(first.token);
    expect(existsSync(lock)).toBe(false);
    const retry = await h.begin(second.body.token);
    expect(retry.status).toBe(200);
  });

  it('AC7 a run whose target host is on the production deny list refuses to start', async () => {
    h = await startHarness('https://app.23bisnis.com');
    const s = await api(h.port, 'GET', '/api/settings');
    expect(s.body.denyHosts).toContain('23bisnis.com');

    const denied = await h.prepare();
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain('23bisnis.com');
    const runs = await api(h.port, 'GET', `/api/runs?projectId=${h.projectId}`);
    expect(runs.body).toHaveLength(0);
  });

  it('AC7 deny list matches whole domains only and is configurable', async () => {
    h = await startHarness('https://not23bisnis.com');
    const ok = await h.prepare();
    expect(ok.status).toBe(201); // lookalike suffix is not a match

    // The deny list is configured at daemon start, never PATCH /api/settings (PR #6 security P1).
    await h.close();
    h = await startHarness('https://not23bisnis.com', { guards: { denyHosts: ['not23bisnis.com'] } });
    const denied = await h.prepare();
    expect(denied.status).toBe(403);
  });
});
