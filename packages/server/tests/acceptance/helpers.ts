import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type ServerInstance } from '../../src/app.js';

export async function api(port: number, method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // keep text
  }
  return { status: res.status, body: json as any };
}

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

const PERSONA = {
  name: 'Alice',
  role: 'buyer',
  identity: { fullName: 'Alice Tester', roleLabel: 'first-time buyer', locale: 'en-US' },
  behavior: {
    techSavviness: 'average',
    patience: 'medium',
    readingStyle: 'reads',
    device: 'desktop',
    viewport: { width: 1280, height: 720 },
    habits: 'shops online occasionally',
  },
  knowledge: { productKnowledge: 'none', expectations: 'easy checkout', vocabulary: 'product, cart' },
};

export interface Harness {
  homeDir: string;
  port: number;
  projectId: string;
  personaId: string;
  /** prepare + begin a run; returns ids and token */
  startRun(goal?: string): Promise<{ runId: string; token: string; beginStatus: number }>;
  prepare(goal?: string): Promise<{ status: number; body: any }>;
  begin(token: string): Promise<{ status: number; body: any }>;
  action(token: string): Promise<{ status: number; body: any }>;
  finding(token: string, body: Record<string, unknown>): Promise<{ status: number; body: any }>;
  complete(token: string, extra?: Record<string, unknown>): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export async function startHarness(baseUrlOverride?: string): Promise<Harness> {
  const homeDir = mkdtempSync(join(tmpdir(), 'openuser-acc-'));
  const srv: ServerInstance = await createServer({ homeDir, port: 0 });
  const fakeApp = await startFakeApp();
  const port = srv.port;
  const p = await api(port, 'POST', '/api/projects', {
    name: 'Acceptance Project',
    path: '/tmp/acc-proj',
    baseUrl: baseUrlOverride ?? `http://127.0.0.1:${fakeApp.port}`,
  });
  const projectId = p.body.id as string;
  const pe = await api(port, 'POST', `/api/projects/${projectId}/personas`, PERSONA);
  const personaId = pe.body.id as string;

  const prepare = (goal = 'Explore the home page') =>
    api(port, 'POST', '/api/runs', { projectId, adhocGoal: goal, personaId });
  const begin = (token: string) => api(port, 'POST', '/api/tester/begin', {}, token);
  return {
    homeDir,
    port,
    projectId,
    personaId,
    prepare,
    begin,
    async startRun(goal) {
      const prep = await prepare(goal);
      const { runId, token } = prep.body as { runId: string; token: string };
      const b = await begin(token);
      return { runId, token, beginStatus: b.status };
    },
    action: (token) => api(port, 'POST', '/api/tester/action', { kind: 'click', ref: 'e7', note: 'step' }, token),
    finding: (token, body) => api(port, 'POST', '/api/tester/finding', body, token),
    complete: (token, extra = {}) =>
      api(port, 'POST', '/api/tester/complete', { verdict: 'partial', summary: 'done', ...extra }, token),
    async close() {
      fakeApp.close();
      await srv.close();
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}
