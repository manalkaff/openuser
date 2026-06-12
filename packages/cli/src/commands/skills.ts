import { type Command } from 'commander';

// TEMPORARY STUB — full implementation lands in Group G6C.
export function registerSkills(program: Command): void {
  program
    .command('skills')
    .description('Manage OpenUser skills (stub — G6C)')
    .allowUnknownOption(true)
    .action(() => {
      // no-op placeholder
    });
}
