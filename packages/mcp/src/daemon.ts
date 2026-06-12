import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OPENUSER_HOME = process.env['OPENUSER_HOME'] ?? join(homedir(), '.openuser');
const DAEMON_JSON = join(OPENUSER_HOME, 'daemon.json');
const DEFAULT_PORT = 8737;
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 500;

interface DaemonInfo {
  port: number;
  pid: number;
  version: string;
  startedAt: string;
}

/**
 * Read the daemon's recorded port from daemon.json.
 * Returns null on ANY failure — a missing file (expected on first run, ENOENT)
 * and a corrupt/partial file are both treated as "no usable port", so the
 * caller falls back to DEFAULT_PORT and re-verifies via a health check.
 * The `typeof port === 'number'` guard prevents trusting a malformed record
 * (e.g. an interrupted write) and accidentally targeting the wrong port.
 */
async function readDaemonJson(): Promise<DaemonInfo | null> {
  try {
    const raw = await readFile(DAEMON_JSON, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DaemonInfo>;
    if (typeof parsed.port !== 'number') return null;
    return parsed as DaemonInfo;
  } catch {
    return null;
  }
}

async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnDaemon(): void {
  const cliEntry = process.env['OPENUSER_CLI_ENTRY'];
  if (!cliEntry) {
    throw new Error(
      'OpenUser daemon is not running and OPENUSER_CLI_ENTRY is not set.\n' +
        'Please start the daemon manually by running:\n\n' +
        '  npx openuser start\n\n' +
        'Then retry your agent command.',
    );
  }
  const child = spawn(process.execPath, [cliEntry, 'start', '--detach', '--no-open'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function pollHealth(baseUrl: string): Promise<boolean> {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    if (await checkHealth(baseUrl)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

/**
 * Discover the daemon base URL. If the daemon is not reachable:
 * 1. Spawn it detached via OPENUSER_CLI_ENTRY.
 * 2. Poll health 10x500ms.
 * 3. If still down, throw an instructive error.
 */
export async function resolveDaemonBaseUrl(): Promise<string> {
  // First try to read daemon.json for the actual port
  const info = await readDaemonJson();
  const port = info?.port ?? DEFAULT_PORT;
  const baseUrl = `http://127.0.0.1:${port}`;

  if (await checkHealth(baseUrl)) {
    return baseUrl;
  }

  // Daemon not reachable — spawn it. Throws the instructive "OPENUSER_CLI_ENTRY
  // not set" error if we can't, which propagates to the caller unchanged.
  // (If two MCP processes race here they may both spawn; the daemon's own
  // port-busy handling keeps that benign — the loser is an idle orphan.)
  spawnDaemon();

  // Poll until daemon comes up
  const up = await pollHealth(baseUrl);
  if (!up) {
    throw new Error(
      `OpenUser daemon did not start within ${(POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s.\n` +
        'Check for errors by running:\n\n' +
        '  npx openuser start\n\n' +
        'Then retry.',
    );
  }

  return baseUrl;
}
