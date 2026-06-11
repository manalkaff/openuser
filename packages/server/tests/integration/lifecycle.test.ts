import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { createServer, type ServerInstance } from '../../src/app.js';

// ---- helpers ----

async function apiPost(port: number, path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function apiGet(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.json() };
}

async function apiPatch(port: number, path: string, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function apiDelete(port: number, path: string) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'DELETE' });
  return { status: res.status };
}

function collectWsEvents(port: number): { events: unknown[]; close: () => void } {
  const events: unknown[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'subscribe', channel: 'global' }));
  });
  ws.on('message', (data) => {
    try {
      events.push(JSON.parse(String(data)));
    } catch {
      // ignore
    }
  });
  return { events, close: () => ws.close() };
}

// A minimal HTTP server that just returns 200 to satisfy the begin preflight check
async function startFakeApp(): Promise<{ port: number; close: () => void }> {
  const http = await import('node:http');
  return new Promise((resolve) => {
    const srv = http.createServer((_req, res) => res.writeHead(200).end('OK'));
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number };
      resolve({ port: addr.port, close: () => srv.close() });
    });
  });
}

// ---- test suite ----

describe('server lifecycle integration', () => {
  let homeDir: string;
  let srv: ServerInstance;
  let port: number;
  let fakeApp: { port: number; close: () => void };

  // Seed data ids
  let projectId: string;
  let personaId: string;

  beforeEach(async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'openuser-test-'));
    srv = await createServer({ homeDir, port: 0 }); // port 0 = pick a free one
    port = srv.port;
    fakeApp = await startFakeApp();

    // Create a project
    const p = await apiPost(port, '/api/projects', {
      name: 'Test Project',
      path: '/tmp/test-proj',
      baseUrl: `http://127.0.0.1:${fakeApp.port}`,
    });
    expect(p.status).toBe(201);
    projectId = (p.body as { id: string }).id;

    // Create a persona
    const persona = await apiPost(port, `/api/projects/${projectId}/personas`, {
      name: 'Alice',
      role: 'buyer',
      identity: {
        fullName: 'Alice Tester',
        roleLabel: 'first-time buyer',
        locale: 'en-US',
      },
      behavior: {
        techSavviness: 'average',
        patience: 'medium',
        readingStyle: 'reads',
        device: 'desktop',
        viewport: { width: 1280, height: 720 },
        habits: 'shops online occasionally',
      },
      knowledge: {
        productKnowledge: 'none',
        expectations: 'easy checkout',
        vocabulary: 'product, cart, buy',
      },
    });
    expect(persona.status).toBe(201);
    personaId = (persona.body as { id: string }).id;
  });

  afterEach(async () => {
    fakeApp.close();
    await srv.close();
    rmSync(homeDir, { recursive: true, force: true });
  });

  // ---- health ----

  it('GET /api/health returns ok', async () => {
    const r = await apiGet(port, '/api/health');
    expect(r.status).toBe(200);
    expect((r.body as { ok: boolean }).ok).toBe(true);
  });

  // ---- projects CRUD ----

  it('GET /api/projects returns the created project with aggregates', async () => {
    const r = await apiGet(port, '/api/projects');
    expect(r.status).toBe(200);
    const list = r.body as { id: string; openFindings: number; lastRunAt: null }[];
    expect(list.length).toBeGreaterThanOrEqual(1);
    const found = list.find((p) => p.id === projectId);
    expect(found).toBeDefined();
    expect(found!.openFindings).toBe(0);
    expect(found!.lastRunAt).toBeNull();
  });

  it('PATCH /api/projects/:id updates name', async () => {
    const r = await apiPatch(port, `/api/projects/${projectId}`, { name: 'Updated Name' });
    expect(r.status).toBe(200);
    expect((r.body as { name: string }).name).toBe('Updated Name');
  });

  // ---- tests ----

  it('POST /api/projects/:id/tests creates a test with lastRun:null', async () => {
    const r = await apiPost(port, `/api/projects/${projectId}/tests`, {
      title: 'Buy Widget',
      goal: 'Purchase a widget as a first-time buyer',
      priority: 'high',
    });
    expect(r.status).toBe(201);
    const testId = (r.body as { id: string }).id;

    const listR = await apiGet(port, `/api/projects/${projectId}/tests`);
    const list = listR.body as { id: string; lastRun: null }[];
    const t = list.find((x) => x.id === testId);
    expect(t?.lastRun).toBeNull();
  });

  // ---- run prepare ----

  it('POST /api/runs returns runId, token, testerPrompt', async () => {
    const r = await apiPost(port, '/api/runs', {
      projectId,
      adhocGoal: 'Explore the home page',
      personaId,
    });
    expect(r.status).toBe(201);
    const body = r.body as { runId: string; token: string; testerPrompt: string };
    expect(body.runId).toMatch(/^run_/);
    expect(body.token).toMatch(/^rt_/);
    expect(body.testerPrompt).toContain(body.token);
    expect(body.testerPrompt).toContain('Alice');
    expect(body.testerPrompt).toContain('first-time buyer');
    expect(body.testerPrompt).toContain('Explore the home page');
    // Verify the template verbatim text is present
    expect(body.testerPrompt).toContain('You are about to act as a real user of a web application');
    expect(body.testerPrompt).toContain('Do not read any source code');
  });

  it('POST /api/runs rejects when both testId and adhocGoal provided', async () => {
    const r = await apiPost(port, '/api/runs', {
      projectId,
      testId: 'tst_fake',
      adhocGoal: 'also this',
      personaId,
    });
    expect(r.status).toBe(400);
  });

  it('POST /api/runs rejects when neither testId nor adhocGoal provided', async () => {
    const r = await apiPost(port, '/api/runs', {
      projectId,
      personaId,
    });
    expect(r.status).toBe(400);
  });

  // ---- full lifecycle ----

  it('full lifecycle: prepare → begin → snapshot → action → finding → checkpoint → complete', async () => {
    const wsCollector = collectWsEvents(port);
    await new Promise((r) => setTimeout(r, 100)); // let WS connect

    // Prepare
    const prepR = await apiPost(port, '/api/runs', {
      projectId,
      adhocGoal: 'Buy Widget A',
      personaId,
    });
    expect(prepR.status).toBe(201);
    const { runId, token } = prepR.body as { runId: string; token: string };

    // Begin
    const beginR = await apiPost(port, '/api/tester/begin', {}, token);
    expect(beginR.status).toBe(200);
    const beginBody = beginR.body as { personaCard: string; mission: string; snapshot: { url: string; title: string; tree: string } };
    expect(beginBody.personaCard).toContain('Alice');
    expect(beginBody.mission).toContain('Buy Widget A');
    expect(beginBody.snapshot.url).toContain('fake.local');

    // Snapshot
    const snapR = await apiPost(port, '/api/tester/snapshot', {}, token);
    expect(snapR.status).toBe(200);
    expect((snapR.body as { tree: string }).tree).toContain('[ref=');

    // Action: click
    const actR = await apiPost(port, '/api/tester/action', { kind: 'click', ref: 'e7', note: 'Adding widget to cart' }, token);
    expect(actR.status).toBe(200);
    expect((actR.body as { ok: boolean }).ok).toBe(true);

    // Finding
    const findR = await apiPost(port, '/api/tester/finding', {
      type: 'ux_confusion',
      severity: 'medium',
      title: 'No feedback after adding to cart',
      description: 'I clicked Add to Cart but nothing seemed to happen. I was confused.',
    }, token);
    expect(findR.status).toBe(201);
    const finding = findR.body as { id: string; evidence: { screenshotPath?: string } };
    expect(finding.id).toMatch(/^fnd_/);
    expect(finding.evidence.screenshotPath).toBeTruthy();

    // Checkpoint
    const chkR = await apiPost(port, '/api/tester/checkpoint', {
      name: 'After add to cart',
      journeyNotes: 'Added Widget A to cart. Confused about feedback.',
    }, token);
    expect(chkR.status).toBe(201);
    expect((chkR.body as { id: string }).id).toMatch(/^chk_/);

    // Complete
    const complR = await apiPost(port, '/api/tester/complete', {
      verdict: 'partial',
      summary: 'Got to cart but checkout was confusing',
    }, token);
    expect(complR.status).toBe(200);
    const complBody = complR.body as { status: string; findings: { id: string }[] };
    // verdict=partial → status=failed
    expect(complBody.status).toBe('failed');
    expect(complBody.findings.length).toBe(1);

    // Verify run state
    const runR = await apiGet(port, `/api/runs/${runId}`);
    const run = runR.body as { status: string; verdict: string; findings: { id: string }[] };
    expect(run.status).toBe('failed');
    expect(run.verdict).toBe('partial');

    // Verify WS events received
    await new Promise((r) => setTimeout(r, 100));
    const types = (wsCollector.events as { type: string }[]).map((e) => e.type);
    expect(types).toContain('run.created');
    expect(types).toContain('run.updated');
    expect(types).toContain('step.created');
    expect(types).toContain('finding.created');
    expect(types).toContain('run.completed');

    wsCollector.close();
  });

  // ---- token auth failures ----

  it('tester routes return 401 with missing token', async () => {
    const r = await apiPost(port, '/api/tester/begin', {});
    expect(r.status).toBe(401);
  });

  it('tester routes return 401 with invalid token', async () => {
    const r = await apiPost(port, '/api/tester/snapshot', {}, 'rt_invalid_token_xxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(r.status).toBe(401);
  });

  it('tester routes return 401 after run is completed (token expired)', async () => {
    const prepR = await apiPost(port, '/api/runs', {
      projectId,
      adhocGoal: 'quick test',
      personaId,
    });
    const { token } = prepR.body as { token: string };

    // Begin → complete
    await apiPost(port, '/api/tester/begin', {}, token);
    await apiPost(port, '/api/tester/complete', { verdict: 'goal_achieved', summary: 'done' }, token);

    // Now token should be expired (run is no longer pending/running)
    const r2 = await apiPost(port, '/api/tester/snapshot', {}, token);
    expect(r2.status).toBe(401);
  });

  // ---- 409 wrong state ----

  it('begin returns 409 if run is already running', async () => {
    const prepR = await apiPost(port, '/api/runs', {
      projectId,
      adhocGoal: 'quick test',
      personaId,
    });
    const { token } = prepR.body as { token: string };

    await apiPost(port, '/api/tester/begin', {}, token);

    // Second begin attempt
    const r2 = await apiPost(port, '/api/tester/begin', {}, token);
    expect(r2.status).toBe(409);
  });

  it('complete returns 409 if run is not running', async () => {
    const prepR = await apiPost(port, '/api/runs', {
      projectId,
      adhocGoal: 'quick test',
      personaId,
    });
    const { token } = prepR.body as { token: string };
    // Don't call begin — run is still 'pending'
    const r = await apiPost(port, '/api/tester/complete', { verdict: 'goal_achieved', summary: 'done' }, token);
    expect(r.status).toBe(409);
  });

  // ---- status computation ----

  it('goal_achieved + no critical/high findings → passed', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'test', personaId });
    const { token } = prepR.body as { token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    // Report only a low finding
    await apiPost(port, '/api/tester/finding', {
      type: 'ux_confusion', severity: 'low', title: 'Minor issue', description: 'Minor',
    }, token);
    const complR = await apiPost(port, '/api/tester/complete', { verdict: 'goal_achieved', summary: 'done' }, token);
    expect((complR.body as { status: string }).status).toBe('passed');
  });

  it('goal_achieved + critical finding → failed', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'test', personaId });
    const { token } = prepR.body as { token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    await apiPost(port, '/api/tester/finding', {
      type: 'functional', severity: 'critical', title: 'Crash', description: 'App crashed',
    }, token);
    const complR = await apiPost(port, '/api/tester/complete', { verdict: 'goal_achieved', summary: 'done despite crash' }, token);
    expect((complR.body as { status: string }).status).toBe('failed');
  });

  it('goal_achieved + high finding → failed', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'test', personaId });
    const { token } = prepR.body as { token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    await apiPost(port, '/api/tester/finding', {
      type: 'functional', severity: 'high', title: 'Major regression', description: 'Important flow broken',
    }, token);
    const complR = await apiPost(port, '/api/tester/complete', { verdict: 'goal_achieved', summary: 'done despite high severity issue' }, token);
    expect((complR.body as { status: string }).status).toBe('failed');
  });

  it('blocked verdict → blocked status', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'test', personaId });
    const { token } = prepR.body as { token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    const complR = await apiPost(port, '/api/tester/complete', { verdict: 'blocked', summary: 'could not proceed' }, token);
    expect((complR.body as { status: string }).status).toBe('blocked');
  });

  // ---- report ----

  it('GET /api/runs/:id/report returns markdown', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'Report test', personaId });
    const { runId, token } = prepR.body as { runId: string; token: string };

    await apiPost(port, '/api/tester/begin', {}, token);
    await apiPost(port, '/api/tester/action', { kind: 'click', ref: 'e2' }, token);
    await apiPost(port, '/api/tester/finding', {
      type: 'functional', severity: 'high', title: 'Nav broken', description: 'Navigation link did nothing',
    }, token);
    await apiPost(port, '/api/tester/complete', { verdict: 'partial', summary: 'partial exploration' }, token);

    const res = await fetch(`http://127.0.0.1:${port}/api/runs/${runId}/report`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const md = await res.text();
    expect(md).toContain('# Run Report');
    expect(md).toContain('Nav broken');
    expect(md).toContain('HIGH');
    expect(md).toContain('## Steps');
  });

  // ---- promote ----

  it('POST /api/runs/:id/promote creates a test with source promoted_from_run', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'Explore checkout flow', personaId });
    const { runId, token } = prepR.body as { runId: string; token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    await apiPost(port, '/api/tester/complete', { verdict: 'goal_achieved', summary: 'done' }, token);

    const promoteR = await apiPost(port, `/api/runs/${runId}/promote`, {
      title: 'Checkout flow smoke test',
      priority: 'high',
    });
    expect(promoteR.status).toBe(201);
    const test = promoteR.body as { source: string; goal: string; title: string };
    expect(test.source).toBe('promoted_from_run');
    expect(test.goal).toBe('Explore checkout flow');
    expect(test.title).toBe('Checkout flow smoke test');
  });

  // ---- findings routes ----

  it('GET /api/findings filters by severity', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'findings test', personaId });
    const { token } = prepR.body as { token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    await apiPost(port, '/api/tester/finding', { type: 'functional', severity: 'critical', title: 'Critical bug', description: 'Bad' }, token);
    await apiPost(port, '/api/tester/finding', { type: 'ux_confusion', severity: 'low', title: 'Minor', description: 'Minor confusion' }, token);
    await apiPost(port, '/api/tester/complete', { verdict: 'blocked', summary: 'blocked by critical bug' }, token);

    const critR = await apiGet(port, `/api/findings?projectId=${projectId}&severity=critical`);
    expect((critR.body as unknown[]).length).toBe(1);
    const lowR = await apiGet(port, `/api/findings?projectId=${projectId}&severity=low`);
    expect((lowR.body as unknown[]).length).toBe(1);
  });

  it('PATCH /api/findings/:id updates status', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'patch test', personaId });
    const { token } = prepR.body as { token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    const fR = await apiPost(port, '/api/tester/finding', { type: 'functional', severity: 'medium', title: 'T', description: 'D' }, token);
    const { id: findingId } = fR.body as { id: string };
    await apiPost(port, '/api/tester/complete', { verdict: 'partial', summary: 'done' }, token);

    const pR = await apiPatch(port, `/api/findings/${findingId}`, { status: 'acknowledged' });
    expect(pR.status).toBe(200);
    expect((pR.body as { status: string }).status).toBe('acknowledged');
  });

  // ---- checkpoints manager routes ----

  it('GET /api/projects/:id/checkpoints returns checkpoints after a run saves one', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'checkpoint route test', personaId });
    const { token } = prepR.body as { token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    await apiPost(port, '/api/tester/checkpoint', { name: 'Mid run', journeyNotes: 'Progress so far' }, token);
    await apiPost(port, '/api/tester/complete', { verdict: 'goal_achieved', summary: 'done' }, token);

    const listR = await apiGet(port, `/api/projects/${projectId}/checkpoints`);
    expect((listR.body as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /api/checkpoints/:id removes the checkpoint', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'delete checkpoint test', personaId });
    const { token } = prepR.body as { token: string };
    await apiPost(port, '/api/tester/begin', {}, token);
    const chkR = await apiPost(port, '/api/tester/checkpoint', { name: 'To delete', journeyNotes: 'Will be deleted' }, token);
    const { id: chkId } = chkR.body as { id: string };
    await apiPost(port, '/api/tester/complete', { verdict: 'goal_achieved', summary: 'done' }, token);

    const delR = await apiDelete(port, `/api/checkpoints/${chkId}`);
    expect(delR.status).toBe(200);

    const listR = await apiGet(port, `/api/projects/${projectId}/checkpoints`);
    const list = listR.body as { id: string }[];
    expect(list.find((c) => c.id === chkId)).toBeUndefined();
  });

  // ---- settings ----

  it('PATCH /api/settings updates watchdogMinutes', async () => {
    const r = await apiPatch(port, '/api/settings', { watchdogMinutes: 10 });
    expect(r.status).toBe(200);
    expect((r.body as { watchdogMinutes: number }).watchdogMinutes).toBe(10);

    const getR = await apiGet(port, '/api/settings');
    expect((getR.body as { watchdogMinutes: number }).watchdogMinutes).toBe(10);
  });
});

// ---- watchdog (fake timers) ----

describe('watchdog (fake timers)', () => {
  let homeDir: string;
  let srv: ServerInstance;
  let port: number;
  let fakeApp: { port: number; close: () => void };
  let projectId: string;
  let personaId: string;

  beforeEach(async () => {
    // Only fake setTimeout/clearTimeout so the watchdog timer fires on advance,
    // while leaving Date, Promise, and network I/O real so fetch/serve still work.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    homeDir = mkdtempSync(join(tmpdir(), 'openuser-wd-'));
    srv = await createServer({ homeDir, port: 0 });
    port = srv.port;
    fakeApp = await startFakeApp();

    const p = await apiPost(port, '/api/projects', {
      name: 'WD Project', path: '/tmp/wd-proj-' + Date.now(),
      baseUrl: `http://127.0.0.1:${fakeApp.port}`,
    });
    projectId = (p.body as { id: string }).id;
    const per = await apiPost(port, `/api/projects/${projectId}/personas`, {
      name: 'Bob', role: 'tester',
      identity: { fullName: 'Bob T', roleLabel: 'tester', locale: 'en' },
      behavior: { techSavviness: 'average', patience: 'medium', readingStyle: 'reads', device: 'desktop', viewport: { width: 1280, height: 720 }, habits: 'tests things' },
      knowledge: { productKnowledge: 'none', expectations: 'works', vocabulary: 'click, type' },
    });
    personaId = (per.body as { id: string }).id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    fakeApp.close();
    await srv.close();
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('aborts run after watchdog timeout', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'wd test', personaId });
    const { runId, token } = prepR.body as { runId: string; token: string };

    await apiPost(port, '/api/tester/begin', {}, token);

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const runR = await apiGet(port, `/api/runs/${runId}`);
    expect((runR.body as { status: string }).status).toBe('aborted');
  });

  it('watchdog creates an auto-checkpoint when aborting a run', async () => {
    const prepR = await apiPost(port, '/api/runs', { projectId, adhocGoal: 'wd checkpoint test', personaId });
    const { runId, token } = prepR.body as { runId: string; token: string };

    await apiPost(port, '/api/tester/begin', {}, token);

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Run must be aborted
    const runR = await apiGet(port, `/api/runs/${runId}`);
    expect((runR.body as { status: string }).status).toBe('aborted');

    // Watchdog must have written an auto-checkpoint for this project
    const chkR = await apiGet(port, `/api/projects/${projectId}/checkpoints`);
    expect((chkR.body as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});
