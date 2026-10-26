import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { settings } from '../db/schema.js';

export interface SettingsShape {
  watchdogMinutes: number;
  headed: boolean;
  browserChannel: string;
  /** Shell command run before a run starts; `{tenant}` becomes `run-<runId>`. Empty = off. */
  seedCommand: string;
  /** Shell command run after a run ends to delete its tenant. Empty = off. */
  teardownCommand: string;
  maxSteps: number;
  maxMinutes: number;
  maxTokens: number;
  /** Lock file taken by begin_run and held until the run ends. Empty = off. */
  lockFile: string;
  /** Hosts (and their subdomains) a run must never target. */
  denyHosts: string[];
}

export const SETTINGS_DEFAULTS: SettingsShape = {
  watchdogMinutes: 5,
  headed: false,
  browserChannel: 'chromium',
  seedCommand: '',
  teardownCommand: '',
  maxSteps: 150,
  maxMinutes: 20,
  maxTokens: 400_000,
  lockFile: '',
  denyHosts: ['23bisnis.com'],
};

function matchesType(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(fallback)) return Array.isArray(value) && value.every((v) => typeof v === 'string');
  return typeof value === typeof fallback;
}

export class SettingsService {
  constructor(private readonly db: DB) {}

  getAll(): SettingsShape {
    const rows = this.db.select().from(settings).all();
    const result: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
    for (const row of rows) {
      const key = row.key as keyof SettingsShape;
      const fallback = SETTINGS_DEFAULTS[key];
      // Fix #6: defensive typeof guard — fall back to default if stored type doesn't match
      if (!matchesType(row.value, fallback)) {
        result[row.key] = fallback;
      } else {
        result[row.key] = row.value;
      }
    }
    return result as unknown as SettingsShape;
  }

  get<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();
    if (row === undefined) {
      return SETTINGS_DEFAULTS[key];
    }
    // Fix #6: defensive typeof guard — fall back to default if stored type doesn't match
    const fallback = SETTINGS_DEFAULTS[key];
    if (!matchesType(row.value, fallback)) {
      return fallback;
    }
    return row.value as SettingsShape[K];
  }

  set<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]): void {
    this.db
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }

  patch(partial: Partial<SettingsShape>): SettingsShape {
    for (const [key, value] of Object.entries(partial) as [keyof SettingsShape, unknown][]) {
      this.set(key as keyof SettingsShape, value as SettingsShape[keyof SettingsShape]);
    }
    return this.getAll();
  }
}
