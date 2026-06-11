#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runMcp, type McpRole } from './index.js';

const { values } = parseArgs({
  options: {
    role: {
      type: 'string',
      short: 'r',
    },
  },
  strict: true,
  allowPositionals: false,
});

const role = values.role as string | undefined;

if (role !== 'manager' && role !== 'tester') {
  process.stderr.write(
    'Usage: openuser-mcp --role manager|tester\n' +
      '       node dist/bin.js --role manager\n\n' +
      'Roles:\n' +
      '  manager   All 16 project/persona/test/run management tools\n' +
      '  tester    All 13 browser + reporting tools (token required via begin_run)\n',
  );
  process.exit(1);
}

runMcp(role as McpRole).catch((err: unknown) => {
  process.stderr.write(`OpenUser MCP fatal: ${String(err)}\n`);
  process.exit(1);
});
