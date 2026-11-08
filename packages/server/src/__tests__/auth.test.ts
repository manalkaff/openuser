// BISNIS-131 AC4: manager token, 0700 home and one-time dashboard login codes.
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DAEMON_TOKEN_FILE,
  LOGIN_CODE_TTL_MS,
  ManagerAuth,
  isPublicRoute,
  secureHomeDir,
  tokensEqual,
  writeDaemonToken,
} from '../auth.js';

const posix = process.platform !== 'win32';
const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'openuser-auth-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('secureHomeDir', () => {
  it.runIf(posix)('tightens an existing 0755 home to 0700', () => {
    const home = tempDir();
    chmodSync(home, 0o755);
    secureHomeDir(home);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });

  it.runIf(posix)('creates a missing home as 0700', () => {
    const home = join(tempDir(), 'nested', '.openuser');
    secureHomeDir(home);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });
});

describe('writeDaemonToken', () => {
  it.runIf(posix)('writes a 0600 token file and leaves no temp file behind', () => {
    const home = tempDir();
    const token = writeDaemonToken(home);
    const file = join(home, DAEMON_TOKEN_FILE);
    expect(readFileSync(file, 'utf8')).toBe(token);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(home)).toEqual([DAEMON_TOKEN_FILE]);
  });

  it('gives a different 32-byte token on every call', () => {
    const home = tempDir();
    const a = writeDaemonToken(home);
    const b = writeDaemonToken(home);
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(existsSync(join(home, DAEMON_TOKEN_FILE))).toBe(true);
  });
});

describe('tokensEqual', () => {
  it('matches only the same token, and does not throw on a length mismatch', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true);
    expect(tokensEqual('abd', 'abc')).toBe(false);
    expect(tokensEqual('a', 'abc')).toBe(false);
    expect(tokensEqual('', 'abc')).toBe(false);
  });
});

describe('isPublicRoute', () => {
  it.each([
    ['GET', '/api/health', true],
    ['GET', '/auth/login', true],
    ['POST', '/api/tester/begin', true],
    ['POST', '/api/health', false],
    ['GET', '/api/version', false],
    ['POST', '/api/auth/login-code', false],
    ['POST', '/api/runs', false],
    ['GET', '/ws', false],
    ['GET', '/artifacts/run_x/a.png', false],
    ['GET', '/', false],
    ['GET', '/api/testers', false],
  ])('%s %s -> %s', (method, path, expected) => {
    expect(isPublicRoute(method, path)).toBe(expected);
  });
});

describe('ManagerAuth', () => {
  it('accepts the bearer token and refuses a wrong or missing one', () => {
    const auth = new ManagerAuth({ token: 'tok_right' });
    expect(auth.isAuthorized('Bearer tok_right', undefined)).toBe(true);
    expect(auth.isAuthorized('Bearer tok_wrong', undefined)).toBe(false);
    expect(auth.isAuthorized('tok_right', undefined)).toBe(false);
    expect(auth.isAuthorized(undefined, undefined)).toBe(false);
    expect(auth.isAuthorized(undefined, 'unknown-session')).toBe(false);
  });

  it('a login code works once, never twice', () => {
    const auth = new ManagerAuth({ token: 't' });
    const { code } = auth.createLoginCode();
    expect(auth.redeemLoginCode(code)).toBe(true);
    expect(auth.redeemLoginCode(code)).toBe(false);
    expect(auth.redeemLoginCode('never-issued')).toBe(false);
  });

  it('a login code expires after 5 minutes', () => {
    let now = 1_000_000;
    const auth = new ManagerAuth({ token: 't', now: () => now });
    const fresh = auth.createLoginCode();
    expect(fresh.expiresAt).toBe(1_000_000 + 300_000);
    expect(LOGIN_CODE_TTL_MS).toBe(300_000);
    const stale = auth.createLoginCode();
    now += 300_000;
    expect(auth.redeemLoginCode(fresh.code)).toBe(true);
    now += 1;
    expect(auth.redeemLoginCode(stale.code)).toBe(false);
  });

  it('a login code never contains the token', () => {
    const auth = new ManagerAuth({ token: 'tok_secret_value' });
    expect(auth.createLoginCode().code).not.toContain('tok_secret_value');
  });
});
