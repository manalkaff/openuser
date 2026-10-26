import { execFile } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import type { SettingsService } from './settings.service.js';

export class DeniedHostError extends Error {
  constructor(public readonly host: string, public readonly rule: string) {
    super(`Refusing to run against ${host}: it matches the production deny list entry "${rule}"`);
    this.name = 'DeniedHostError';
  }
}

export class RunLockedError extends Error {
  constructor(public readonly lockFile: string) {
    super(`Another run holds the lock file ${lockFile}`);
    this.name = 'RunLockedError';
  }
}

/** The deny-list entry that matches `host` (the domain itself or any subdomain), or null. */
export function matchDenyHost(host: string, denyHosts: string[]): string | null {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  for (const raw of denyHosts) {
    const d = raw.trim().toLowerCase().replace(/^\*?\./, '');
    if (d && (h === d || h.endsWith(`.${d}`))) return raw;
  }
  return null;
}

/** Every http(s) URL found in `text`. */
export function urlsInText(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s"'<>)]+/gi)].map((m) => m[0]);
}

export function tenantFor(runId: string): string {
  return `run-${runId}`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function runShell(command: string, tenant: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'sh',
      ['-c', command.split('{tenant}').join(tenant)],
      { timeout: 120_000, env: { ...process.env, OPENUSER_TENANT: tenant } },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(`${err.message}${stderr ? `: ${stderr.trim()}` : ''}`));
        else resolve();
      },
    );
  });
}

/** Production deny list, per-run tenant seed/teardown, and the single-run lock file. */
export class GuardsService {
  private readonly seeded = new Set<string>();
  private readonly locked = new Map<string, string>(); // runId -> lock file path

  constructor(private readonly settings: Pick<SettingsService, 'get'>) {}

  assertTargetAllowed(urls: string[]): void {
    const deny = this.settings.get('denyHosts');
    for (const url of urls) {
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        continue;
      }
      const rule = matchDenyHost(host, deny);
      if (rule) throw new DeniedHostError(host, rule);
    }
  }

  /** Take the lock file for a run. No-op when no lockFile is configured. */
  acquireLock(runId: string): void {
    const file = this.settings.get('lockFile');
    if (!file) return;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(file, 'wx');
        writeSync(fd, `${process.pid} ${runId}\n`);
        closeSync(fd);
        this.locked.set(runId, file);
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        // A lock left by a dead daemon is stale; anything we cannot parse is treated as held.
        let holder: number;
        try {
          holder = parseInt(readFileSync(file, 'utf8').split(/\s+/)[0] ?? '', 10);
        } catch {
          continue; // vanished between open and read: retry
        }
        if (Number.isNaN(holder) || isAlive(holder)) throw new RunLockedError(file);
        try {
          unlinkSync(file);
        } catch {
          // someone else removed it; retry
        }
      }
    }
    throw new RunLockedError(file);
  }

  /** Run the configured seed command for the run's tenant. No-op when none is configured. */
  async seed(runId: string): Promise<void> {
    const cmd = this.settings.get('seedCommand');
    if (!cmd) return;
    this.seeded.add(runId); // mark first so a half-finished seed is still torn down
    await runShell(cmd, tenantFor(runId));
  }

  /** Delete the run's tenant and free the lock. Safe to call more than once. Never throws. */
  async release(runId: string): Promise<void> {
    if (this.seeded.delete(runId)) {
      const cmd = this.settings.get('teardownCommand');
      if (cmd) {
        try {
          await runShell(cmd, tenantFor(runId));
        } catch (err) {
          console.error(`[openuser] teardown for ${tenantFor(runId)} failed:`, err instanceof Error ? err.message : err);
        }
      }
    }
    const file = this.locked.get(runId);
    if (file) {
      this.locked.delete(runId);
      try {
        unlinkSync(file);
      } catch {
        // already gone
      }
    }
  }
}
