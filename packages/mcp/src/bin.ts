#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runMcp } from './index.js';

const USAGE =
  'Usage: openuser-mcp --role manager|tester\n' +
  '       node dist/bin.js --role manager\n\n' +
  'Roles:\n' +
  '  manager   All 16 project/persona/test/run management tools\n' +
  '  tester    All 13 browser + reporting tools (token required via begin_run)\n';

let values: { role?: string };
try {
  ({ values } = parseArgs({
    options: { role: { type: 'string', short: 'r' } },
    strict: true,
    allowPositionals: false,
  }));
} catch {
  process.stderr.write(USAGE);
  process.exit(1);
}

const role = values.role;

if (role !== 'manager' && role !== 'tester') {
  process.stderr.write(USAGE);
  process.exit(1);
}

runMcp(role).catch((err: unknown) => {
  process.stderr.write(`OpenUser MCP fatal: ${String(err)}\n`);
  process.exit(1);
});
