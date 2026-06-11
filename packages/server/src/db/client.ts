import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import * as schema from './schema.js';

export type DB = ReturnType<typeof drizzle<typeof schema>>;

export function openDatabase(homeDir: string): DB {
  mkdirSync(homeDir, { recursive: true });

  const dbPath = join(homeDir, 'openuser.db');
  const sqlite = new Database(dbPath);

  // Enable WAL mode for concurrent reads
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Auto-apply migrations at boot
  const migrationsFolder = new URL('../db/migrations', import.meta.url).pathname;
  migrate(db, { migrationsFolder });

  return db;
}
