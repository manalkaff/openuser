import { describe, it, expect } from 'vitest';
import {
  PersonaIdentitySchema,
  PersonaBehaviorSchema,
  PersonaKnowledgeSchema,
} from './persona.js';

describe('PersonaIdentitySchema', () => {
  it('accepts a minimal valid identity (no credentials, no signupInstructions)', () => {
    const result = PersonaIdentitySchema.safeParse({
      fullName: 'Alice Buyer',
      roleLabel: 'first-time buyer',
      locale: 'en-US',
    });
    expect(result.success).toBe(true);
  });

  it('accepts identity with credentials', () => {
    const result = PersonaIdentitySchema.safeParse({
      fullName: 'Bob Reseller',
      roleLabel: 'reseller',
      credentials: { username: 'bob@example.com', password: 's3cret' },
      locale: 'id-ID',
    });
    expect(result.success).toBe(true);
  });

  it('accepts identity with signupInstructions instead of credentials', () => {
    const result = PersonaIdentitySchema.safeParse({
      fullName: 'Carol New',
      roleLabel: 'new user',
      signupInstructions: 'Sign up with a fresh Gmail account',
      locale: 'en-GB',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing fullName', () => {
    const result = PersonaIdentitySchema.safeParse({
      roleLabel: 'buyer',
      locale: 'en-US',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing locale', () => {
    const result = PersonaIdentitySchema.safeParse({
      fullName: 'Dan',
      roleLabel: 'buyer',
    });
    expect(result.success).toBe(false);
  });
});

describe('PersonaBehaviorSchema', () => {
  const valid = {
    techSavviness: 'average',
    patience: 'medium',
    readingStyle: 'skims',
    device: 'desktop',
    viewport: { width: 1280, height: 720 },
    habits: 'Uses Chrome on MacBook',
  };

  it('accepts valid behavior', () => {
    expect(PersonaBehaviorSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects invalid techSavviness', () => {
    expect(PersonaBehaviorSchema.safeParse({ ...valid, techSavviness: 'guru' }).success).toBe(false);
  });

  it('rejects invalid patience', () => {
    expect(PersonaBehaviorSchema.safeParse({ ...valid, patience: 'infinite' }).success).toBe(false);
  });

  it('rejects invalid readingStyle', () => {
    expect(PersonaBehaviorSchema.safeParse({ ...valid, readingStyle: 'speed-reads' }).success).toBe(false);
  });

  it('rejects invalid device', () => {
    expect(PersonaBehaviorSchema.safeParse({ ...valid, device: 'tablet' }).success).toBe(false);
  });

  it('rejects viewport missing width', () => {
    expect(PersonaBehaviorSchema.safeParse({ ...valid, viewport: { height: 720 } }).success).toBe(false);
  });
});

describe('PersonaKnowledgeSchema', () => {
  it('accepts valid knowledge', () => {
    const result = PersonaKnowledgeSchema.safeParse({
      productKnowledge: 'Has bought before, knows about promotions',
      expectations: 'Expects fast checkout',
      vocabulary: 'Says "cart" not "basket"',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing productKnowledge', () => {
    const result = PersonaKnowledgeSchema.safeParse({
      expectations: 'Fast',
      vocabulary: 'Normal',
    });
    expect(result.success).toBe(false);
  });
});
