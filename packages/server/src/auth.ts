import { chmodSync, closeSync, fstatSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

/** The file under the home directory that holds the manager token. Clients read it as the same OS user. */
export const DAEMON_TOKEN_FILE = 'daemon.token';
export const SESSION_COOKIE = 'openuser_session';
/** How long a dashboard login code stays valid. */
export const LOGIN_CODE_TTL_MS = 5 * 60_000;

const IS_WINDOWS = process.platform === 'win32';

/** Bits a group or other user could use. Any of them set means another OS user can reach the file. */
function openToOthers(mode: number): boolean {
  return (mode & 0o077) !== 0;
}

/**
 * Create the home directory, or tighten one left at 0755 by OpenUser 0.1.x, to 0700. It holds the
 * DB, artifacts, checkpoints and the token, so no other OS user may read it. Throws when the mode
 * stays wider. Windows has no POSIX modes; the check is skipped there.
 */
export function secureHomeDir(homeDir: string): void {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  if (IS_WINDOWS) return;
  chmodSync(homeDir, 0o700);
  const mode = statSync(homeDir).mode;
  if (openToOthers(mode)) {
    throw new Error(
      `${homeDir} is mode ${(mode & 0o777).toString(8)} and could not be set to 700; refusing to start.`,
    );
  }
}

/**
 * Write a fresh manager token to `<home>/daemon.token` (mode 0600) and return it. The token goes to
 * a temp file created with `wx`, is checked with `fstat`, then renamed into place, so a reader never
 * sees a partial or loosely-permissioned token. Call it before `daemon.json` is written.
 */
export function writeDaemonToken(homeDir: string): string {
  const token = randomBytes(32).toString('base64url');
  const tmp = join(homeDir, `${DAEMON_TOKEN_FILE}.${process.pid}.tmp`);
  rmSync(tmp, { force: true });
  const fd = openSync(tmp, 'wx', 0o600);
  try {
    writeSync(fd, token);
    if (!IS_WINDOWS && openToOthers(fstatSync(fd).mode)) {
      throw new Error(`${tmp} was not created with mode 600; refusing to start.`);
    }
  } catch (err) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw err;
  }
  closeSync(fd);
  renameSync(tmp, join(homeDir, DAEMON_TOKEN_FILE));
  return token;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time comparison. Both sides are hashed first, so a length difference cannot throw or leak. */
export function tokensEqual(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Routes that need no manager token. Everything else, including `/ws`, `/artifacts/*` and the
 * dashboard itself, is refused without one, so a route added later is protected by default.
 * - `/api/health`: liveness only, it returns `{ ok: true }` and nothing else.
 * - `/auth/login`: exchanges a one-time code for a session cookie.
 * - `/api/tester/*`: each request carries its run's own Bearer token, checked by the tester routes.
 */
export function isPublicRoute(method: string, path: string): boolean {
  if (method === 'GET' && path === '/api/health') return true;
  if (method === 'GET' && path === '/auth/login') return true;
  return path.startsWith('/api/tester/');
}

export interface ManagerAuthOptions {
  token: string;
  now?: () => number;
}

/**
 * Manager API authentication: the daemon token as `Authorization: Bearer`, or a dashboard session
 * cookie obtained through a one-time login code. Codes and sessions live in memory, so restarting
 * the daemon ends every session.
 */
export class ManagerAuth {
  private readonly token: string;
  private readonly now: () => number;
  private readonly codes = new Map<string, number>();
  private readonly sessions = new Set<string>();

  constructor(opts: ManagerAuthOptions) {
    this.token = opts.token;
    this.now = opts.now ?? (() => Date.now());
  }

  /** A single-use code that `GET /auth/login?code=` exchanges for a session. It never carries the token. */
  createLoginCode(): { code: string; expiresAt: number } {
    const code = randomBytes(24).toString('base64url');
    const expiresAt = this.now() + LOGIN_CODE_TTL_MS;
    this.codes.set(code, expiresAt);
    return { code, expiresAt };
  }

  /** Spend a login code: true once for a known, unexpired code; the code is gone afterwards either way. */
  redeemLoginCode(code: string): boolean {
    const expiresAt = this.codes.get(code);
    if (expiresAt === undefined) return false;
    this.codes.delete(code);
    return this.now() <= expiresAt;
  }

  private bearer(header: string | undefined): string | null {
    if (!header) return null;
    const m = /^Bearer (.+)$/.exec(header);
    return m?.[1] ?? null;
  }

  isAuthorized(authorization: string | undefined, sessionId: string | undefined): boolean {
    const given = this.bearer(authorization);
    if (given !== null && tokensEqual(given, this.token)) return true;
    return sessionId !== undefined && this.sessions.has(sessionId);
  }

  /** Default-deny middleware. Mount it with `app.use('*')` after the Host/Origin allowlist. */
  middleware(): MiddlewareHandler {
    return async (c, next) => {
      if (isPublicRoute(c.req.method, c.req.path)) return next();
      if (this.isAuthorized(c.req.header('Authorization'), getCookie(c, SESSION_COOKIE))) return next();
      return c.json(
        { error: 'Unauthorized: send the token from daemon.token, or open the login link that `openuser start` prints.' },
        401,
      );
    };
  }

  /** `POST /api/auth/login-code` (manager token required) and `GET /auth/login?code=`. */
  routes(): Hono {
    const app = new Hono();
    app.post('/api/auth/login-code', (c) => c.json(this.createLoginCode(), 201));
    app.get('/auth/login', (c) => {
      const code = c.req.query('code');
      if (!code || !this.redeemLoginCode(code)) {
        return c.text('This login link is invalid, used or expired. Run `openuser start` for a new one.', 401);
      }
      const sessionId = randomBytes(32).toString('base64url');
      this.sessions.add(sessionId);
      setCookie(c, SESSION_COOKIE, sessionId, { httpOnly: true, sameSite: 'Strict', path: '/' });
      return c.redirect('/', 302);
    });
    return app;
  }
}
