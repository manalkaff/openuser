import type {
  PrepareRunResponse,
  PageSnapshot,
  TesterAction,
  TesterBeginResponse,
  TesterActionResponse,
  TesterScreenshotResponse,
  TesterCompleteResponse,
} from '@openuser/shared';

// ─── Local wire-shape types (not exported by @openuser/shared) ────────────────
// These reflect the JSON that Hono's c.json() serialises from Drizzle rows.
// timestamp_ms integer columns → ISO string on the wire.

export interface Project {
  id: string;
  name: string;
  path: string;
  baseUrl: string;
  environments: { name: string; url: string }[];
  defaultViewport: { width: number; height: number };
  createdAt: string;
}

export interface Persona {
  id: string;
  projectId: string;
  name: string;
  role: string;
  identity: unknown;
  behavior: unknown;
  knowledge: unknown;
  notes: string | null;
  archived: boolean;
  createdAt: string;
}

export interface Test {
  id: string;
  projectId: string;
  title: string;
  goal: string;
  preconditions: string | null;
  expectedOutcome: string | null;
  defaultPersonaId: string | null;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  source: string;
  archived: boolean;
  createdAt: string;
}

export interface Run {
  id: string;
  projectId: string;
  testId: string | null;
  adhocGoal: string | null;
  personaId: string;
  status: string;
  verdict: string | null;
  summary: string | null;
  createdAt: string;
  [k: string]: unknown;
}

export type RunSummary = Run;

export interface Finding {
  id: string;
  runId: string;
  stepId: string | null;
  projectId: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  evidence: unknown;
  status: string;
  createdAt: string;
}

export interface Checkpoint {
  id: string;
  projectId: string;
  personaId: string;
  name: string;
  description: string | null;
  storageStatePath: string;
  journey: unknown;
  createdFromRunId: string | null;
  createdAt: string;
}

export type TesterFindingResponse = Finding;
export type TesterCheckpointResponse = Checkpoint;

// ─── Client options ───────────────────────────────────────────────────────────

export interface HttpClientOptions {
  baseUrl: string;
  /** Bearer token for tester-scoped endpoints */
  token?: string;
}

/** A typed API error carrying the server's error message. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const fetchInit: RequestInit = { method, headers };
  if (body !== undefined) fetchInit.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, fetchInit);

  if (!res.ok) {
    let errMsg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) errMsg = j.error;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, errMsg);
  }

  // GET /api/runs/:id/report returns text/markdown
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/')) {
    return (await res.text()) as unknown as T;
  }
  return res.json() as Promise<T>;
}

// ─── Manager: Projects ──────────────────────────────────────────────────────

export function postProject(
  opts: HttpClientOptions,
  body: { name: string; path: string; baseUrl: string; environments?: { name: string; url: string }[]; defaultViewport?: { width: number; height: number } },
): Promise<Project> {
  return req<Project>(opts.baseUrl, 'POST', '/api/projects', body);
}

export function getProjects(opts: HttpClientOptions): Promise<(Project & { openFindings: number; lastRunAt: string | null })[]> {
  return req<(Project & { openFindings: number; lastRunAt: string | null })[]>(opts.baseUrl, 'GET', '/api/projects');
}

// ─── Manager: Personas ───────────────────────────────────────────────────────

export function postPersona(
  opts: HttpClientOptions,
  projectId: string,
  body: Omit<Persona, 'id' | 'projectId' | 'createdAt'>,
): Promise<Persona> {
  return req<Persona>(opts.baseUrl, 'POST', `/api/projects/${projectId}/personas`, body);
}

export function patchPersona(
  opts: HttpClientOptions,
  personaId: string,
  body: Partial<Omit<Persona, 'id' | 'projectId' | 'createdAt'>>,
): Promise<Persona> {
  return req<Persona>(opts.baseUrl, 'PATCH', `/api/personas/${personaId}`, body);
}

export function getPersonas(opts: HttpClientOptions, projectId: string): Promise<Persona[]> {
  return req<Persona[]>(opts.baseUrl, 'GET', `/api/projects/${projectId}/personas`);
}

// ─── Manager: Tests ───────────────────────────────────────────────────────────

export function postTest(
  opts: HttpClientOptions,
  projectId: string,
  body: Omit<Test, 'id' | 'projectId' | 'createdAt'>,
): Promise<Test> {
  return req<Test>(opts.baseUrl, 'POST', `/api/projects/${projectId}/tests`, body);
}

export function patchTest(
  opts: HttpClientOptions,
  testId: string,
  body: Partial<Omit<Test, 'id' | 'projectId' | 'createdAt'>>,
): Promise<Test> {
  return req<Test>(opts.baseUrl, 'PATCH', `/api/tests/${testId}`, body);
}

export function getTests(opts: HttpClientOptions, projectId: string): Promise<(Test & { lastRun: { id: string; status: string; finishedAt: string | null } | null })[]> {
  return req<(Test & { lastRun: { id: string; status: string; finishedAt: string | null } | null })[]>(opts.baseUrl, 'GET', `/api/projects/${projectId}/tests`);
}

// ─── Manager: Runs ────────────────────────────────────────────────────────────

export function postRun(
  opts: HttpClientOptions,
  body: {
    projectId: string;
    testId?: string;
    adhocGoal?: string;
    personaId: string;
    checkpointId?: string;
    environment?: string;
    agentLabel?: string;
  },
): Promise<PrepareRunResponse> {
  return req<PrepareRunResponse>(opts.baseUrl, 'POST', '/api/runs', body);
}

export function getRuns(
  opts: HttpClientOptions,
  params: { projectId?: string; status?: string; limit?: number },
): Promise<RunSummary[]> {
  const qs = new URLSearchParams();
  if (params.projectId) qs.set('projectId', params.projectId);
  if (params.status) qs.set('status', params.status);
  if (params.limit != null) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return req<RunSummary[]>(opts.baseUrl, 'GET', `/api/runs${q ? `?${q}` : ''}`);
}

export function getRun(opts: HttpClientOptions, runId: string): Promise<Run & { steps: unknown[]; findings: Finding[] }> {
  return req<Run & { steps: unknown[]; findings: Finding[] }>(opts.baseUrl, 'GET', `/api/runs/${runId}`);
}

export function getRunReport(opts: HttpClientOptions, runId: string): Promise<string> {
  return req<string>(opts.baseUrl, 'GET', `/api/runs/${runId}/report`);
}

// ─── Manager: Findings ────────────────────────────────────────────────────────

export function getFindings(
  opts: HttpClientOptions,
  params: { projectId?: string; severity?: string; type?: string; status?: string },
): Promise<Finding[]> {
  const qs = new URLSearchParams();
  if (params.projectId) qs.set('projectId', params.projectId);
  if (params.severity) qs.set('severity', params.severity);
  if (params.type) qs.set('type', params.type);
  if (params.status) qs.set('status', params.status);
  const q = qs.toString();
  return req<Finding[]>(opts.baseUrl, 'GET', `/api/findings${q ? `?${q}` : ''}`);
}

export function patchFinding(
  opts: HttpClientOptions,
  findingId: string,
  body: { status: string },
): Promise<Finding> {
  return req<Finding>(opts.baseUrl, 'PATCH', `/api/findings/${findingId}`, body);
}

// ─── Manager: Checkpoints ─────────────────────────────────────────────────────

export function getCheckpoints(opts: HttpClientOptions, projectId: string): Promise<Checkpoint[]> {
  return req<Checkpoint[]>(opts.baseUrl, 'GET', `/api/projects/${projectId}/checkpoints`);
}

export function deleteCheckpoint(opts: HttpClientOptions, checkpointId: string): Promise<void> {
  return req<void>(opts.baseUrl, 'DELETE', `/api/checkpoints/${checkpointId}`);
}

// ─── Tester: all endpoints ────────────────────────────────────────────────────

export function testerBegin(opts: HttpClientOptions): Promise<TesterBeginResponse> {
  return req<TesterBeginResponse>(opts.baseUrl, 'POST', '/api/tester/begin', {}, opts.token);
}

export function testerSnapshot(opts: HttpClientOptions): Promise<PageSnapshot> {
  return req<PageSnapshot>(opts.baseUrl, 'POST', '/api/tester/snapshot', {}, opts.token);
}

export function testerAction(
  opts: HttpClientOptions,
  action: TesterAction & { note?: string },
): Promise<TesterActionResponse> {
  return req<TesterActionResponse>(opts.baseUrl, 'POST', '/api/tester/action', action, opts.token);
}

export function testerScreenshot(opts: HttpClientOptions): Promise<TesterScreenshotResponse> {
  return req<TesterScreenshotResponse>(opts.baseUrl, 'POST', '/api/tester/screenshot', {}, opts.token);
}

export function testerFinding(
  opts: HttpClientOptions,
  body: { type: string; severity: string; title: string; description: string },
): Promise<TesterFindingResponse> {
  return req<TesterFindingResponse>(opts.baseUrl, 'POST', '/api/tester/finding', body, opts.token);
}

export function testerCheckpoint(
  opts: HttpClientOptions,
  body: { name: string; description?: string; journeyNotes: string },
): Promise<TesterCheckpointResponse> {
  return req<TesterCheckpointResponse>(opts.baseUrl, 'POST', '/api/tester/checkpoint', body, opts.token);
}

export function testerComplete(
  opts: HttpClientOptions,
  body: { verdict: string; summary: string },
): Promise<TesterCompleteResponse> {
  return req<TesterCompleteResponse>(opts.baseUrl, 'POST', '/api/tester/complete', body, opts.token);
}

// ─── Artifact fetch (for browser_screenshot image content) ───────────────────

export async function fetchArtifactBytes(baseUrl: string, artifactPath: string): Promise<{ data: string; mimeType: string }> {
  const url = `${baseUrl}/artifacts/${artifactPath}`;
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, `Artifact not found: ${artifactPath}`);
  const buffer = await res.arrayBuffer();
  const data = Buffer.from(buffer).toString('base64');
  const mimeType = res.headers.get('content-type') ?? 'image/png';
  return { data, mimeType };
}
