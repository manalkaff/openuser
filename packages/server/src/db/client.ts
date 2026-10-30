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
 * Give findings that predate fingerprints a canonical fingerprint (route unknown) and merge the
 * historical duplicates into the earliest row, keeping every run's link and the summed occurrences.
 */
export function backfillFingerprints(db: DB): void {
  const legacy = db.select().from(schema.findings).where(isNull(schema.findings.fingerprint)).orderBy(schema.findings.createdAt).all();
  if (legacy.length === 0) return;
  db.transaction((tx) => {
    for (const f of legacy) {
      const fingerprint = computeFingerprint({
        projectId: f.projectId,
        category: f.type,
        title: f.title,
        description: f.description,
      });
      const canon = tx
        .select()
        .from(schema.findings)
        .where(and(eq(schema.findings.projectId, f.projectId), eq(schema.findings.fingerprint, fingerprint)))
        .get();
      if (!canon) {
        tx.update(schema.findings).set({ fingerprint }).where(eq(schema.findings.id, f.id)).run();
        continue;
      }
      tx.update(schema.findings)
        .set({
          occurrences: canon.occurrences + f.occurrences,
          lastSeen: new Date(Math.max((canon.lastSeen ?? canon.createdAt).getTime(), (f.lastSeen ?? f.createdAt).getTime())),
          issueId: canon.issueId ?? f.issueId,
        })
        .where(eq(schema.findings.id, canon.id))
        .run();
      const links = tx.select().from(schema.runFindings).where(eq(schema.runFindings.findingId, f.id)).all();
      for (const l of links) tx.insert(schema.runFindings).values({ ...l, findingId: canon.id }).onConflictDoNothing().run();
      tx.delete(schema.runFindings).where(eq(schema.runFindings.findingId, f.id)).run();
      tx.delete(schema.findings).where(eq(schema.findings.id, f.id)).run();
    }
  });
}
