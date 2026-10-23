// BISNIS-41 AC5: P0 item 5, telemetry on the run record plus a digest summary.
import { describe, it, expect, afterEach } from 'vitest';
import { startHarness, api, type Harness } from './helpers.js';

describe('BISNIS-41 acceptance', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('AC5 run record carries steps, time, tokens, new and duplicate findings, and a summary is readable', async () => {
    h = await startHarness();
    const defect = { type: 'functional', severity: 'high', title: 'Pay fails', description: 'x', route: '/pay' };

    const a = await h.startRun();
    await h.action(a.token);
    await h.action(a.token);
    await h.finding(a.token, defect);
    await h.complete(a.token, { tokens: 1000 });

    const b = await h.startRun();
    await h.action(b.token);
    await h.finding(b.token, defect);
    await h.complete(b.token, { tokens: 500 });

    const ra = (await api(h.port, 'GET', `/api/runs/${a.runId}`)).body;
    expect(ra.telemetry.steps).toBe(2);
    expect(ra.telemetry.tokens).toBe(1000);
    expect(ra.telemetry.newFindings).toBe(1);
    expect(ra.telemetry.duplicateFindings).toBe(0);
    expect(ra.telemetry.wallClockMs).toBeGreaterThanOrEqual(0);

    const rb = (await api(h.port, 'GET', `/api/runs/${b.runId}`)).body;
    expect(rb.telemetry.steps).toBe(1);
    expect(rb.telemetry.tokens).toBe(500);
    expect(rb.telemetry.newFindings).toBe(0);
    expect(rb.telemetry.duplicateFindings).toBe(1);

    const sum = await api(h.port, 'GET', `/api/telemetry/summary?projectId=${h.projectId}`);
    expect(sum.status).toBe(200);
    expect(sum.body).toMatchObject({ runs: 2, steps: 3, tokens: 1500, newFindings: 1, duplicateFindings: 1 });
  });
});
