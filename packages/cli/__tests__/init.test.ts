import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/lib/daemon.js', () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue(8737),
  readDaemonJson: vi.fn().mockReturnValue({ port: 8737, pid: 1, version: '0.1.0', startedAt: '' }),
  isDaemonHealthy: vi.fn().mockResolvedValue(true),
  getHealthyDaemonPort: vi.fn().mockResolvedValue(8737),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('runInit', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openuser-init-'));
    vi.clearAllMocks();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes openuser.config.json with provided name and baseUrl (POST new)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'prj_abc123', name: 'my-app', path: tmpDir, baseUrl: 'http://localhost:3000', environments: [] }),
      });
    const { runInit } = await import('../src/commands/init.js');
    await runInit({ cwd: tmpDir, name: 'my-app', baseUrl: 'http://localhost:3000' });
    const cfgPath = join(tmpDir, 'openuser.config.json');
    expect(existsSync(cfgPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    expect(cfg.name).toBe('my-app');
    expect(cfg.baseUrl).toBe('http://localhost:3000');
    expect(Array.isArray(cfg.environments)).toBe(true);
  });

  it('PATCHes existing project when path already registered', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'prj_existing', name: 'old-name', path: tmpDir, baseUrl: 'http://localhost:3000', environments: [] }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'prj_existing', name: 'updated-app', path: tmpDir, baseUrl: 'http://localhost:5000', environments: [] }),
      });
    const { runInit } = await import('../src/commands/init.js');
    await runInit({ cwd: tmpDir, name: 'updated-app', baseUrl: 'http://localhost:5000' });
    const secondCall = mockFetch.mock.calls[1];
    expect(secondCall[1]?.method).toBe('PATCH');
    expect(secondCall[0]).toContain('prj_existing');
    const cfg = JSON.parse(readFileSync(join(tmpDir, 'openuser.config.json'), 'utf8'));
    expect(cfg.name).toBe('updated-app');
    expect(cfg.baseUrl).toBe('http://localhost:5000');
  });
});
