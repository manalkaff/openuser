/**
 * Integration test: real @openuser/server with FakeRunner + temp OPENUSER_HOME +
 * official MCP SDK Client over StdioClientTransport spawning the bin.
 *
 * Flow tested:
 *   Manager: register_project → create_persona → create_test → prepare_run
 *   Tester:  begin_run → browser_snapshot → browser_click → report_finding → complete_run
 *   Manager: get_run (assert status=passed or failed) + get_findings (assert finding present)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// The bin path after build
const BIN_PATH = new URL('../dist/bin.js', import.meta.url).pathname;

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface McpCallResult {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  isError?: boolean;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const result = await client.callTool({ name, arguments: args });
  return result as McpCallResult;
}

function parseJson(result: McpCallResult): unknown {
  if (result.isError) throw new Error(`Tool error: ${result.content[0]?.text ?? 'unknown'}`);
  const text = result.content[0]?.text;
  if (!text) throw new Error('No text content in result');
  return JSON.parse(text);
}

function getTextResult(result: McpCallResult): string {
  if (result.isError) throw new Error(`Tool error: ${result.content[0]?.text ?? 'unknown'}`);
  return result.content[0]?.text ?? '';
}

// Spawn a daemon in-process using @openuser/server's startServer export.
// We use a dynamic import so the test file itself compiles without server being
// a hard compile-time dep in mcp (it is a devDependency).
async function startTestDaemon(openUserHome: string): Promise<{ port: number; stop: () => Promise<void> }> {
  // Dynamic import of the server package (available as devDependency).
  // Plan 02 exports createServer(opts: ServerOptions): Promise<ServerInstance>.
  // Runner kind is controlled via env var OPENUSER_RUNNER_KIND=fake (Plan 03 §7).
  const { createServer } = await import('@openuser/server');

  process.env['OPENUSER_RUNNER_KIND'] = 'fake'; // Use FakeRunner — no Playwright needed

  const instance = await createServer({
    homeDir: openUserHome,
    port: 0, // OS-assigned port (findFreePort uses this as starting point; daemon.json is written by createServer)
  });

  return {
    port: instance.port,
    stop: () => instance.close(),
  };
}

// Spawn an MCP client connected to the bin via stdio
async function spawnMcpClient(role: 'manager' | 'tester', openUserHome: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN_PATH, '--role', role],
    env: {
      ...process.env,
      OPENUSER_HOME: openUserHome,
      // OPENUSER_CLI_ENTRY not set — daemon already running, so no autostart needed
    },
  });

  const client = new Client({ name: `test-${role}-client`, version: '0.1.0' });
  await client.connect(transport);

  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

let openUserHome: string;
let daemonStop: () => Promise<void> = async () => {};
let daemonBaseUrl: string;
let managerClient: Client;
let managerClose: () => Promise<void> = async () => {};
let testerClient: Client;
let testerClose: () => Promise<void> = async () => {};

// State threaded through tests
let projectId: string;
let personaId: string;
let testId: string;
let runId: string;
let testerToken: string;

beforeAll(async () => {
  // Create isolated temp home
  openUserHome = await mkdtemp(join(tmpdir(), 'openuser-integration-'));
  await mkdir(join(openUserHome, 'artifacts'), { recursive: true });
  await mkdir(join(openUserHome, 'checkpoints'), { recursive: true });

  // Start real daemon with FakeRunner
  const daemon = await startTestDaemon(openUserHome);
  daemonStop = daemon.stop;
  // Use the daemon's own URL as the project baseUrl — the begin handler does a
  // preflight HTTP check to this URL before launching the runner, so we point
  // it at the daemon itself (which is always reachable) to make FakeRunner tests work.
  daemonBaseUrl = `http://127.0.0.1:${daemon.port}`;

  // Spawn manager MCP client
  const mgr = await spawnMcpClient('manager', openUserHome);
  managerClient = mgr.client;
  managerClose = mgr.close;

  // Spawn tester MCP client (session is initially empty)
  const tstr = await spawnMcpClient('tester', openUserHome);
  testerClient = tstr.client;
  testerClose = tstr.close;
}, 30_000);

afterAll(async () => {
  await managerClose().catch(() => {});
  await testerClose().catch(() => {});
  await daemonStop().catch(() => {});
  if (openUserHome) {
    await rm(openUserHome, { recursive: true, force: true }).catch(() => {});
  }
});

describe('Manager flow — register project + persona + test + prepare_run', () => {
  it('register_project succeeds', async () => {
    const result = await callTool(managerClient, 'register_project', {
      name: 'Integration Test Shop',
      path: openUserHome,
      baseUrl: daemonBaseUrl,
    });
    const project = parseJson(result) as { id: string; name: string };
    expect(project.id).toMatch(/^prj_/);
    expect(project.name).toBe('Integration Test Shop');
    projectId = project.id;
  });

  it('list_projects returns the registered project', async () => {
    const result = await callTool(managerClient, 'list_projects', {});
    const projects = parseJson(result) as { id: string }[];
    expect(projects.some((p) => p.id === projectId)).toBe(true);
  });

  it('create_persona succeeds', async () => {
    const result = await callTool(managerClient, 'create_persona', {
      projectId,
      name: 'First-time Buyer',
      role: 'buyer',
      identity: {
        fullName: 'Alice Smith',
        roleLabel: 'first-time buyer',
        locale: 'en-US',
        credentials: { username: 'alice@example.com', password: 'password123' },
      },
      behavior: {
        techSavviness: 'average',
        patience: 'medium',
        readingStyle: 'skims',
        device: 'desktop',
        viewport: { width: 1280, height: 720 },
        habits: 'Shops online occasionally, expects familiar e-commerce patterns',
      },
      knowledge: {
        productKnowledge: 'Has never used this shop before',
        expectations: 'Standard checkout process, clear pricing',
        vocabulary: 'cart, checkout, pay, order, buy',
      },
    });
    const persona = parseJson(result) as { id: string; name: string };
    expect(persona.id).toMatch(/^per_/);
    expect(persona.name).toBe('First-time Buyer');
    personaId = persona.id;
  });

  it('list_personas returns the created persona', async () => {
    const result = await callTool(managerClient, 'list_personas', { projectId });
    const personas = parseJson(result) as { id: string }[];
    expect(personas.some((p) => p.id === personaId)).toBe(true);
  });

  it('create_test succeeds', async () => {
    const result = await callTool(managerClient, 'create_test', {
      projectId,
      title: 'Smoke: checkout with bank transfer',
      goal: 'Navigate to the shop, add a product to the cart, proceed to checkout, and complete a purchase using bank transfer.',
      preconditions: 'App is running at the test daemon URL',
      expectedOutcome: 'Order confirmation page is shown with an order ID',
      priority: 'high',
      tags: ['checkout', 'smoke'],
      source: 'manual',
    });
    const test = parseJson(result) as { id: string; title: string };
    expect(test.id).toMatch(/^tst_/);
    expect(test.title).toBe('Smoke: checkout with bank transfer');
    testId = test.id;
  });

  it('list_tests returns the created test', async () => {
    const result = await callTool(managerClient, 'list_tests', { projectId });
    const tests = parseJson(result) as { id: string }[];
    expect(tests.some((t) => t.id === testId)).toBe(true);
  });

  it('prepare_run returns runId + token + testerPrompt', async () => {
    const result = await callTool(managerClient, 'prepare_run', {
      projectId,
      testId,
      personaId,
      agentLabel: 'vitest-integration',
    });
    const data = parseJson(result) as { runId: string; token: string; testerPrompt: string; _instruction: string };
    expect(data.runId).toMatch(/^run_/);
    expect(data.token).toMatch(/^rt_/);
    expect(data.testerPrompt).toContain('begin_run');
    expect(data.testerPrompt).toContain(data.token);
    expect(data._instruction).toContain('testerPrompt');
    runId = data.runId;
    testerToken = data.token;
  });
});

describe('Tester flow — begin_run through complete_run', () => {
  it('any tester tool before begin_run returns instructive error', async () => {
    const result = await callTool(testerClient, 'browser_snapshot', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('begin_run');
  });

  it('begin_run with valid token returns personaCard + mission + snapshot', async () => {
    const result = await callTool(testerClient, 'begin_run', { token: testerToken });
    const data = parseJson(result) as { personaCard: string; mission: string; snapshot: { url: string; tree: string } };
    expect(data.personaCard).toContain('Alice Smith');
    expect(data.mission).toContain('bank transfer');
    expect(typeof data.snapshot.tree).toBe('string');
  });

  it('browser_snapshot returns page tree', async () => {
    const result = await callTool(testerClient, 'browser_snapshot', {});
    const snap = parseJson(result) as { url: string; title: string; tree: string };
    expect(typeof snap.url).toBe('string');
    expect(typeof snap.tree).toBe('string');
  });

  it('browser_click with FakeRunner ref returns updated snapshot', async () => {
    // FakeRunner accepts any ref without error
    const result = await callTool(testerClient, 'browser_click', {
      ref: 'e1',
      note: 'Clicking the first interactive element on the page',
    });
    // FakeRunner returns ok:true with a snapshot
    const snap = parseJson(result) as { url: string };
    expect(typeof snap.url).toBe('string');
  });

  it('browser_navigate returns updated snapshot', async () => {
    const result = await callTool(testerClient, 'browser_navigate', {
      url: `${daemonBaseUrl}/products`,
    });
    const snap = parseJson(result) as { url: string };
    expect(typeof snap.url).toBe('string');
  });

  it('browser_type returns updated snapshot', async () => {
    const result = await callTool(testerClient, 'browser_type', {
      ref: 'e2',
      text: 'test input',
    });
    const snap = parseJson(result) as { url: string };
    expect(typeof snap.url).toBe('string');
  });

  it('browser_select returns updated snapshot', async () => {
    const result = await callTool(testerClient, 'browser_select', {
      ref: 'e3',
      value: 'bank_transfer',
    });
    const snap = parseJson(result) as { url: string };
    expect(typeof snap.url).toBe('string');
  });

  it('browser_scroll returns updated snapshot', async () => {
    const result = await callTool(testerClient, 'browser_scroll', {
      direction: 'down',
      amountPx: 400,
    });
    const snap = parseJson(result) as { url: string };
    expect(typeof snap.url).toBe('string');
  });

  it('browser_back returns updated snapshot', async () => {
    const result = await callTool(testerClient, 'browser_back', {});
    const snap = parseJson(result) as { url: string };
    expect(typeof snap.url).toBe('string');
  });

  it('browser_wait returns updated snapshot', async () => {
    const result = await callTool(testerClient, 'browser_wait', { seconds: 1 });
    const snap = parseJson(result) as { url: string };
    expect(typeof snap.url).toBe('string');
  });

  it('report_finding returns a finding with fnd_ ID', async () => {
    const result = await callTool(testerClient, 'report_finding', {
      type: 'ux_confusion',
      severity: 'medium',
      title: 'Checkout button disappeared',
      description:
        'I selected bank transfer as my payment method, but then the checkout button disappeared. I had no idea what to do next and felt completely lost.',
    });
    const finding = parseJson(result) as { id: string; type: string; severity: string };
    expect(finding.id).toMatch(/^fnd_/);
    expect(finding.type).toBe('ux_confusion');
    expect(finding.severity).toBe('medium');
  });

  it('complete_run returns status and findings list', async () => {
    const result = await callTool(testerClient, 'complete_run', {
      verdict: 'partial',
      summary:
        'I managed to add items to the cart and reach the payment step, but the checkout button disappeared after selecting bank transfer. Could not complete the purchase.',
    });
    const data = parseJson(result) as { status: string; findings: { id: string }[] };
    expect(['passed', 'blocked', 'failed', 'aborted'].includes(data.status)).toBe(true);
    expect(Array.isArray(data.findings)).toBe(true);
  });
});

describe('Manager flow — post-run verification', () => {
  it('get_run returns run with status and findings', async () => {
    const result = await callTool(managerClient, 'get_run', { runId });
    const run = parseJson(result) as { id: string; status: string; findings: { id: string }[] };
    expect(run.id).toBe(runId);
    expect(['passed', 'blocked', 'failed', 'aborted'].includes(run.status)).toBe(true);
    expect(run.findings.length).toBeGreaterThanOrEqual(1);
  });

  it('get_findings returns findings including the one reported by tester', async () => {
    const result = await callTool(managerClient, 'get_findings', { projectId });
    const findings = parseJson(result) as { id: string; type: string }[];
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const uxFinding = findings.find((f) => f.type === 'ux_confusion');
    expect(uxFinding).toBeDefined();
  });

  it('get_report returns markdown string', async () => {
    const result = await callTool(managerClient, 'get_report', { runId });
    const report = getTextResult(result);
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(10);
  });

  it('update_finding changes status to acknowledged', async () => {
    // Get a finding ID first
    const findingsResult = await callTool(managerClient, 'get_findings', { projectId });
    const findings = parseJson(findingsResult) as { id: string }[];
    const findingId = findings[0]!.id;

    const result = await callTool(managerClient, 'update_finding', {
      findingId,
      status: 'acknowledged',
    });
    const finding = parseJson(result) as { status: string };
    expect(finding.status).toBe('acknowledged');
  });

  it('list_runs includes the completed run', async () => {
    const result = await callTool(managerClient, 'list_runs', { projectId });
    const runs = parseJson(result) as { id: string }[];
    expect(runs.some((r) => r.id === runId)).toBe(true);
  });
});

describe('Tester boundary — second begin_run attempt after complete', () => {
  it('browser_snapshot after complete_run returns instructive error (session cleared)', async () => {
    const result = await callTool(testerClient, 'browser_snapshot', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('begin_run');
  });
});

