import Database from 'better-sqlite3';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import { computeFingerprint } from '../services/fingerprint.js';

export type DB = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseHandle {
  db: DB;
  sqlite: Database.Database;
}

export function openDatabase(homeDir: string, opts: { migrate?: boolean } = {}): DatabaseHandle {
  mkdirSync(homeDir, { recursive: true });

  const dbPath = join(homeDir, 'openuser.db');
  const sqlite = new Database(dbPath);

  // Enable WAL mode for concurrent reads
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Resolve migrations folder for BOTH dev (src/db/migrations) and bundled (dist/migrations) layouts.
  // In dev: import.meta.url = .../src/db/client.ts → ./migrations → src/db/migrations/ ✓
  // Bundled: import.meta.url = .../dist/index.js → ./migrations → dist/migrations/ ✓
  const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));
  if (opts.migrate !== false) {
    migrate(db, { migrationsFolder });
    backfillFingerprints(db);
  }

  return { db, sqlite };
}

/**
 * Fingerprint findings that predate fingerprints, using the page of their step as the route.
 * Never merges or deletes: a row whose fingerprint another row in the project already holds
 * keeps a NULL fingerprint (the earliest row holds it), and nothing else is touched.
 */
export function backfillFingerprints(db: DB): void {
  const legacy = db.select().from(schema.findings).where(isNull(schema.findings.fingerprint)).orderBy(schema.findings.createdAt).all();
  if (legacy.length === 0) return;
  db.transaction((tx) => {
    for (const f of legacy) {
      const step = f.stepId ? tx.select().from(schema.steps).where(eq(schema.steps.id, f.stepId)).get() : undefined;
      const fingerprint = computeFingerprint({
        projectId: f.projectId,
        route: step?.pageUrl ?? undefined,
        category: f.type,
        title: f.title,
        description: f.description,
      });
      const taken = tx
        .select({ id: schema.findings.id })
        .from(schema.findings)
        .where(and(eq(schema.findings.projectId, f.projectId), eq(schema.findings.fingerprint, fingerprint)))
        .get();
      if (taken) continue;
      tx.update(schema.findings).set({ fingerprint }).where(eq(schema.findings.id, f.id)).run();
    }
  });
}
