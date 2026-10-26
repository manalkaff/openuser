import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GuardsService,
  DeniedHostError,
  RunLockedError,
  matchDenyHost,
  urlsInText,
  tenantFor,
} from './guards.service.js';
import { SETTINGS_DEFAULTS, type SettingsShape } from './settings.service.js';

function guardsWith(overrides: Partial<SettingsShape>): GuardsService {
  const s = { ...SETTINGS_DEFAULTS, ...overrides };
  return new GuardsService({ get: (k: keyof SettingsShape) => s[k] } as never);
}

describe('matchDenyHost', () => {
  it('matches the domain and its subdomains only', () => {
    expect(matchDenyHost('23bisnis.com', ['23bisnis.com'])).toBe('23bisnis.com');
    expect(matchDenyHost('App.23bisnis.com', ['23bisnis.com'])).toBe('23bisnis.com');
    expect(matchDenyHost('not23bisnis.com', ['23bisnis.com'])).toBeNull();
    expect(matchDenyHost('23bisnis.com.evil.io', ['23bisnis.com'])).toBeNull();
    expect(matchDenyHost('localhost', ['23bisnis.com'])).toBeNull();
  });
});

describe('urlsInText', () => {
  it('finds http(s) URLs in free text', () => {
    expect(urlsInText('Sign in at https://login.23bisnis.com/x, then go on.')).toEqual(['https://login.23bisnis.com/x,']);
    expect(urlsInText('no links')).toEqual([]);
  });
});

describe('GuardsService.assertTargetAllowed', () => {
  it('throws DeniedHostError for a denied URL and passes others', () => {
    const g = guardsWith({});
    expect(() => g.assertTargetAllowed(['http://localhost:3000'])).not.toThrow();
    expect(() => g.assertTargetAllowed(['https://shop.23bisnis.com/'])).toThrow(DeniedHostError);
  });
});

describe('GuardsService lock', () => {
  it('is a no-op without a lock file', () => {
    const g = guardsWith({});
    expect(() => {
      g.acquireLock('run_a');
      g.acquireLock('run_b');
    }).not.toThrow();
  });

  it('refuses a second holder until released', async () => {
    const lockFile = join(mkdtempSync(join(tmpdir(), 'lock-')), 'x.lock');
    const g = guardsWith({ lockFile });
    g.acquireLock('run_a');
    expect(existsSync(lockFile)).toBe(true);
    expect(() => g.acquireLock('run_b')).toThrow(RunLockedError);
    await g.release('run_a');
    expect(existsSync(lockFile)).toBe(false);
    expect(() => g.acquireLock('run_b')).not.toThrow();
  });

  it('treats a lock file of a dead process as stale but an unparseable one as held', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lock-'));
    const stale = join(dir, 'stale.lock');
    writeFileSync(stale, '2147483646 run_old\n');
    expect(() => guardsWith({ lockFile: stale }).acquireLock('run_new')).not.toThrow();

    const foreign = join(dir, 'foreign.lock');
    writeFileSync(foreign, 'held by the sweep script\n');
    expect(() => guardsWith({ lockFile: foreign }).acquireLock('run_new')).toThrow(RunLockedError);
  });
});

describe('GuardsService seed and teardown', () => {
  it('runs seed then teardown for run-<id>, and teardown only after a seed', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'seed-')), 'log');
    const g = guardsWith({ seedCommand: `echo "seed {tenant}" >> ${log}`, teardownCommand: `echo "del {tenant}" >> ${log}` });
    await g.release('run_never_seeded');
    expect(existsSync(log)).toBe(false);
    await g.seed('run_1');
    await g.release('run_1');
    await g.release('run_1'); // idempotent
    expect(readFileSync(log, 'utf8')).toBe(`seed ${tenantFor('run_1')}\ndel ${tenantFor('run_1')}\n`);
  });

  it('rejects when the seed command fails and still tears down', async () => {
    const log = join(mkdtempSync(join(tmpdir(), 'seed-')), 'log');
    const g = guardsWith({ seedCommand: 'exit 3', teardownCommand: `echo "del {tenant}" >> ${log}` });
    await expect(g.seed('run_2')).rejects.toThrow();
    await g.release('run_2');
    expect(readFileSync(log, 'utf8')).toBe('del run-run_2\n');
  });
});
