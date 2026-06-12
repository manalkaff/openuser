import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createServer } from '../../src/app.js';
import type { ServerInstance } from '../../src/app.js';

describe('T-04: health route', () => {
  let instance: ServerInstance;
  const homeDir = join(tmpdir(), `openuser-test-health-${Date.now()}`);

  beforeAll(async () => {
    mkdirSync(homeDir, { recursive: true });
    instance = await createServer({ homeDir, port: 19800, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await instance.close();
  });

  it('GET /api/health returns { ok: true, version }', async () => {
    const res = await fetch(`http://127.0.0.1:${instance.port}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
  });

  it('daemon.json is written with correct port and pid', async () => {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(join(homeDir, 'daemon.json'), 'utf8');
    const daemon = JSON.parse(raw) as { port: number; pid: number; version: string; startedAt: string };
    expect(daemon.port).toBe(instance.port);
    expect(daemon.pid).toBe(process.pid);
    expect(typeof daemon.version).toBe('string');
    expect(typeof daemon.startedAt).toBe('string');
  });
});
