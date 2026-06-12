import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const OPENUSER_HOME = process.env['OPENUSER_HOME'] ?? join(homedir(), '.openuser');
const DAEMON_JSON = join(OPENUSER_HOME, 'daemon.json');

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
