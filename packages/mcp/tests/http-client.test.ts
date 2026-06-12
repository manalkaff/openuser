import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import {
  postProject,
  getProjects,
  postPersona,
  patchPersona,
  getPersonas,
  postTest,
  patchTest,
  getTests,
  postRun,
  getRuns,
  getRun,
  getRunReport,
  getFindings,
  patchFinding,
  getCheckpoints,
  deleteCheckpoint,
  testerBegin,
  testerSnapshot,
  testerAction,
  testerScreenshot,
  testerFinding,
  testerCheckpoint,
  testerComplete,
  fetchArtifactBytes,
  ApiError,
  type HttpClientOptions,
} from '../src/http-client.js';

// ─── Minimal in-process mock Hono app ────────────────────────────────────────

const MOCK_PROJECT = {
  id: 'prj_test1234',
  name: 'Test Project',
  path: '/tmp/test-proj',
  baseUrl: 'http://localhost:3000',
  environments: [],
  defaultViewport: { width: 1280, height: 720 },
  createdAt: 1000000,
  openFindings: 0,
  lastRunAt: null,
};

const MOCK_PERSONA = {
  id: 'per_test1234',
  projectId: 'prj_test1234',
  name: 'First-time Buyer',
  role: 'buyer',
  identity: { fullName: 'Alice Smith', roleLabel: 'buyer', locale: 'en-US' },
  behavior: { techSavviness: 'average', patience: 'medium', readingStyle: 'skims', device: 'desktop', viewport: { width: 1280, height: 720 }, habits: 'none' },
  knowledge: { productKnowledge: 'none', expectations: 'fast checkout', vocabulary: 'buy, cart, pay' },
  notes: null,
  archived: false,
  createdAt: 1000001,
};

const MOCK_TEST = {
  id: 'tst_test1234',
  projectId: 'prj_test1234',
  title: 'Checkout flow',
  goal: 'Complete a purchase using bank transfer',
  preconditions: null,
  expectedOutcome: null,
  defaultPersonaId: null,
  priority: 'medium',
  tags: [],
  source: 'manual',
  archived: false,
  createdAt: 1000002,
  lastRun: null,
};

const MOCK_RUN_SUMMARY = {
  id: 'run_test1234',
  projectId: 'prj_test1234',
  testId: 'tst_test1234',
  personaId: 'per_test1234',
  status: 'pending',
  createdAt: 1000003,
};

const MOCK_FINDING = {
  id: 'fnd_test1234',
  runId: 'run_test1234',
  stepId: null,
  projectId: 'prj_test1234',
  type: 'ux_confusion',
  severity: 'medium',
  title: 'Confusing button',
  description: 'I could not find the checkout button',
  evidence: {},
  status: 'open',
  createdAt: 1000004,
};

const MOCK_CHECKPOINT = {
  id: 'chk_test1234',
  projectId: 'prj_test1234',
  personaId: 'per_test1234',
  name: 'Logged in',
  description: null,
  storageStatePath: '/tmp/chk/storage.json',
  journey: { notes: 'Logged in ok', savedAtStep: 3, url: 'http://localhost:3000/dashboard' },
  createdFromRunId: null,
  createdAt: 1000005,
};

const MOCK_SNAPSHOT = { url: 'http://localhost:3000', title: 'Home', tree: 'button[ref=e1] Submit' };

function buildMockApp(): Hono {
  const app = new Hono();

  // Health
  app.get('/api/health', (c) => c.json({ ok: true, version: '0.1.0' }));

  // Projects
  app.post('/api/projects', (c) => c.json(MOCK_PROJECT, 201));
  app.get('/api/projects', (c) => c.json([MOCK_PROJECT]));

  // Personas — error route must be registered before the generic personas route
  app.get('/api/projects/err_500/personas', (c) => c.json({ error: 'Boom: persona lookup failed' }, 500));
  app.post('/api/projects/:id/personas', (c) => c.json(MOCK_PERSONA, 201));
  app.patch('/api/personas/:id', (c) => c.json(MOCK_PERSONA));
  app.get('/api/projects/:id/personas', (c) => c.json([MOCK_PERSONA]));

  // Tests
  app.post('/api/projects/:id/tests', (c) => c.json(MOCK_TEST, 201));
  app.patch('/api/tests/:id', (c) => c.json(MOCK_TEST));
  app.get('/api/projects/:id/tests', (c) => c.json([MOCK_TEST]));

  // Runs
  app.post('/api/runs', (c) =>
    c.json({
      runId: 'run_test1234',
      token: 'rt_xxxxxxxxxxxxxxxxxxxxxxxx',
      testerPrompt:
        'You are about to act as a real user. First: call the begin_run tool with token "rt_xxxxxxxxxxxxxxxxxxxxxxxx".',
    }),
  );
  app.get('/api/runs', (c) => c.json([MOCK_RUN_SUMMARY]));
  app.get('/api/runs/:id', (c) =>
    c.json({ ...MOCK_RUN_SUMMARY, status: 'running', steps: [], findings: [MOCK_FINDING] }),
  );
  app.get('/api/runs/:id/report', (c) => {
    c.header('content-type', 'text/markdown');
    return c.text('# Run Report\n\n## Findings\n\n- Confusing button (medium, ux_confusion)\n');
  });

  // Findings
  app.get('/api/findings', (c) => c.json([MOCK_FINDING]));
  app.patch('/api/findings/:id', (c) => c.json({ ...MOCK_FINDING, status: 'acknowledged' }));

  // Checkpoints
  app.get('/api/projects/:id/checkpoints', (c) => c.json([MOCK_CHECKPOINT]));
  app.delete('/api/checkpoints/:id', (c) => c.json({ deleted: true }));

  // Tester endpoints
  app.post('/api/tester/begin', (c) =>
    c.json({
      personaCard: '**Alice Smith** (buyer)\nPatience: medium',
      mission: 'Complete a purchase using bank transfer',
      journeyNotes: undefined,
      snapshot: MOCK_SNAPSHOT,
    }),
  );
  app.post('/api/tester/snapshot', (c) => c.json(MOCK_SNAPSHOT));
  app.post('/api/tester/action', (c) => c.json({ ok: true, snapshot: MOCK_SNAPSHOT }));
  app.post('/api/tester/screenshot', (c) => c.json({ path: 'run_test1234/shots/abc123.png' }));
  app.post('/api/tester/finding', (c) => c.json(MOCK_FINDING, 201));
  app.post('/api/tester/checkpoint', (c) => c.json(MOCK_CHECKPOINT, 201));
  app.post('/api/tester/complete', (c) =>
    c.json({ status: 'passed', findings: [MOCK_FINDING] }),
  );

  // Artifact route for fetchArtifactBytes test
  app.get('/artifacts/run_test1234/shots/abc.png', (c) => {
    // 1x1 transparent PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    return new Response(Buffer.from(b64, 'base64'), { headers: { 'Content-Type': 'image/png' } });
  });

  // Error route for testing ApiError
  app.get('/api/error-test', (c) => c.json({ error: 'Something went wrong' }, 500));

  return app;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

let server: Server;
let baseUrl: string;
let opts: HttpClientOptions;

beforeAll(async () => {
  const app = buildMockApp();
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      opts = { baseUrl };
      resolve();
    });
  });
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('HTTP client — manager routes', () => {
  it('postProject returns a project', async () => {
    const p = await postProject(opts, { name: 'Test Project', path: '/tmp', baseUrl: 'http://localhost:3000' });
    expect(p.id).toBe('prj_test1234');
    expect(p.name).toBe('Test Project');
  });

  it('getProjects returns array with openFindings', async () => {
    const projects = await getProjects(opts);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.openFindings).toBe(0);
  });

  it('postPersona returns a persona', async () => {
    const persona = await postPersona(opts, 'prj_test1234', {
      name: 'First-time Buyer',
      role: 'buyer',
      identity: { fullName: 'Alice Smith', roleLabel: 'buyer', locale: 'en-US' },
      behavior: { techSavviness: 'average', patience: 'medium', readingStyle: 'skims', device: 'desktop', viewport: { width: 1280, height: 720 }, habits: 'none' },
      knowledge: { productKnowledge: 'none', expectations: 'fast checkout', vocabulary: 'buy, cart, pay' },
      archived: false,
    });
    expect(persona.id).toBe('per_test1234');
  });

  it('patchPersona updates a persona', async () => {
    const persona = await patchPersona(opts, 'per_test1234', { name: 'Updated Buyer' });
    expect(persona.id).toBe('per_test1234');
  });

  it('getPersonas returns persona list', async () => {
    const personas = await getPersonas(opts, 'prj_test1234');
    expect(personas).toHaveLength(1);
    expect(personas[0]!.name).toBe('First-time Buyer');
  });

  it('postTest returns a test', async () => {
    const test = await postTest(opts, 'prj_test1234', {
      title: 'Checkout flow',
      goal: 'Complete a purchase',
      priority: 'medium',
      tags: [],
      source: 'manual',
      archived: false,
    });
    expect(test.id).toBe('tst_test1234');
  });

  it('patchTest updates a test', async () => {
    const test = await patchTest(opts, 'tst_test1234', { title: 'Updated title' });
    expect(test.id).toBe('tst_test1234');
  });

  it('getTests returns test list with lastRun', async () => {
    const tests = await getTests(opts, 'prj_test1234');
    expect(tests).toHaveLength(1);
    expect(tests[0]!.lastRun).toBeNull();
  });

  it('postRun returns runId + token + testerPrompt', async () => {
    const result = await postRun(opts, {
      projectId: 'prj_test1234',
      personaId: 'per_test1234',
      testId: 'tst_test1234',
    });
    expect(result.runId).toBe('run_test1234');
    expect(result.token).toMatch(/^rt_/);
    expect(result.testerPrompt).toContain('begin_run');
  });

  it('getRuns returns run summaries', async () => {
    const runs = await getRuns(opts, {});
    expect(runs).toHaveLength(1);
    expect(runs[0]!.id).toBe('run_test1234');
  });

  it('getRun returns run with steps and findings', async () => {
    const run = await getRun(opts, 'run_test1234');
    expect(run.id).toBe('run_test1234');
    expect(run.findings).toHaveLength(1);
    expect(run.steps).toHaveLength(0);
  });

  it('getRunReport returns markdown string', async () => {
    const report = await getRunReport(opts, 'run_test1234');
    expect(typeof report).toBe('string');
    expect(report).toContain('# Run Report');
  });

  it('getFindings returns finding list', async () => {
    const findings = await getFindings(opts, {});
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe('ux_confusion');
  });

  it('patchFinding updates finding status', async () => {
    const finding = await patchFinding(opts, 'fnd_test1234', { status: 'acknowledged' });
    expect(finding.status).toBe('acknowledged');
  });

  it('getCheckpoints returns checkpoint list', async () => {
    const checkpoints = await getCheckpoints(opts, 'prj_test1234');
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.name).toBe('Logged in');
  });

  it('deleteCheckpoint completes without error', async () => {
    await expect(deleteCheckpoint(opts, 'chk_test1234')).resolves.not.toThrow();
  });
});

describe('HTTP client — tester routes', () => {
  const testerOpts: HttpClientOptions = { baseUrl: '', token: 'rt_xxxxxxxxxxxxxxxxxxxxxxxx' };

  beforeAll(() => {
    testerOpts.baseUrl = baseUrl;
  });

  it('testerBegin returns personaCard, mission, snapshot', async () => {
    const result = await testerBegin(testerOpts);
    expect(result.personaCard).toContain('Alice Smith');
    expect(result.mission).toContain('bank transfer');
    expect(result.snapshot.url).toBe('http://localhost:3000');
  });

  it('testerSnapshot returns page snapshot', async () => {
    const snap = await testerSnapshot(testerOpts);
    expect(snap.url).toBe('http://localhost:3000');
    expect(snap.tree).toContain('[ref=e1]');
  });

  it('testerAction click returns ok + snapshot', async () => {
    const result = await testerAction(testerOpts, { kind: 'click', ref: 'e1' });
    expect(result.ok).toBe(true);
    expect(result.snapshot).toBeDefined();
  });

  it('testerAction navigate returns ok + snapshot', async () => {
    const result = await testerAction(testerOpts, { kind: 'navigate', url: 'http://localhost:3000/about' });
    expect(result.ok).toBe(true);
  });

  it('testerAction type returns ok + snapshot', async () => {
    const result = await testerAction(testerOpts, { kind: 'type', ref: 'e2', text: 'hello' });
    expect(result.ok).toBe(true);
  });

  it('testerAction select returns ok + snapshot', async () => {
    const result = await testerAction(testerOpts, { kind: 'select', ref: 'e3', value: 'option1' });
    expect(result.ok).toBe(true);
  });

  it('testerAction scroll returns ok + snapshot', async () => {
    const result = await testerAction(testerOpts, { kind: 'scroll', direction: 'down', amountPx: 300 });
    expect(result.ok).toBe(true);
  });

  it('testerAction back returns ok + snapshot', async () => {
    const result = await testerAction(testerOpts, { kind: 'back' });
    expect(result.ok).toBe(true);
  });

  it('testerAction wait returns ok + snapshot', async () => {
    const result = await testerAction(testerOpts, { kind: 'wait', seconds: 1 });
    expect(result.ok).toBe(true);
  });

  it('testerScreenshot returns path', async () => {
    const result = await testerScreenshot(testerOpts);
    expect(result.path).toContain('run_test1234');
    expect(result.path).toContain('.png');
  });

  it('testerFinding returns finding', async () => {
    const finding = await testerFinding(testerOpts, {
      type: 'ux_confusion',
      severity: 'medium',
      title: 'Confusing button',
      description: 'I could not find it',
    });
    expect(finding.id).toBe('fnd_test1234');
  });

  it('testerCheckpoint returns checkpoint', async () => {
    const checkpoint = await testerCheckpoint(testerOpts, {
      name: 'Logged in',
      journeyNotes: 'Successfully logged in as Alice',
    });
    expect(checkpoint.id).toBe('chk_test1234');
  });

  it('testerComplete returns status + findings', async () => {
    const result = await testerComplete(testerOpts, {
      verdict: 'goal_achieved',
      summary: 'I completed the purchase successfully.',
    });
    expect(result.status).toBe('passed');
    expect(result.findings).toHaveLength(1);
  });
});

describe('HTTP client — error handling', () => {
  it('throws ApiError with status and server message on non-2xx', async () => {
    try {
      await getPersonas(opts, 'err_500');
      throw new Error('Expected getPersonas to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).message).toBe('Boom: persona lookup failed');
    }
  });

  it('ApiError carries status code', async () => {
    const err = new ApiError(404, 'Not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('ApiError');
  });
});

describe('HTTP client — artifacts', () => {
  it('fetchArtifactBytes returns base64 data and mimeType', async () => {
    const { data, mimeType } = await fetchArtifactBytes(baseUrl, 'run_test1234/shots/abc.png');
    expect(mimeType).toBe('image/png');
    expect(typeof data).toBe('string');
    expect(data.length).toBeGreaterThan(0);
    // round-trips back to a PNG header (\x89PNG)
    expect(Buffer.from(data, 'base64').subarray(0, 4).toString('latin1')).toBe('\x89PNG');
  });
});
