import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/lib/daemon.js', () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue(8737),
  readDaemonJson: vi.fn().mockReturnValue({ port: 8737, pid: 1, version: '0.1.0', startedAt: '' }),
  isDaemonHealthy: vi.fn().mockResolvedValue(true),
  getHealthyDaemonPort: vi.fn().mockResolvedValue(8737),
}));

// Point skills discovery at a fake skills root so the agent-setup tests don't depend
// on `build:release` having populated packages/cli/skills/.
const fakeSkillsRoot = mkdtempSync(join(tmpdir(), 'openuser-init-skills-'));
for (const skill of ['openuser-manager', 'openuser-tester']) {
  mkdirSync(join(fakeSkillsRoot, skill), { recursive: true });
  writeFileSync(join(fakeSkillsRoot, skill, 'SKILL.md'), `# ${skill}`);
}
vi.mock('../src/lib/paths.js', () => ({
  bundledSkillsDir: () => fakeSkillsRoot,
  bundledUiDir: () => '/unused',
  bundledMigrationsDir: () => '/unused',
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
    if (!secondCall) throw new Error('Expected a second fetch call');
    expect(secondCall[1]?.method).toBe('PATCH');
    expect(secondCall[0]).toContain('prj_existing');
    const cfg = JSON.parse(readFileSync(join(tmpDir, 'openuser.config.json'), 'utf8'));
    expect(cfg.name).toBe('updated-app');
    expect(cfg.baseUrl).toBe('http://localhost:5000');
  });

  it('does NOT write MCP config or skills when no agent is given', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'prj_x', name: 'app', path: tmpDir, baseUrl: 'http://localhost:3000', environments: [] }),
      });
    const { runInit } = await import('../src/commands/init.js');
    await runInit({ cwd: tmpDir, name: 'app', baseUrl: 'http://localhost:3000' });
    expect(existsSync(join(tmpDir, '.mcp.json'))).toBe(false);
    expect(existsSync(join(tmpDir, '.claude'))).toBe(false);
  });

  it('installs skills + writes .mcp.json when agent=claude', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'prj_y', name: 'app', path: tmpDir, baseUrl: 'http://localhost:3000', environments: [] }),
      });
    const { runInit } = await import('../src/commands/init.js');
    await runInit({ cwd: tmpDir, name: 'app', baseUrl: 'http://localhost:3000', agent: 'claude' });

    // MCP config written and well-formed.
    const mcpPath = join(tmpDir, '.mcp.json');
    expect(existsSync(mcpPath)).toBe(true);
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(mcp.mcpServers['openuser-manager']).toEqual({
      command: 'openuser',
      args: ['mcp', '--role', 'manager'],
    });
    expect(mcp.mcpServers['openuser-tester']).toBeDefined();

    // Skills copied from the bundled skills dir into .claude/skills/.
    expect(existsSync(join(tmpDir, '.claude', 'skills', 'openuser-manager', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.claude', 'skills', 'openuser-tester', 'SKILL.md'))).toBe(true);
  });

  it('writes the codex config shape when agent=codex', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'prj_z', name: 'app', path: tmpDir, baseUrl: 'http://localhost:3000', environments: [] }),
      });
    const { runInit } = await import('../src/commands/init.js');
    await runInit({ cwd: tmpDir, name: 'app', baseUrl: 'http://localhost:3000', agent: 'codex' });
    const cfg = JSON.parse(readFileSync(join(tmpDir, '.codex', 'config.json'), 'utf8'));
    expect(cfg.mcpServers['openuser-manager']).toBeDefined();
    expect(existsSync(join(tmpDir, '.agents', 'skills', 'openuser-manager', 'SKILL.md'))).toBe(true);
  });
});
