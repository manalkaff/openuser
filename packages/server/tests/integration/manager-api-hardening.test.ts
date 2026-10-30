// BISNIS-41 PR #6 security review P1: the guard settings (seed/teardown commands, deny list, lock
// file) come only from config or CLI flags, and the manager API refuses foreign Host headers.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { request, createServer as createHttpServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { api } from '../acceptance/helpers.js';
import { createServer, type ServerOptions } from '../../src/app.js';
import { openDatabase } from '../../src/db/client.js';

// A harness that starts the daemon with server options (guard config, allowed hosts). QA's
// acceptance harness takes none, and its files belong to QA, so this one lives here.
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

type ApiResult = ReturnType<typeof api>;

interface Harness {
  port: number;
  prepare(): ApiResult;
  begin(token: string): ApiResult;
  complete(token: string): ApiResult;
  startRun(): Promise<{ runId: string; token: string; beginStatus: number }>;
  close(): Promise<void>;
}

async function startHarness(
  baseUrl?: string,
  serverOpts: Omit<ServerOptions, 'homeDir' | 'port'> = {},
): Promise<Harness> {
  const homeDir = mkdtempSync(join(tmpdir(), 'openuser-guarded-'));
  const srv = await createServer({ ...serverOpts, homeDir, port: 0 });
  const target = createHttpServer((_req, res) => res.writeHead(200).end('OK'));
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetPort = (target.address() as { port: number }).port;
  const port = srv.port;

  const project = await api(port, 'POST', '/api/projects', {
    name: 'Guarded Project',
    path: '/tmp/guarded-proj',
    baseUrl: baseUrl ?? `http://127.0.0.1:${targetPort}`,
  });
  const projectId = project.body.id as string;
  const persona = await api(port, 'POST', `/api/projects/${projectId}/personas`, PERSONA);
  const personaId = persona.body.id as string;

  const prepare = () =>
    api(port, 'POST', '/api/runs', { projectId, adhocGoal: 'Explore the home page', personaId });
  const begin = (token: string) => api(port, 'POST', '/api/tester/begin', {}, token);
  return {
    port,
    prepare,
    begin,
    complete: (token) =>
      api(port, 'POST', '/api/tester/complete', { verdict: 'partial', summary: 'done' }, token),
    async startRun() {
      const prep = await prepare();
      const { runId, token } = prep.body as { runId: string; token: string };
      return { runId, token, beginStatus: (await begin(token)).status };
    },
    async close() {
      target.close();
      await srv.close();
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

/** A raw request so the test controls the Host and Origin headers (fetch does not allow it). */
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('BISNIS-41 manager API hardening', () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.close();
    h = undefined;
  });

  it.each([
    ['seedCommand', 'touch /tmp/pwned-{tenant}'],
    ['teardownCommand', 'touch /tmp/pwned-{tenant}'],
    ['denyHosts', []],
    ['lockFile', '/tmp/other.lock'],
  ])('PATCH /api/settings refuses %s and leaves it unchanged', async (key, value) => {
    h = await startHarness();
    const before = await api(h.port, 'GET', '/api/settings');
    const res = await api(h.port, 'PATCH', '/api/settings', { [key]: value });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain(key);
    const after = await api(h.port, 'GET', '/api/settings');
    expect(after.body[key]).toEqual(before.body[key]);
  });

  it('PATCH /api/settings still changes the other settings', async () => {
    h = await startHarness();
    const res = await api(h.port, 'PATCH', '/api/settings', { maxSteps: 7 });
    expect(res.status).toBe(200);
    expect(res.body.maxSteps).toBe(7);
  });

  it('refuses a request whose Host is not the loopback or an allowed host', async () => {
    h = await startHarness();
    expect(await rawGet(h.port, '/api/settings', { Host: `evil.example:${h.port}` })).toBe(403);
    expect(await rawGet(h.port, '/api/health', { Host: 'rebind.attacker.test' })).toBe(403);
    expect(await rawGet(h.port, '/api/settings', { Host: `127.0.0.1:${h.port}` })).toBe(200);
    expect(await rawGet(h.port, '/api/settings', { Host: `localhost:${h.port}` })).toBe(200);
    expect(await rawGet(h.port, '/api/settings', { Host: `[::1]:${h.port}` })).toBe(200);
  });

  it('refuses a cross-site Origin even when the Host is loopback', async () => {
    h = await startHarness();
    const host = `127.0.0.1:${h.port}`;
    expect(
      await rawGet(h.port, '/api/settings', { Host: host, Origin: 'https://evil.example' }),
    ).toBe(403);
    expect(await rawGet(h.port, '/api/settings', { Host: host, Origin: `http://${host}` })).toBe(
      200,
    );
  });

  it('admits a Host added by the allowedHosts option', async () => {
    h = await startHarness(undefined, { allowedHosts: ['sweep.internal'] });
    expect(await rawGet(h.port, '/api/settings', { Host: `sweep.internal:${h.port}` })).toBe(200);
    expect(await rawGet(h.port, '/api/settings', { Host: `evil.example:${h.port}` })).toBe(403);
  });

  it('AC3 via config: each run seeds its own tenant and deletes it afterwards', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'cfg-seed-')), 'tenants.log');
    h = await startHarness(undefined, {
      guards: {
        seedCommand: `echo "seed {tenant}" >> ${log}`,
        teardownCommand: `echo "delete {tenant}" >> ${log}`,
      },
    });
    const s = await api(h.port, 'GET', '/api/settings');
    expect(s.body.seedCommand).toContain('{tenant}');

    const r1 = await h.prepare();
    const r2 = await h.prepare();
    await h.begin(r1.body.token);
    await h.complete(r1.body.token);
    await h.begin(r2.body.token);
    await h.complete(r2.body.token);

    const t1 = `run-${r1.body.runId}`;
    const t2 = `run-${r2.body.runId}`;
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual([
      `seed ${t1}`,
      `delete ${t1}`,
      `seed ${t2}`,
      `delete ${t2}`,
    ]);
  });

  it('AC6 via config: a held lock file makes a second begin_run refuse', async () => {
    const lock = join(mkdtempSync(join(tmpdir(), 'cfg-lock-')), 'ui-sweep.lock');
    h = await startHarness(undefined, { guards: { lockFile: lock } });
    const first = await h.startRun();
    expect(first.beginStatus).toBe(200);
    expect(existsSync(lock)).toBe(true);

    const second = await h.prepare();
    expect((await h.begin(second.body.token)).status).toBe(409);
    await h.complete(first.token);
    expect(existsSync(lock)).toBe(false);
    expect((await h.begin(second.body.token)).status).toBe(200);
  });

  it('AC7 via config: the deny list comes from config', async () => {
    h = await startHarness('https://not23bisnis.com', {
      guards: { denyHosts: ['not23bisnis.com'] },
    });
    const s = await api(h.port, 'GET', '/api/settings');
    expect(s.body.denyHosts).toEqual(['23bisnis.com', 'not23bisnis.com']);
    const denied = await h.prepare();
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain('not23bisnis.com');
  });

  it('AC7 via config: a deny list without 23bisnis.com still refuses an app.23bisnis.com target', async () => {
    h = await startHarness('https://app.23bisnis.com', {
      guards: { denyHosts: ['other.example'] },
    });
    const denied = await h.prepare();
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.body)).toContain('23bisnis.com');
  });

  it('reads the guard settings from <home>/config.json, and CLI options win over it', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'cfg-home-'));
    writeFileSync(
      join(homeDir, 'config.json'),
      JSON.stringify({
        lockFile: '/var/lock/x.lock',
        denyHosts: ['a.test'],
        allowedHosts: ['box.lan'],
      }),
    );
    const srv = await createServer({ homeDir, port: 0, guards: { denyHosts: ['b.test'] } });
    try {
      const s = await api(srv.port, 'GET', '/api/settings');
      expect(s.body.lockFile).toBe('/var/lock/x.lock');
      expect(s.body.denyHosts).toEqual(['23bisnis.com', 'b.test']);
      expect(await rawGet(srv.port, '/api/health', { Host: `box.lan:${srv.port}` })).toBe(200);
    } finally {
      await srv.close();
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('ignores guard values an earlier version stored through PATCH', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'cfg-legacy-'));
    const { sqlite } = openDatabase(homeDir);
    const insert = sqlite.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run('denyHosts', JSON.stringify([]));
    insert.run('seedCommand', JSON.stringify('touch /tmp/pwned'));
    sqlite.close();

    const srv = await createServer({ homeDir, port: 0 });
    try {
      const s = await api(srv.port, 'GET', '/api/settings');
      expect(s.body.denyHosts).toEqual(['23bisnis.com']);
      expect(s.body.seedCommand).toBe('');
    } finally {
      await srv.close();
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
