import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type DB = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseHandle {
  db: DB;
  sqlite: Database.Database;
}

export function openDatabase(homeDir: string): DatabaseHandle {
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
  migrate(db, { migrationsFolder });

  return { db, sqlite };
}
