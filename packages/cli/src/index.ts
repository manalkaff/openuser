// NOTE: tsup's esbuild banner injects the shebang into dist/index.js.
// Do NOT add #!/usr/bin/env node here — esbuild treats it as a JS comment
// but the banner already adds one, resulting in a duplicate that breaks Node.

import { program } from 'commander';
import { registerStart } from './commands/start.js';
import { registerMcp } from './commands/mcp.js';
import { registerInit } from './commands/init.js';
import { registerSkills } from './commands/skills.js';
import { registerDoctor } from './commands/doctor.js';

program
  .name('openuser')
  .description('Self-hostable agent-as-a-user testing platform')
  .version('0.1.0');

registerStart(program);
registerMcp(program);
registerInit(program);
registerSkills(program);
registerDoctor(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
