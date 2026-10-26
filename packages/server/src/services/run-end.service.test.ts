import { describe, it, expect } from 'vitest';
import { budgetLimitHit } from './run-end.service.js';

const limits = { maxSteps: 150, maxMinutes: 20, maxTokens: 400_000 };

describe('budgetLimitHit', () => {
  it('is null below every limit', () => {
    expect(budgetLimitHit({ steps: 149, elapsedMs: 19 * 60_000, tokens: 399_999 }, limits)).toBeNull();
  });
  it('reports the limit that was reached', () => {
    expect(budgetLimitHit({ steps: 150, elapsedMs: 0, tokens: 0 }, limits)?.kind).toBe('steps');
    expect(budgetLimitHit({ steps: 1, elapsedMs: 20 * 60_000, tokens: 0 }, limits)?.kind).toBe('minutes');
    expect(budgetLimitHit({ steps: 1, elapsedMs: 0, tokens: 400_000 }, limits)?.kind).toBe('tokens');
  });
});
