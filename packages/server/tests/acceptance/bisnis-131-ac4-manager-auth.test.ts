// BISNIS-131 AC4: another local OS user cannot use the manager API on loopback. The daemon keeps
// its home at 0700, writes a fresh 0600 manager token on every start, and refuses every route
// without that token or a dashboard session (default-deny). The CLI and MCP clients send it.
// The other-OS-user case itself cannot run in CI; the PR's T3 checklist argues it from these
// three properties (0700 home + 0600 token + default-deny).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';
import { createServer, type ServerInstance, type ServerOptions } from '../../src/app.js';

const posix = process.platform !== 'win32';
const CLI = new URL('../../../cli/dist/index.js', import.meta.url).pathname;
const hasCli = existsSync(CLI);
// A daemon started from the CLI needs the migrations that `pnpm build:release` copies into
// cli/dist; a plain `pnpm build` (the CI unit job) does not, so the autostart test skips there.
const hasReleaseCli = hasCli && existsSync(new URL('../../../cli/dist/migrations/meta/_journal.json', import.meta.url));

const dirs: string[] = [];
const servers: ServerInstance[] = [];

function tempHome(): string {
  const d = mkdtempSync(join(tmpdir(), 'openuser-ac4-'));
  dirs.push(d);
  return d;
}

async function start(homeDir: string, opts: Omit<ServerOptions, 'homeDir' | 'port'> = {}): Promise<ServerInstance> {
  const srv = await createServer({ ...opts, homeDir, port: 0 });
  servers.push(srv);
  return srv;
}

async function stop(srv: ServerInstance): Promise<void> {
  servers.splice(servers.indexOf(srv), 1);
  await srv.close();
}

afterEach(async () => {
  vi.useRealTimers();
  for (const s of servers.splice(0)) await s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function concrete(path: string): string {
  return path.replace(/:[A-Za-z]+/g, 'x').replace(/\*$/, 'x.png');
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: '{}' }),
    redirect: 'manual',
  });
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Open a WebSocket to /ws and report how the upgrade ended: 'open' or the HTTP status. */
function wsUpgrade(port: number, headers: Record<string, string> = {}): Promise<'open' | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on('error', reject);
  });
}

async function login(port: number, code: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/auth/login?code=${encodeURIComponent(code)}`, { redirect: 'manual' });
}

async function loginCode(srv: ServerInstance): Promise<string> {
  const res = await call(srv.port, 'POST', '/api/auth/login-code', bearer(srv.token));
  expect(res.status).toBe(201);
  return ((await res.json()) as { code: string }).code;
}

const PUBLIC = new Set(['GET /api/health', 'GET /auth/login']);
const isPublic = (method: string, path: string) => PUBLIC.has(`${method} ${path}`) || path.startsWith('/api/tester/');

describe('BISNIS-131 acceptance', () => {
  it('AC4 every mounted manager route refuses no token and a wrong token, and accepts the right one', async () => {
    const srv = await start(tempHome());
    const routes = srv.routes.filter((r) => !isPublic(r.method, r.path));
    // Enumerated from the app, so a route added later is in the table without editing it.
    expect(routes.length).toBeGreaterThanOrEqual(30);
    expect(routes).toEqual(expect.arrayContaining([
      { method: 'POST', path: '/api/runs' },
      { method: 'GET', path: '/ws' },
      { method: 'GET', path: '/artifacts/*' },
      { method: 'GET', path: '/api/version' },
    ]));
    const wrong = 'x'.repeat(srv.token.length);
    expect(wrong).not.toBe(srv.token);
    for (const r of routes) {
      const path = concrete(r.path);
      const none = await call(srv.port, r.method, path);
      const bad = await call(srv.port, r.method, path, bearer(wrong));
      const good = await call(srv.port, r.method, path, bearer(srv.token));
      expect({ route: `${r.method} ${r.path}`, none: none.status, bad: bad.status })
        .toEqual({ route: `${r.method} ${r.path}`, none: 401, bad: 401 });
      expect({ route: `${r.method} ${r.path}`, good: good.status === 401 })
        .toEqual({ route: `${r.method} ${r.path}`, good: false });
    }
  });

  it('AC4 the /ws upgrade is refused without auth and accepted with the token', async () => {
    const srv = await start(tempHome());
    expect(await wsUpgrade(srv.port)).toBe(401);
    expect(await wsUpgrade(srv.port, bearer('y'.repeat(srv.token.length)))).toBe(401);
    expect(await wsUpgrade(srv.port, bearer(srv.token))).toBe('open');
  });

  it('AC4 an existing artifact is refused without auth', async () => {
    const home = tempHome();
    const srv = await start(home);
    mkdirSync(join(home, 'artifacts', 'run_a'), { recursive: true });
    writeFileSync(join(home, 'artifacts', 'run_a', 'shot.png'), 'png-bytes');
    expect((await call(srv.port, 'GET', '/artifacts/run_a/shot.png')).status).toBe(401);
    const ok = await call(srv.port, 'GET', '/artifacts/run_a/shot.png', bearer(srv.token));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('png-bytes');
  });

  it('AC4 the dashboard itself is refused without a session', async () => {
    const ui = tempHome();
    writeFileSync(join(ui, 'index.html'), '<html>dashboard</html>');
    const srv = await start(tempHome(), { uiDir: ui });
    expect((await call(srv.port, 'GET', '/')).status).toBe(401);
    expect((await call(srv.port, 'GET', '/_app/x.js')).status).toBe(401);
  });

  it('AC4 /api/health answers liveness only, without a token', async () => {
    const srv = await start(tempHome());
    const res = await call(srv.port, 'GET', '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.runIf(posix)('AC4 a pre-existing 0755 home is 0700 after start, and the token file is 0600', async () => {
    const home = tempHome();
    chmodSync(home, 0o755);
    await start(home);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, 'daemon.token')).mode & 0o777).toBe(0o600);
  });

  it('AC4 the token changes on every restart and the old one stops working', async () => {
    const home = tempHome();
    const first = await start(home);
    const oldToken = first.token;
    expect(readFileSync(join(home, 'daemon.token'), 'utf8')).toBe(oldToken);
    await stop(first);
    const second = await start(home);
    expect(second.token).not.toBe(oldToken);
    expect(readFileSync(join(home, 'daemon.token'), 'utf8')).toBe(second.token);
    expect((await call(second.port, 'GET', '/api/projects', bearer(oldToken))).status).toBe(401);
    expect((await call(second.port, 'GET', '/api/projects', bearer(second.token))).status).toBe(200);
  });

  it('AC4 a one-time login code gives a session cookie once, and fails on reuse', async () => {
    const srv = await start(tempHome());
    expect((await call(srv.port, 'POST', '/api/auth/login-code')).status).toBe(401);
    const code = await loginCode(srv);
    expect(code).not.toContain(srv.token);

    const first = await login(srv.port, code);
    expect(first.status).toBe(302);
    expect(first.headers.get('location')).toBe('/');
    const cookie = first.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^openuser_session=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain(srv.token);
    const session = cookie.split(';')[0]!;
    expect((await call(srv.port, 'GET', '/api/projects', { Cookie: session })).status).toBe(200);
    expect(await wsUpgrade(srv.port, { Cookie: session })).toBe('open');

    expect((await login(srv.port, code)).status).toBe(401);
    expect((await login(srv.port, 'never-issued')).status).toBe(401);
    expect((await call(srv.port, 'GET', '/api/projects', { Cookie: 'openuser_session=forged' })).status).toBe(401);
  });

  it('AC4 a login code fails after 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T10:00:00Z'));
    const srv = await start(tempHome());
    const late = await loginCode(srv);
    const onTime = await loginCode(srv);
    vi.setSystemTime(new Date('2026-11-09T10:05:00Z'));
    expect((await login(srv.port, onTime)).status).toBe(302);
    vi.setSystemTime(new Date('2026-11-09T10:05:01Z'));
    expect((await login(srv.port, late)).status).toBe(401);
  });

  it('AC4 a restart ends every dashboard session', async () => {
    const home = tempHome();
    const first = await start(home);
    const res = await login(first.port, await loginCode(first));
    const session = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
    const port = first.port;
    await stop(first);
    const second = await createServer({ homeDir: home, port });
    servers.push(second);
    expect((await call(second.port, 'GET', '/api/projects', { Cookie: session })).status).toBe(401);
  });

  it('AC4 a tester run token cannot be obtained without the manager token', async () => {
    const srv = await start(tempHome());
    const auth = bearer(srv.token);
    const project = await call(srv.port, 'POST', '/api/projects', auth);
    expect(project.status).toBe(400); // empty body: the route is reachable with the token
    const prepare = await fetch(`http://127.0.0.1:${srv.port}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'prj_x', personaId: 'per_x', adhocGoal: 'buy' }),
    });
    expect(prepare.status).toBe(401);
    expect(await prepare.json()).not.toHaveProperty('token');
    const runs = await call(srv.port, 'GET', '/api/runs', auth);
    expect(await runs.json()).toEqual([]);
  });

  it.skipIf(!hasCli)('AC4 the CLI reads the token file and prints a working one-time login link', async () => {
    const home = tempHome();
    const srv = await start(home);
    const out = await runCli(['start', '--no-open'], { OPENUSER_HOME: home });
    expect(out.code).toBe(0);
    const link = /(http:\/\/\S+\/auth\/login\?code=\S+)/.exec(out.stdout)?.[1];
    expect(link, out.stdout + out.stderr).toBeDefined();
    expect(link).not.toContain(srv.token);
    const res = await fetch(link!.replace('localhost', '127.0.0.1'), { redirect: 'manual' });
    expect(res.status).toBe(302);
  });

  it.skipIf(!hasCli)('AC4 the CLI names the token path when it cannot read the token', async () => {
    const home = tempHome();
    await start(home);
    rmSync(join(home, 'daemon.token'));
    const out = await runCli(['start', '--no-open'], { OPENUSER_HOME: home });
    expect(out.code).not.toBe(0);
    expect(out.stderr).toContain(join(home, 'daemon.token'));
  });

  it.skipIf(!hasReleaseCli)('AC4 the MCP manager autostarts the daemon and its calls carry the token', async () => {
    const home = tempHome();
    const mcp = spawn(process.execPath, [CLI, 'mcp', '--role', 'manager'], {
      env: { ...process.env, OPENUSER_HOME: home, OPENUSER_RUNNER_KIND: 'fake' },
    });
    try {
      const rpc = jsonRpc(mcp);
      await rpc.request('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'ac4', version: '0' },
      });
      rpc.notify('notifications/initialized');
      const result = (await rpc.request('tools/call', { name: 'list_projects', arguments: {} })) as {
        isError?: boolean;
        content: { text: string }[];
      };
      expect(result.isError ?? false).toBe(false);
      expect(JSON.parse(result.content[0]!.text)).toEqual([]);
      // The autostarted daemon is the one the token belongs to, and it refuses calls without it.
      const daemon = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { port: number };
      expect((await call(daemon.port, 'GET', '/api/projects')).status).toBe(401);
    } finally {
      mcp.kill('SIGTERM');
      killDaemon(home);
    }
  }, 60_000);
});

function killDaemon(home: string): void {
  try {
    const { pid } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')) as { pid: number };
    process.kill(pid, 'SIGTERM');
  } catch {
    // no daemon was started
  }
}

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** A minimal newline-delimited JSON-RPC client over the MCP server's stdio. */
function jsonRpc(child: ChildProcessWithoutNullStreams) {
  let buf = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  child.stderr.on('data', (d) => (stderr += String(d)));
  child.stdout.on('data', (d) => {
    buf += String(d);
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
      const p = msg.id !== undefined ? pending.get(msg.id) : undefined;
      if (!p) continue;
      pending.delete(msg.id!);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  });
  child.on('close', (code) => {
    for (const p of pending.values()) p.reject(new Error(`MCP exited ${code}: ${stderr}`));
  });
  return {
    request(method: string, params: unknown): Promise<unknown> {
      const id = nextId++;
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    notify(method: string): void {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
    },
  };
}
