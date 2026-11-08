import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const OPENUSER_HOME = process.env['OPENUSER_HOME'] ?? join(homedir(), '.openuser');
const DAEMON_JSON = join(OPENUSER_HOME, 'daemon.json');
const DAEMON_TOKEN = join(OPENUSER_HOME, 'daemon.token');

export interface DaemonJson {
  port: number;
  pid: number;
  version: string;
  startedAt: string;
}

/** Read ~/.openuser/daemon.json; returns null if missing or unparseable. */
export function readDaemonJson(): DaemonJson | null {
  try {
    const raw = readFileSync(DAEMON_JSON, 'utf8');
    return JSON.parse(raw) as DaemonJson;
  } catch {
    return null;
  }
}

/**
 * Read the manager token from ~/.openuser/daemon.token (mode 0600, readable only by the daemon's
 * OS user). Throws an error that names the path when it is missing or unreadable.
 */
export function readDaemonToken(file: string = DAEMON_TOKEN): string {
  let token: string;
  try {
    token = readFileSync(file, 'utf8').trim();
  } catch (err) {
    throw new Error(
      `Cannot read the OpenUser daemon token at ${file}: ${err instanceof Error ? err.message : String(err)}.\n` +
        'Run this command as the same OS user as the daemon, or restart it with `openuser start`.',
    );
  }
  if (!token) throw new Error(`The OpenUser daemon token at ${file} is empty; restart it with \`openuser start\`.`);
  return token;
}

/** Headers for a manager API call: JSON plus the daemon token. */
export function managerHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${readDaemonToken()}` };
}

/**
 * Ask the daemon for a one-time dashboard login link. The link carries a single-use code that
 * expires in 5 minutes, never the daemon token, so it is safe to print.
 */
export async function createLoginUrl(port: number, host = '127.0.0.1'): Promise<string> {
  // A wildcard bind is reachable on loopback; any other bind only on its own address.
  const reach = host === '0.0.0.0' || host === '::' || host === '' ? '127.0.0.1' : host;
  const base = (h: string) => `http://${h.includes(':') ? `[${h}]` : h}:${port}`;
  const res = await fetch(`${base(reach)}/api/auth/login-code`, { method: 'POST', headers: managerHeaders() });
  if (!res.ok) throw new Error(`Failed to create a dashboard login link: HTTP ${res.status}`);
  const { code } = (await res.json()) as { code: string };
  const shown = reach === '127.0.0.1' && host !== '127.0.0.1' ? 'localhost' : reach;
  return `${base(shown)}/auth/login?code=${encodeURIComponent(code)}`;
}

/** GET /api/health on the given port; returns true if { ok: true } */
export async function isDaemonHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/** Return the running daemon port if healthy, or null. */
export async function getHealthyDaemonPort(): Promise<number | null> {
  const info = readDaemonJson();
  if (!info) return null;
  const ok = await isDaemonHealthy(info.port);
  return ok ? info.port : null;
}

/**
 * Ensure the daemon is running. Re-spawns `openuser start --no-open --detach`
 * via OPENUSER_CLI_ENTRY (or process.argv[1]). Polls up to 10 × 500 ms.
 */
export async function ensureDaemonRunning(): Promise<number> {
  const existing = await getHealthyDaemonPort();
  if (existing) return existing;

  const entry = process.env['OPENUSER_CLI_ENTRY'] ?? process.argv[1];
  if (!entry) {
    throw new Error('Cannot locate OpenUser CLI entry to spawn the daemon.');
  }
  const child = spawn(process.execPath, [entry, 'start', '--no-open', '--detach'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();
  // A spawn failure (ENOENT for a bad entry path, EACCES, etc.) emits an
  // asynchronous 'error' event. Without a listener that becomes an unhandled
  // EventEmitter error and crashes this process. Swallow it: the poll loop
  // below times out cleanly and surfaces an actionable message instead.
  child.on('error', () => {});

  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const port = await getHealthyDaemonPort();
    if (port) return port;
  }

  throw new Error(
    'OpenUser daemon did not start within 5 seconds.\n' +
      'Run `openuser start` manually to see startup errors.',
  );
}
