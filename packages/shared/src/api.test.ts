import { describe, it, expect } from 'vitest';
import {
  CreateProjectBodySchema,
  PatchProjectBodySchema,
  CreatePersonaBodySchema,
  PatchPersonaBodySchema,
  CreateTestBodySchema,
  PatchTestBodySchema,
  PrepareRunBodySchema,
  PrepareRunResponseSchema,
  ListRunsQuerySchema,
  PromoteRunBodySchema,
  PatchFindingBodySchema,
  PatchSettingsBodySchema,
  TesterBeginResponseSchema,
  TesterActionRequestSchema,
  TesterActionResponseSchema,
  TesterFindingBodySchema,
  TesterCheckpointBodySchema,
  TesterCompleteBodySchema,
  TesterCompleteResponseSchema,
  HealthResponseSchema,
} from './api.js';

describe('HealthResponseSchema', () => {
  it('accepts valid health response', () => {
    expect(HealthResponseSchema.safeParse({ ok: true, version: '0.0.1' }).success).toBe(true);
  });

  it('rejects ok:false', () => {
    expect(HealthResponseSchema.safeParse({ ok: false, version: '0.0.1' }).success).toBe(false);
  });
});

describe('PrepareRunBodySchema', () => {
  it('accepts testId (no adhocGoal)', () => {
    const body = { projectId: 'prj_abc', testId: 'tst_xyz', personaId: 'per_123' };
    expect(PrepareRunBodySchema.safeParse(body).success).toBe(true);
  });

  it('accepts adhocGoal (no testId)', () => {
    const body = { projectId: 'prj_abc', adhocGoal: 'Test the checkout', personaId: 'per_123' };
    expect(PrepareRunBodySchema.safeParse(body).success).toBe(true);
  });

  it('accepts with optional checkpointId and environment', () => {
    const body = {
      projectId: 'prj_abc',
      adhocGoal: 'Test',
      personaId: 'per_123',
      checkpointId: 'chk_456',
      environment: 'staging',
      agentLabel: 'claude-code',
    };
    expect(PrepareRunBodySchema.safeParse(body).success).toBe(true);
  });

  it('accepts both testId and adhocGoal (schema is permissive; server validates exactly-one)', () => {
    const body = { projectId: 'prj_abc', testId: 'tst_xyz', adhocGoal: 'Also', personaId: 'per_123' };
    expect(PrepareRunBodySchema.safeParse(body).success).toBe(true);
  });
});

describe('PrepareRunResponseSchema', () => {
  it('accepts a valid prepare response', () => {
    const resp = { runId: 'run_abc', token: 'rt_xxxxxxxxxxxxxxxxxxxxxxxxxxxx', testerPrompt: 'You are...' };
    expect(PrepareRunResponseSchema.safeParse(resp).success).toBe(true);
  });
});

describe('TesterActionRequestSchema', () => {
  it('accepts navigate action with optional note', () => {
    const body = { kind: 'navigate', url: 'https://example.com', note: 'Going to homepage' };
    expect(TesterActionRequestSchema.safeParse(body).success).toBe(true);
  });

  it('accepts click without note', () => {
    expect(TesterActionRequestSchema.safeParse({ kind: 'click', ref: 'e5' }).success).toBe(true);
  });
});

describe('TesterActionResponseSchema', () => {
  it('accepts ok=true with snapshot', () => {
    const resp = {
      ok: true,
      snapshot: { url: 'https://x.com', title: 'X', tree: 'main' },
    };
    expect(TesterActionResponseSchema.safeParse(resp).success).toBe(true);
  });

  it('accepts ok=false with error and optional snapshot', () => {
    const resp = {
      ok: false,
      error: 'page changed — call browser_snapshot again',
      snapshot: { url: 'https://x.com', title: 'X', tree: 'main' },
    };
    expect(TesterActionResponseSchema.safeParse(resp).success).toBe(true);
  });

  it('accepts ok=false without snapshot', () => {
    const resp = { ok: false, error: 'some error' };
    expect(TesterActionResponseSchema.safeParse(resp).success).toBe(true);
  });
});

describe('TesterCompleteBodySchema', () => {
  it('accepts valid complete body', () => {
    expect(TesterCompleteBodySchema.safeParse({ verdict: 'goal_achieved', summary: 'Done!' }).success).toBe(true);
  });

  it('rejects invalid verdict', () => {
    expect(TesterCompleteBodySchema.safeParse({ verdict: 'success', summary: 'Done' }).success).toBe(false);
  });
});

describe('TesterFindingBodySchema', () => {
  it('accepts all required fields', () => {
    const body = {
      type: 'functional',
      severity: 'high',
      title: 'Pay button does nothing',
      description: 'I clicked the pay button and nothing happened.',
    };
    expect(TesterFindingBodySchema.safeParse(body).success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const body = { type: 'functional', severity: 'urgent', title: 'Bug', description: 'Desc' };
    expect(TesterFindingBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('PatchFindingBodySchema', () => {
  it('accepts valid status update', () => {
    expect(PatchFindingBodySchema.safeParse({ status: 'acknowledged' }).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(PatchFindingBodySchema.safeParse({ status: 'wontfix' }).success).toBe(false);
  });
});

describe('ListRunsQuerySchema', () => {
  it('accepts empty query', () => {
    expect(ListRunsQuerySchema.safeParse({}).success).toBe(true);
  });

  it('accepts all filters', () => {
    const q = { projectId: 'prj_abc', status: 'running', limit: '10' };
    expect(ListRunsQuerySchema.safeParse(q).success).toBe(true);
  });
});

describe('CreatePersonaBodySchema', () => {
  it('accepts a full valid persona body', () => {
    const body = {
      name: 'Alice',
      role: 'buyer',
      identity: { fullName: 'Alice Buyer', roleLabel: 'first-time buyer', locale: 'en-US' },
      behavior: {
        techSavviness: 'average',
        patience: 'medium',
        readingStyle: 'skims',
        device: 'desktop',
        viewport: { width: 1280, height: 720 },
        habits: 'Uses Chrome',
      },
      knowledge: {
        productKnowledge: 'New to the platform',
        expectations: 'Fast checkout',
        vocabulary: 'Says "cart"',
      },
    };
    expect(CreatePersonaBodySchema.safeParse(body).success).toBe(true);
  });
});

describe('PromoteRunBodySchema', () => {
  it('accepts title only', () => {
    expect(PromoteRunBodySchema.safeParse({ title: 'Smoke test checkout' }).success).toBe(true);
  });

  it('accepts title + priority + tags', () => {
    expect(PromoteRunBodySchema.safeParse({ title: 'Test', priority: 'high', tags: ['checkout'] }).success).toBe(true);
  });
});
