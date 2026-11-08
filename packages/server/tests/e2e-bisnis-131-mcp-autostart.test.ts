// BISNIS-131 AC4: the MCP manager autostarts the daemon from the CLI and sends the manager token.
// It is an e2e file because it needs the `pnpm build:release` layout (the migrations in cli/dist)
// and an idle machine: the CLI gives the daemon 5 s to start, which a parallel unit run can exceed.
// Run it with `pnpm build:release && pnpm --filter @openuser/server test -- e2e-bisnis-131`.
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = new URL('../../cli/dist/index.js', import.meta.url).pathname;
const hasReleaseCli = existsSync(CLI) && existsSync(new URL('../../cli/dist/migrations/meta/_journal.json', import.meta.url));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('BISNIS-131 acceptance (e2e)', () => {
  it.skipIf(!hasReleaseCli)('AC4 the MCP manager autostarts the daemon and its calls carry the token', async () => {
    const home = mkdtempSync(join(tmpdir(), 'openuser-ac4-mcp-'));
    dirs.push(home);
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
      expect((await fetch(`http://127.0.0.1:${daemon.port}/api/projects`)).status).toBe(401);
    } finally {
      mcp.kill('SIGTERM');
      await killDaemon(home);
    }
  }, 60_000);
});

/** Stop the daemon the test autostarted. It may come up after a failure, so wait for daemon.json. */
async function killDaemon(home: string): Promise<void> {
  const file = join(home, 'daemon.json');
  for (let i = 0; i < 40 && !existsSync(file); i++) await new Promise((r) => setTimeout(r, 250));
  if (!existsSync(file)) return;
  const { pid } = JSON.parse(readFileSync(file, 'utf8')) as { pid: number };
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
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
