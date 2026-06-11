import { describe, it, expect } from 'vitest';
import { DEFAULT_PORT, newId, newRunToken, hashToken } from './helpers.js';

describe('DEFAULT_PORT', () => {
  it('is 8737', () => {
    expect(DEFAULT_PORT).toBe(8737);
  });
});

describe('newId', () => {
  it('returns a string with the given prefix', () => {
    const id = newId('prj_');
    expect(id).toMatch(/^prj_[A-Za-z0-9_-]{12}$/);
  });

  it('returns unique IDs on successive calls', () => {
    const ids = Array.from({ length: 100 }, () => newId('run_'));
    const unique = new Set(ids);
    expect(unique.size).toBe(100);
  });

  it('handles all documented prefixes', () => {
    const prefixes = ['prj_', 'per_', 'chk_', 'tst_', 'run_', 'stp_', 'fnd_', 'evt_'];
    for (const prefix of prefixes) {
      const id = newId(prefix);
      expect(id.startsWith(prefix)).toBe(true);
      expect(id.slice(prefix.length)).toHaveLength(12);
    }
  });
});

describe('newRunToken', () => {
  it('returns a string starting with rt_', () => {
    const token = newRunToken();
    expect(token).toMatch(/^rt_[A-Za-z0-9_-]{24}$/);
  });

  it('returns unique tokens on successive calls', () => {
    const tokens = Array.from({ length: 100 }, () => newRunToken());
    const unique = new Set(tokens);
    expect(unique.size).toBe(100);
  });
});

describe('hashToken', () => {
  it('returns a 64-char hex string (sha256)', () => {
    const hash = hashToken('rt_abc123');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic — same input yields same hash', () => {
    const token = 'rt_determinism_test_value';
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it('different tokens produce different hashes', () => {
    const t1 = newRunToken();
    const t2 = newRunToken();
    expect(hashToken(t1)).not.toBe(hashToken(t2));
  });

  it('hashes a real run token', () => {
    const token = newRunToken();
    const hash = hashToken(token);
    expect(hash).toHaveLength(64);
  });
});
