// BISNIS-41 AC2 (MCP half): the bridge is also an MCP tool on the manager server.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('BISNIS-41 acceptance', () => {
  it('AC2 manager MCP server registers a bridge tool', () => {
    const src = readFileSync(new URL('../src/manager/index.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/registerTool\(\s*['"]bridge['"]/);
  });
});
