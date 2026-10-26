import { describe, it, expect } from 'vitest';
import { runTelemetry } from './telemetry.service.js';
import type { runs } from '../db/schema.js';

const base = { tokens: 1000, newFindings: 2, duplicateFindings: 1 } as typeof runs.$inferSelect;

describe('runTelemetry', () => {
  it('measures wall clock from start to finish', () => {
    const run = { ...base, startedAt: new Date(1_000), finishedAt: new Date(4_500) };
    expect(runTelemetry(run, 7)).toEqual({ steps: 7, wallClockMs: 3_500, tokens: 1000, newFindings: 2, duplicateFindings: 1 });
  });
  it('runs to now while unfinished and is 0 before start', () => {
    expect(runTelemetry({ ...base, startedAt: new Date(1_000), finishedAt: null }, 0, 3_000).wallClockMs).toBe(2_000);
    expect(runTelemetry({ ...base, startedAt: null, finishedAt: null }, 0, 3_000).wallClockMs).toBe(0);
  });
});
