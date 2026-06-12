import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('doctor checks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('checkNodeVersion', () => {
    it('passes when node major >= 20', async () => {
      const { checkNodeVersion } = await import('../src/commands/doctor.js');
      vi.spyOn(process, 'version', 'get').mockReturnValue('v20.0.0');
      expect(checkNodeVersion().pass).toBe(true);
    });
    it('fails when node major < 20', async () => {
      const { checkNodeVersion } = await import('../src/commands/doctor.js');
      vi.spyOn(process, 'version', 'get').mockReturnValue('v18.17.0');
      const result = checkNodeVersion();
      expect(result.pass).toBe(false);
      expect(result.message).toMatch(/18/);
    });
  });

  describe('checkDataDirWritable', () => {
    it('passes when data dir is writable', async () => {
      const { checkDataDirWritable } = await import('../src/commands/doctor.js');
      expect((await checkDataDirWritable()).pass).toBe(true);
    });
  });

  describe('checkPortFree', () => {
    it('returns a result object with pass bool', async () => {
      const { checkPortFree } = await import('../src/commands/doctor.js');
      const result = await checkPortFree(19999);
      expect(typeof result.pass).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });
  });

  describe('checkChromium', () => {
    it('returns a result object with pass bool and message', async () => {
      const { checkChromium } = await import('../src/commands/doctor.js');
      const result = await checkChromium();
      expect(typeof result.pass).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });
  });

  describe('checkDaemonHealth', () => {
    it('passes (informational) when no daemon.json is present', async () => {
      // resetModules so the dynamic import re-evaluates doctor.js against this
      // mock (ESM modules are cached; a stale binding would leak across tests).
      vi.resetModules();
      vi.doMock('../src/lib/daemon.js', () => ({
        readDaemonJson: vi.fn().mockReturnValue(null),
        isDaemonHealthy: vi.fn(),
      }));
      const { checkDaemonHealth } = await import('../src/commands/doctor.js');
      const result = await checkDaemonHealth();
      expect(result.pass).toBe(true);
      expect(result.message).toMatch(/not running/i);
      vi.doUnmock('../src/lib/daemon.js');
    });

    it('passes and reports running when daemon.json exists and is healthy', async () => {
      vi.resetModules();
      vi.doMock('../src/lib/daemon.js', () => ({
        readDaemonJson: vi
          .fn()
          .mockReturnValue({ port: 8737, pid: 42, version: '0.1.0', startedAt: '' }),
        isDaemonHealthy: vi.fn().mockResolvedValue(true),
      }));
      const { checkDaemonHealth } = await import('../src/commands/doctor.js');
      const result = await checkDaemonHealth();
      expect(result.pass).toBe(true);
      expect(result.message).toMatch(/8737/);
      vi.doUnmock('../src/lib/daemon.js');
    });
  });
});
