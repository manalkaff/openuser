import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mcpConfigPath,
  mergeMcpConfig,
  writeMcpConfig,
  type Agent,
} from '../src/lib/mcp-config.js';

describe('mcpConfigPath', () => {
  const cwd = '/proj';
  it.each([
    ['claude', '/proj/.mcp.json'],
    ['codex', '/proj/.codex/config.json'],
    ['opencode', '/proj/.opencode/config.json'],
    ['cursor', '/proj/.cursor/mcp.json'],
  ] as Array<[Agent, string]>)('%s → %s', (agent, expected) => {
    expect(mcpConfigPath(agent, cwd)).toBe(expected);
  });
});

describe('mergeMcpConfig', () => {
  it('adds both servers under mcpServers for claude (empty start)', () => {
    const out = mergeMcpConfig('claude', {});
    expect(out).toEqual({
      mcpServers: {
        'openuser-manager': { command: 'openuser', args: ['mcp', '--role', 'manager'] },
        'openuser-tester': { command: 'openuser', args: ['mcp', '--role', 'tester'] },
      },
    });
  });

  it('uses the nested mcp.servers shape with type:stdio for opencode', () => {
    const out = mergeMcpConfig('opencode', {}) as {
      mcp: { servers: Record<string, unknown> };
    };
    expect(out.mcp.servers['openuser-manager']).toEqual({
      type: 'stdio',
      command: 'openuser',
      args: ['mcp', '--role', 'manager'],
    });
  });

  it('preserves unrelated top-level keys and other servers', () => {
    const existing = {
      someOtherKey: { keep: true },
      mcpServers: { 'my-server': { command: 'foo', args: [] } },
    };
    const out = mergeMcpConfig('claude', existing) as {
      someOtherKey: unknown;
      mcpServers: Record<string, unknown>;
    };
    expect(out.someOtherKey).toEqual({ keep: true });
    expect(out.mcpServers['my-server']).toEqual({ command: 'foo', args: [] });
    expect(out.mcpServers['openuser-manager']).toBeDefined();
    expect(out.mcpServers['openuser-tester']).toBeDefined();
  });

  it('is idempotent — re-merging yields the same result', () => {
    const once = mergeMcpConfig('cursor', {});
    const twice = mergeMcpConfig('cursor', once);
    expect(twice).toEqual(once);
  });

  it('does not mutate the input object', () => {
    const existing = { mcpServers: { a: { command: 'x', args: [] } } };
    const snapshot = JSON.stringify(existing);
    mergeMcpConfig('claude', existing);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });
});

describe('writeMcpConfig', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openuser-mcp-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .mcp.json for claude when none exists (merged=false)', () => {
    const res = writeMcpConfig('claude', tmpDir);
    expect(res.merged).toBe(false);
    expect(res.path).toBe(join(tmpDir, '.mcp.json'));
    const cfg = JSON.parse(readFileSync(res.path, 'utf8'));
    expect(cfg.mcpServers['openuser-manager']).toBeDefined();
    expect(cfg.mcpServers['openuser-tester']).toBeDefined();
  });

  it('creates nested parent dirs for cursor', () => {
    const res = writeMcpConfig('cursor', tmpDir);
    expect(existsSync(join(tmpDir, '.cursor', 'mcp.json'))).toBe(true);
    expect(res.path).toBe(join(tmpDir, '.cursor', 'mcp.json'));
  });

  it('merges into an existing file and reports merged=true', () => {
    const path = join(tmpDir, '.mcp.json');
    writeFileSync(
      path,
      JSON.stringify({ mcpServers: { existing: { command: 'keep', args: [] } } }),
      'utf8',
    );
    const res = writeMcpConfig('claude', tmpDir);
    expect(res.merged).toBe(true);
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.mcpServers.existing).toEqual({ command: 'keep', args: [] });
    expect(cfg.mcpServers['openuser-manager']).toBeDefined();
  });

  it('recovers from a corrupt existing file by starting fresh', () => {
    const path = join(tmpDir, '.opencode', 'config.json');
    mkdirSync(join(tmpDir, '.opencode'), { recursive: true });
    writeFileSync(path, '{ not valid json', 'utf8');
    const res = writeMcpConfig('opencode', tmpDir);
    expect(res.merged).toBe(true); // file existed
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    expect(cfg.mcp.servers['openuser-tester']).toBeDefined();
  });

  it('writes trailing newline', () => {
    const res = writeMcpConfig('claude', tmpDir);
    expect(readFileSync(res.path, 'utf8').endsWith('\n')).toBe(true);
  });
});
