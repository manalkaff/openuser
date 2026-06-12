import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('path helpers', () => {
  // NOTE: Assertions use suffix-only regexes. Under vitest (source layout),
  // import.meta.url of paths.ts points to src/lib/, not dist/. The trailing
  // segment is the contractually stable part; the full prefix differs between
  // source-run (test) and bundled-run (production).
  it('bundledUiDir ends with /ui', async () => {
    const { bundledUiDir } = await import('../src/lib/paths.js');
    expect(bundledUiDir()).toMatch(/[/\\]ui$/);
  });
  it('bundledMigrationsDir ends with /migrations', async () => {
    const { bundledMigrationsDir } = await import('../src/lib/paths.js');
    expect(bundledMigrationsDir()).toMatch(/[/\\]migrations$/);
  });
  it('bundledSkillsDir ends with /skills', async () => {
    const { bundledSkillsDir } = await import('../src/lib/paths.js');
    expect(bundledSkillsDir()).toMatch(/[/\\]skills$/);
  });
});

describe('isDaemonHealthy', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { isDaemonHealthy } = await import('../src/lib/daemon.js');
    expect(await isDaemonHealthy(8737)).toBe(false);
  });
  it('returns false when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { isDaemonHealthy } = await import('../src/lib/daemon.js');
    expect(await isDaemonHealthy(8737)).toBe(false);
  });
  it('returns true when health endpoint responds ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, version: '0.1.0' }),
      }),
    );
    const { isDaemonHealthy } = await import('../src/lib/daemon.js');
    expect(await isDaemonHealthy(8737)).toBe(true);
  });
});
