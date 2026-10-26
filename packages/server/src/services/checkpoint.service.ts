import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { checkpoints, steps, type runs } from '../db/schema.js';
import type { RunnerSession } from '../runner/types.js';

export interface SaveCheckpointInput {
  name: string;
  description?: string | undefined;
  journeyNotes: string;
}

/** Save the session's storage state and journey as a checkpoint of `run`. */
export async function saveRunCheckpoint(
  db: DB,
  homeDir: string,
  run: typeof runs.$inferSelect,
  session: RunnerSession,
  input: SaveCheckpointInput,
): Promise<typeof checkpoints.$inferSelect> {
  const checkpointId = `chk_${nanoid(12)}`;
  const checkpointDir = join(homeDir, 'checkpoints', checkpointId);
  mkdirSync(checkpointDir, { recursive: true });

  const storageStatePath = join(checkpointDir, 'storageState.json');
  await session.saveStorageState(storageStatePath);

  const latestStep = db.select().from(steps).where(eq(steps.runId, run.id)).orderBy(steps.idx).all().at(-1);
  const journey = {
    notes: input.journeyNotes,
    savedAtStep: latestStep?.idx ?? 0,
    url: latestStep?.pageUrl ?? run.baseUrlResolved,
  };
  writeFileSync(join(checkpointDir, 'journey.json'), JSON.stringify(journey, null, 2));

  db.insert(checkpoints).values({
    id: checkpointId,
    projectId: run.projectId,
    personaId: run.personaId,
    name: input.name,
    description: input.description ?? null,
    storageStatePath,
    journey,
    createdFromRunId: run.id,
    createdAt: new Date(),
  }).run();

  return db.select().from(checkpoints).where(eq(checkpoints.id, checkpointId)).get()!;
}
