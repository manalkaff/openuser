import { type Command } from 'commander';

// TEMPORARY STUB — full implementation lands in Group G6C.
export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Run health checks (stub — G6C)')
    .action(() => {
      // no-op placeholder
    });
}
