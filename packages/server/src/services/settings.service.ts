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
  /** Hosts (and their subdomains) a run must never target. Config adds to the built-in list. */
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

/**
 * Settings that run shell commands or switch off a production guard. They come only from config
 * (`<home>/config.json`) or CLI flags, never from the database or `PATCH /api/settings`.
 */
export const GUARD_KEYS = ['seedCommand', 'teardownCommand', 'lockFile', 'denyHosts'] as const;
export type GuardKey = (typeof GUARD_KEYS)[number];
export type GuardConfig = Partial<Pick<SettingsShape, GuardKey>>;

export function isGuardKey(key: string): key is GuardKey {
  return (GUARD_KEYS as readonly string[]).includes(key);
}

function matchesType(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(fallback)) return Array.isArray(value) && value.every((v) => typeof v === 'string');
  return typeof value === typeof fallback;
}

export class SettingsService {
  constructor(
    private readonly db: DB,
    private readonly guards: GuardConfig = {},
  ) {}

  getAll(): SettingsShape {
    const rows = this.db.select().from(settings).all();
    const result: Record<string, unknown> = { ...SETTINGS_DEFAULTS };
    for (const row of rows) {
      if (isGuardKey(row.key)) continue; // a value stored by an earlier version is ignored
      const key = row.key as keyof SettingsShape;
      const fallback = SETTINGS_DEFAULTS[key];
      // Fix #6: defensive typeof guard — fall back to default if stored type doesn't match
      if (!matchesType(row.value, fallback)) {
        result[row.key] = fallback;
      } else {
        result[row.key] = row.value;
      }
    }
    for (const key of GUARD_KEYS) result[key] = this.guard(key);
    return result as unknown as SettingsShape;
  }

  private guard<K extends GuardKey>(key: K): SettingsShape[K] {
    if (key === 'denyHosts') {
      // Config only adds hosts: the built-in production list (AC7, 23bisnis.com) always applies.
      const merged = new Set([...SETTINGS_DEFAULTS.denyHosts, ...(this.guards.denyHosts ?? [])]);
      return [...merged] as SettingsShape[K];
    }
    return (this.guards[key] ?? SETTINGS_DEFAULTS[key]) as SettingsShape[K];
  }

  get<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
    if (isGuardKey(key)) return this.guard(key) as SettingsShape[K];
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
    if (isGuardKey(key)) throw new Error(`${key} can only be set from config or CLI flags`);
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
