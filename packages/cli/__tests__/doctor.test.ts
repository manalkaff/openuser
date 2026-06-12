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
});
