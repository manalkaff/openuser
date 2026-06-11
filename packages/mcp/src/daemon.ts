import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OPENUSER_HOME = process.env['OPENUSER_HOME'] ?? join(homedir(), '.openuser');
const DAEMON_JSON = join(OPENUSER_HOME, 'daemon.json');
const POLL_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 500;

interface DaemonInfo {
  port: number;
  pid: number;
  version: string;
  startedAt: string;
}

async function readDaemonJson(): Promise<DaemonInfo | null> {
  try {
    const raw = await readFile(DAEMON_JSON, 'utf8');
    return JSON.parse(raw) as DaemonInfo;
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
  const port = info?.port ?? 8737;
  const baseUrl = `http://127.0.0.1:${port}`;

  if (await checkHealth(baseUrl)) {
    return baseUrl;
  }

  // Daemon not reachable — spawn it
  try {
    spawnDaemon();
  } catch (err) {
    // OPENUSER_CLI_ENTRY not set — throw the instructive error
    throw err;
  }

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
