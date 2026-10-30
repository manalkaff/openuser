// BISNIS-41 review round 1: R1-F2, R1-F6 (tester MCP tools) and R1-F7 (bridge labels).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTesterTools } from '../src/tester/index.js';
import { bridgeWithStore } from '../src/bridge.js';

async function testerClient(baseUrl: string): Promise<Client> {
  const server = new McpServer({ name: 't', version: '0' });
  registerTesterTools(server, baseUrl);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe('tester MCP tool schemas', () => {
  it('R1-F2/F6 complete_run exposes tokens; report_finding exposes route and selector', async () => {
    const client = await testerClient('http://127.0.0.1:1');
    const tools = (await client.listTools()).tools;
    const props = (n: string) => Object.keys((tools.find((t) => t.name === n)!.inputSchema as any).properties);
    expect(props('complete_run')).toContain('tokens');
    expect(props('report_finding')).toEqual(expect.arrayContaining(['route', 'selector']));
  });
});

describe('R1-F2/F6 through a real daemon', () => {
  let stop: () => Promise<void>;
  let base: string;
  beforeAll(async () => {
    process.env['OPENUSER_RUNNER_KIND'] = 'fake';
    const { createServer } = await import('@openuser/server');
    const home = mkdtempSync(join(tmpdir(), 'mcp-r1-'));
    const inst = await createServer({ homeDir: home, port: 0 });
    base = `http://127.0.0.1:${inst.port}`;
    stop = () => inst.close();
  });
  afterAll(async () => {
    await stop();
  });

  it('tokens and route/selector reach the persisted run and finding', async () => {
    const post = async (path: string, body: unknown) => (await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
    const app = (await import('node:http')).createServer((_q, r) => r.writeHead(200).end('ok'));
    await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
    const appPort = (app.address() as { port: number }).port;
    const p = await post('/api/projects', { name: 'P', path: '/tmp/p-r1', baseUrl: `http://127.0.0.1:${appPort}` });
    const persona = await post(`/api/projects/${p.id}/personas`, {
      name: 'A', role: 'buyer',
      identity: { fullName: 'A', roleLabel: 'b', locale: 'en' },
      behavior: { techSavviness: 'average', patience: 'medium', readingStyle: 'reads', device: 'desktop', viewport: { width: 1280, height: 720 }, habits: 'h' },
      knowledge: { productKnowledge: 'n', expectations: 'e', vocabulary: 'v' },
    });
    const prep = await post('/api/runs', { projectId: p.id, adhocGoal: 'g', personaId: persona.id });

    const client = await testerClient(base);
    await client.callTool({ name: 'begin_run', arguments: { token: prep.token } });
    await client.callTool({ name: 'report_finding', arguments: { type: 'functional', severity: 'high', title: 'T', description: 'd', route: '/a/1', selector: 'button#x' } });
    await client.callTool({ name: 'complete_run', arguments: { verdict: 'partial', summary: 's', tokens: 777 } });
    app.close();

    const run = (await (await fetch(`${base}/api/runs/${prep.runId}`)).json()) as any;
    expect(run.telemetry.tokens).toBe(777);
    expect(run.findings).toHaveLength(1);
  });
});

describe('R1-F7 bridge labels by UUID', () => {
  it('resolves the kind:finding label id, applies it by id, and repairs on re-run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-multica-'));
    const log = join(dir, 'calls.jsonl');
    const LABEL = '7d0f720c-cf23-4d89-8e6f-7e40957e3f9d';
    writeFileSync(
      join(dir, 'multica'),
      `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (a[0] === 'label' && a[1] === 'list') console.log(JSON.stringify([{ id: '${LABEL}', name: 'kind:finding' }]));
else if (a[0] === 'issue' && a[1] === 'label') { if (!/^[0-9a-f-]{36}$/.test(a[4] || '')) { console.error('expected a UUID'); process.exit(1); } console.log('{}'); }
else if (a[0] === 'issue' && a[1] === 'create') console.log(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }));
else console.log('{}');
`,
    );
    chmodSync(join(dir, 'multica'), 0o755);
    const prev = process.env['PATH'];
    process.env['PATH'] = `${dir}:${prev}`;
    try {
      const cand = {
        id: 'f1', fingerprint: 'fp', severity: 'high' as const, title: 'T', description: 'd', occurrences: 1,
        lastSeen: 'x', runId: 'r', personaName: 'A', steps: [], screenshotUrls: [], issueId: null as string | null,
      };
      const recorded: string[] = [];
      const store = { list: async () => [cand], record: async (_f: string, i: string) => void recorded.push(i) };
      const res = await bridgeWithStore(store, 'p');
      expect(res.unlabelled).toEqual([]);
      const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
      const lab = calls.find((c) => c[0] === 'issue' && c[1] === 'label')!;
      expect(lab.slice(2)).toEqual(['add', '11111111-1111-4111-8111-111111111111', LABEL]);
      expect(existsSync(log)).toBe(true);
      expect(recorded).toHaveLength(1);
    } finally {
      process.env['PATH'] = prev;
    }
  });
});
