import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { eq, desc } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { logEvents } from '../db/schema.js';
import type { ConsoleEvent, NetworkEvent } from '../runner/types.js';
import type { WsHub } from '../ws/hub.js';

export class LogPipelineService {
  private currentStepIdx: Map<string, number> = new Map();

  constructor(
    private readonly db: DB,
    private readonly homeDir: string,
    private readonly wsHub: WsHub,
  ) {}

  setCurrentStep(runId: string, idx: number): void {
    this.currentStepIdx.set(runId, idx);
  }

  private artifactsDir(runId: string): string {
    return join(this.homeDir, 'artifacts', runId);
  }

  handleConsole(runId: string, event: ConsoleEvent): void {
    const dir = this.artifactsDir(runId);
    mkdirSync(dir, { recursive: true });
    // Always append to console.jsonl
    appendFileSync(join(dir, 'console.jsonl'), JSON.stringify(event) + '\n');

    // Error-level rows go to log_events table
    if (event.level === 'error') {
      const stepIdx = event.stepIdx ?? this.currentStepIdx.get(runId) ?? 0;
      const id = `evt_${nanoid(12)}`;
      this.db.insert(logEvents).values({
        id,
        runId,
        stepIdx,
        kind: 'console',
        level: event.level,
        payload: { level: event.level, text: event.text, location: event.location, timestamp: event.timestamp },
        createdAt: new Date(),
      }).run();
      const row = this.db.select().from(logEvents).where(eq(logEvents.id, id)).get()!;
      this.wsHub.broadcastRun(runId, 'log.event', row);
    }
  }

  handleNetwork(runId: string, event: NetworkEvent): void {
    const dir = this.artifactsDir(runId);
    mkdirSync(dir, { recursive: true });
    // Always append to network.jsonl
    appendFileSync(join(dir, 'network.jsonl'), JSON.stringify(event) + '\n');

    // Failed requests (4xx/5xx/network-error) go to log_events
    const isFailed =
      event.kind === 'failed' ||
      (event.kind === 'response' && event.status !== undefined && event.status >= 400);
    if (isFailed) {
      const stepIdx = event.stepIdx ?? this.currentStepIdx.get(runId) ?? 0;
      const id = `evt_${nanoid(12)}`;
      const level = event.kind === 'failed' ? 'failed' : String(event.status);
      this.db.insert(logEvents).values({
        id,
        runId,
        stepIdx,
        kind: 'network',
        level,
        payload: {
          kind: event.kind,
          method: event.method,
          url: event.url,
          status: event.status,
          bodySnippet: event.bodySnippet,
          timestamp: event.timestamp,
        },
        createdAt: new Date(),
      }).run();
      const row = this.db.select().from(logEvents).where(eq(logEvents.id, id)).get()!;
      this.wsHub.broadcastRun(runId, 'log.event', row);
    }
  }

  /** Get the last N error-level log events for a run (for auto-evidence on findings) */
  getRecentErrors(runId: string, limit = 20): (typeof logEvents.$inferSelect)[] {
    return this.db
      .select()
      .from(logEvents)
      .where(eq(logEvents.runId, runId))
      .orderBy(desc(logEvents.createdAt))
      .limit(limit)
      .all()
      .reverse();
  }
}
