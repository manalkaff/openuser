import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Project, Run, Finding, LogEvent } from '@openuser/shared';

// We test the api module after mocking fetch
// The api module is imported dynamically after fetch is set up

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let api: typeof import('../lib/api.js');

const mockProject: Project = {
  id: 'prj_test123456',
  name: 'Test Project',
  path: '/test',
  baseUrl: 'http://localhost:3000',
  environments: [],
  defaultViewport: { width: 1280, height: 720 },
  createdAt: 1700000000000,
};

const mockRun: Run = {
  id: 'run_test123456',
  projectId: 'prj_test123456',
  testId: null,
  adhocGoal: 'test the login',
  personaId: 'per_test123456',
  checkpointId: null,
  environmentName: null,
  baseUrlResolved: 'http://localhost:3000',
  status: 'running',
  verdict: null,
  summary: null,
  agentLabel: null,
  tokenHash: 'hash123',
  videoPath: null,
  startedAt: 1700000000000,
  finishedAt: null,
  createdAt: 1700000000000,
};

const mockFinding: Finding = {
  id: 'fnd_test123456',
  runId: 'run_test123456',
  stepId: null,
  projectId: 'prj_test123456',
  type: 'functional',
  severity: 'high',
  title: 'Button not working',
  description: 'I clicked the checkout button and nothing happened.',
  evidence: {},
  status: 'open',
  createdAt: 1700000000000,
};

const mockLogEvent: LogEvent = {
  id: 'evt_test123456',
  runId: 'run_test123456',
  stepIdx: 2,
  kind: 'console',
  level: 'error',
  payload: { message: 'Uncaught TypeError: Cannot read property' },
  createdAt: 1700000000000,
};

describe('api client', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    api = await import('../lib/api.js');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('getHealth returns ok + version', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, version: '0.1.0' }), { status: 200 })
    );
    const result = await api.getHealth();
    expect(result.ok).toBe(true);
    expect(result.version).toBe('0.1.0');
    expect(fetch).toHaveBeenCalledWith('/api/health');
  });

  it('getProjects returns Project[]', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([mockProject]), { status: 200 })
    );
    const result = await api.getProjects();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('prj_test123456');
  });

  it('createProject posts and returns project', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockProject), { status: 200 })
    );
    const result = await api.createProject({
      name: 'Test Project',
      path: '/test',
      baseUrl: 'http://localhost:3000',
    });
    expect(result.id).toBe('prj_test123456');
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('getRun returns run + steps + findings', async () => {
    const payload = { ...mockRun, steps: [], findings: [mockFinding] };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 })
    );
    const result = await api.getRun('run_test123456');
    expect(result.id).toBe('run_test123456');
    expect(result.findings).toHaveLength(1);
    expect(result.steps).toHaveLength(0);
  });

  it('getRunEvents returns LogEvent[]', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([mockLogEvent]), { status: 200 })
    );
    const result = await api.getRunEvents('run_test123456');
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('console');
    expect(fetch).toHaveBeenCalledWith('/api/runs/run_test123456/events');
  });

  it('getFindings passes query params', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify([mockFinding]), { status: 200 })
    );
    const result = await api.getFindings({ severity: 'high', status: 'open' });
    expect(result).toHaveLength(1);
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain('severity=high');
    expect(calledUrl).toContain('status=open');
  });

  it('patchFinding sends PATCH with status', async () => {
    const updated = { ...mockFinding, status: 'acknowledged' as const };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(updated), { status: 200 })
    );
    const result = await api.patchFinding('fnd_test123456', 'acknowledged');
    expect(result.status).toBe('acknowledged');
  });

  it('prepareRun returns runId + token + testerPrompt', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ runId: 'run_abc', token: 'rt_xyz', testerPrompt: 'You are...' }),
        { status: 200 }
      )
    );
    const result = await api.prepareRun({
      projectId: 'prj_test123456',
      adhocGoal: 'test checkout',
      personaId: 'per_test123456',
    });
    expect(result.runId).toBe('run_abc');
    expect(result.testerPrompt).toBe('You are...');
  });

  it('throws on non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    );
    await expect(api.getRun('run_missing')).rejects.toThrow('not found');
  });

  it('promoteRun posts title + returns Test', async () => {
    const mockTest = { id: 'tst_abc', title: 'Promoted test', goal: 'test checkout',
      projectId: 'prj_test123456', priority: 'medium', tags: [], source: 'promoted_from_run',
      archived: false, createdAt: 1700000000000 };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockTest), { status: 200 })
    );
    const result = await api.promoteRun('run_test123456', { title: 'Promoted test' });
    expect(result.source).toBe('promoted_from_run');
  });
});
