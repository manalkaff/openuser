import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { settings } from '../db/schema.js';

export interface SettingsShape {
  watchdogMinutes: number;
  headed: boolean;
  browserChannel: string;
}

export const SETTINGS_DEFAULTS: SettingsShape = {
  watchdogMinutes: 5,
  headed: false,
  browserChannel: 'chromium',
};

export class SettingsService {
  constructor(private readonly db: DB) {}

  getAll(): SettingsShape {
    const rows = this.db.select().from(settings).all();
    const result: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
    for (const row of rows) {
      const key = row.key as keyof SettingsShape;
      const fallback = SETTINGS_DEFAULTS[key];
      // Fix #6: defensive typeof guard — fall back to default if stored type doesn't match
      if (typeof row.value !== typeof fallback) {
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
    if (typeof row.value !== typeof fallback) {
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
