import { describe, it, expect } from 'vitest';
import { FindingEvidenceSchema, TesterActionSchema, PageSnapshotSchema } from './types.js';

describe('FindingEvidenceSchema', () => {
  it('accepts empty evidence object', () => {
    expect(FindingEvidenceSchema.safeParse({}).success).toBe(true);
  });

  it('accepts evidence with all optional fields', () => {
    const evidence = {
      screenshotPath: '/home/.openuser/artifacts/run_abc/shots/shot1.png',
      consoleExcerpt: [{ level: 'error', text: 'TypeError: null' }],
      networkExcerpt: [
        { method: 'POST', url: 'https://api.example.com/pay', status: 500, bodySnippet: '{"error":"Internal"}' },
      ],
    };
    expect(FindingEvidenceSchema.safeParse(evidence).success).toBe(true);
  });

  it('accepts networkExcerpt with status "failed"', () => {
    const evidence = {
      networkExcerpt: [{ method: 'GET', url: 'https://example.com', status: 'failed' }],
    };
    expect(FindingEvidenceSchema.safeParse(evidence).success).toBe(true);
  });
});

describe('TesterActionSchema', () => {
  it('accepts navigate action', () => {
    expect(TesterActionSchema.safeParse({ kind: 'navigate', url: 'https://example.com' }).success).toBe(true);
  });

  it('accepts click action', () => {
    expect(TesterActionSchema.safeParse({ kind: 'click', ref: 'e12' }).success).toBe(true);
  });

  it('accepts type action with optional submit', () => {
    expect(TesterActionSchema.safeParse({ kind: 'type', ref: 'e5', text: 'hello', submit: true }).success).toBe(true);
  });

  it('accepts type action without submit', () => {
    expect(TesterActionSchema.safeParse({ kind: 'type', ref: 'e5', text: 'hello' }).success).toBe(true);
  });

  it('accepts select action', () => {
    expect(TesterActionSchema.safeParse({ kind: 'select', ref: 'e3', value: 'option1' }).success).toBe(true);
  });

  it('accepts scroll action with direction and optional amountPx', () => {
    expect(TesterActionSchema.safeParse({ kind: 'scroll', direction: 'down', amountPx: 300 }).success).toBe(true);
  });

  it('accepts scroll action without amountPx', () => {
    expect(TesterActionSchema.safeParse({ kind: 'scroll', direction: 'up' }).success).toBe(true);
  });

  it('accepts back action', () => {
    expect(TesterActionSchema.safeParse({ kind: 'back' }).success).toBe(true);
  });

  it('accepts wait action (max 30 seconds)', () => {
    expect(TesterActionSchema.safeParse({ kind: 'wait', seconds: 5 }).success).toBe(true);
  });

  it('rejects wait action with seconds > 30', () => {
    expect(TesterActionSchema.safeParse({ kind: 'wait', seconds: 31 }).success).toBe(false);
  });

  it('rejects unknown kind', () => {
    expect(TesterActionSchema.safeParse({ kind: 'hover', ref: 'e1' }).success).toBe(false);
  });

  it('rejects navigate without url', () => {
    expect(TesterActionSchema.safeParse({ kind: 'navigate' }).success).toBe(false);
  });
});

describe('PageSnapshotSchema', () => {
  it('accepts a valid snapshot', () => {
    const snapshot = {
      url: 'https://example.com/checkout',
      title: 'Checkout — Example Shop',
      tree: 'main\n  h1 Checkout [ref=e1]\n  button Submit [ref=e2]',
    };
    expect(PageSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('rejects missing url', () => {
    expect(PageSnapshotSchema.safeParse({ title: 'Page', tree: 'main' }).success).toBe(false);
  });

  it('rejects missing tree', () => {
    expect(PageSnapshotSchema.safeParse({ url: 'https://x.com', title: 'X' }).success).toBe(false);
  });
});
