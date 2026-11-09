import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cliVersion } from '../src/lib/version.js';

describe('cliVersion (BISNIS-131)', () => {
  it('is the version in packages/cli/package.json, not a hard-coded string', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(cliVersion()).toBe(pkg.version);
    expect(cliVersion()).not.toBe('0.1.0');
  });
});
