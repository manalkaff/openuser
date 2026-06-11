import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { checkpoints, runs } from '../db/schema.js';
import type { WsHub } from '../ws/hub.js';
import type { ActiveSessions } from '../routes/tester/auth.js';
import { RunLifecycleService } from './run-lifecycle.service.js';

export class WatchdogService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly db: DB,
    private readonly homeDir: string,
    private readonly wsHub: WsHub,
    private readonly activeSessions: ActiveSessions,
    private readonly getWatchdogMinutes: () => number,
  ) {}

  private lifecycle(): RunLifecycleService {
    return new RunLifecycleService(this.db, this.wsHub);
  }

  /** Start (or restart) the watchdog for a run */
  start(runId: string): void {
    this.cancel(runId);
    const minutes = this.getWatchdogMinutes();
    const ms = minutes * 60 * 1000;
    const timer = setTimeout(() => {
      void this.fire(runId);
    }, ms);
    // Allow Node to exit even if watchdog is pending
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(runId, timer);
  }

  /** Reset the timer (called on every tester tool call) */
  reset(runId: string): void {
    this.start(runId);
  }

  /** Cancel the watchdog for a run (called on normal complete) */
  cancel(runId: string): void {
    const timer = this.timers.get(runId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(runId);
    }
  }

  private async fire(runId: string): Promise<void> {
    this.timers.delete(runId);

    const run = this.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run || run.status !== 'running') return;

    // Close session and get video
    const session = this.activeSessions.get(runId);
    let videoPath: string | undefined;
    if (session) {
      try {
        const result = await session.close();
        videoPath = result.videoPath;
      } catch {
        // best-effort
      }
      this.activeSessions.delete(runId);
    }

    // Save auto journey checkpoint
    const checkpointId = `chk_${nanoid(12)}`;
    const checkpointDir = join(this.homeDir, 'checkpoints', checkpointId);
    mkdirSync(checkpointDir, { recursive: true });

    const storageStatePath = join(checkpointDir, 'storageState.json');
    writeFileSync(storageStatePath, JSON.stringify({ cookies: [], origins: [] }, null, 2));

    const journey = {
      notes: `Auto-saved by watchdog after ${this.getWatchdogMinutes()} minutes of inactivity`,
      savedAtStep: 0,
      url: run.baseUrlResolved,
    };
    writeFileSync(join(checkpointDir, 'journey.json'), JSON.stringify(journey, null, 2));

    this.db.insert(checkpoints).values({
      id: checkpointId,
      projectId: run.projectId,
      personaId: run.personaId,
      name: `Auto-checkpoint (watchdog) — run ${runId}`,
      description: `Automatically saved when run was aborted by watchdog after ${this.getWatchdogMinutes()} minutes of inactivity`,
      storageStatePath,
      journey,
      createdFromRunId: runId,
      createdAt: new Date(),
    }).run();

    // Abort the run
    this.lifecycle().abort(runId, videoPath);
  }
}
