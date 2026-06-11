import type {
  Project, Persona, Test, Run, Step, Finding, Checkpoint, LogEvent,
  RunStatus, Severity, FindingType, FindingStatus,
} from '@openuser/shared';

// ── Types for request bodies ─────────────────────────────────────────────────

export type CreateProjectBody = {
  name: string;
  path: string;
  baseUrl: string;
  environments?: { name: string; url: string }[];
  defaultViewport?: { width: number; height: number };
};

export type CreatePersonaBody = {
  name: string;
  role: string;
  identity: import('@openuser/shared').PersonaIdentity;
  behavior: import('@openuser/shared').PersonaBehavior;
  knowledge: import('@openuser/shared').PersonaKnowledge;
  notes?: string;
};

export type CreateTestBody = {
  title: string;
  goal: string;
  preconditions?: string;
  expectedOutcome?: string;
  defaultPersonaId?: string;
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
};

export type PrepareRunBody = {
  projectId: string;
  testId?: string;
  adhocGoal?: string;
  personaId: string;
  checkpointId?: string;
  environment?: string;
  agentLabel?: string;
};

export type RunDetail = Run & { steps: Step[]; findings: Finding[] };

export type RunSummary = {
  id: string;
  projectId: string;
  testId: string | null;
  adhocGoal: string | null;
  personaId: string;
  status: RunStatus;
  verdict: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
};

export type ProjectSummary = Project & { openFindings: number; lastRunAt: number | null };

export type TestWithLastRun = Test & {
  lastRun: { id: string; status: RunStatus; finishedAt: number | null } | null;
};

export type HealthResponse = { ok: boolean; version: string };

export type PrepareRunResponse = { runId: string; token: string; testerPrompt: string };

export type SettingsMap = {
  watchdogMinutes: number;
  headed: boolean;
  browserChannel: string;
};

// ── Internal helpers ─────────────────────────────────────────────────────────

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = init
    ? await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
        ...init,
      })
    : await fetch(url);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ── Health ───────────────────────────────────────────────────────────────────

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}

// ── Projects ─────────────────────────────────────────────────────────────────

export function getProjects(): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>('/api/projects');
}

export function getProject(id: string): Promise<ProjectSummary> {
  return request<ProjectSummary>(`/api/projects/${id}`);
}

export function createProject(body: CreateProjectBody): Promise<Project> {
  return request<Project>('/api/projects', { method: 'POST', body: JSON.stringify(body) });
}

export function patchProject(id: string, body: Partial<CreateProjectBody>): Promise<Project> {
  return request<Project>(`/api/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ── Personas ─────────────────────────────────────────────────────────────────

export function getPersonas(projectId: string): Promise<Persona[]> {
  return request<Persona[]>(`/api/projects/${projectId}/personas`);
}

export function createPersona(projectId: string, body: CreatePersonaBody): Promise<Persona> {
  return request<Persona>(`/api/projects/${projectId}/personas`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function patchPersona(id: string, body: Partial<CreatePersonaBody>): Promise<Persona> {
  return request<Persona>(`/api/personas/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ── Tests ────────────────────────────────────────────────────────────────────

export function getTests(projectId: string): Promise<TestWithLastRun[]> {
  return request<TestWithLastRun[]>(`/api/projects/${projectId}/tests`);
}

export function createTest(projectId: string, body: CreateTestBody): Promise<Test> {
  return request<Test>(`/api/projects/${projectId}/tests`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function patchTest(id: string, body: Partial<CreateTestBody>): Promise<Test> {
  return request<Test>(`/api/tests/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export function prepareRun(body: PrepareRunBody): Promise<PrepareRunResponse> {
  return request<PrepareRunResponse>('/api/runs', { method: 'POST', body: JSON.stringify(body) });
}

export function getRuns(params: {
  projectId?: string;
  status?: RunStatus;
  limit?: number;
}): Promise<RunSummary[]> {
  return request<RunSummary[]>(
    `/api/runs${qs({
      projectId: params.projectId,
      status: params.status,
      limit: params.limit?.toString(),
    })}`
  );
}

export function getRun(id: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/runs/${id}`);
}

export function getRunEvents(id: string): Promise<LogEvent[]> {
  return request<LogEvent[]>(`/api/runs/${id}/events`);
}

export function promoteRun(
  id: string,
  body: { title: string; priority?: 'low' | 'medium' | 'high'; tags?: string[] },
): Promise<Test> {
  return request<Test>(`/api/runs/${id}/promote`, { method: 'POST', body: JSON.stringify(body) });
}

// ── Findings ─────────────────────────────────────────────────────────────────

export function getFindings(params: {
  projectId?: string;
  severity?: Severity;
  type?: FindingType;
  status?: FindingStatus;
}): Promise<Finding[]> {
  return request<Finding[]>(
    `/api/findings${qs({
      projectId: params.projectId,
      severity: params.severity,
      type: params.type,
      status: params.status,
    })}`
  );
}

export function patchFinding(id: string, status: FindingStatus): Promise<Finding> {
  return request<Finding>(`/api/findings/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// ── Checkpoints ──────────────────────────────────────────────────────────────

export function getCheckpoints(projectId: string): Promise<Checkpoint[]> {
  return request<Checkpoint[]>(`/api/projects/${projectId}/checkpoints`);
}

export function deleteCheckpoint(id: string): Promise<void> {
  return request<void>(`/api/checkpoints/${id}`, { method: 'DELETE' });
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSettings(): Promise<SettingsMap> {
  return request<SettingsMap>('/api/settings');
}

export function patchSettings(body: Partial<SettingsMap>): Promise<SettingsMap> {
  return request<SettingsMap>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });
}
