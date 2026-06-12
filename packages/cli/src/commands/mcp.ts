import { type Command } from 'commander';
import pc from 'picocolors';
import { ensureDaemonRunning } from '../lib/daemon.js';

export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description('Run the stdio MCP server (manager or tester role)')
    .requiredOption('--role <role>', 'MCP role: manager or tester')
    .action(async (opts: { role: string }) => {
      const role = opts.role;
      if (role !== 'manager' && role !== 'tester') {
        process.stderr.write(pc.red('✗') + '  --role must be "manager" or "tester"\n');
        process.exit(1);
      }

      // Set OPENUSER_CLI_ENTRY so the mcp package's daemon autostart can
      // re-exec the correct binary even from a global npx install.
      const entry = process.argv[1];
      if (entry) process.env['OPENUSER_CLI_ENTRY'] = entry;

      // Ensure the daemon is up before handing stdio to the MCP server.
      try {
        await ensureDaemonRunning();
      } catch (err) {
        // stderr only — stdout is the MCP stdio channel and must stay clean.
        process.stderr.write(
          pc.red('✗') + '  ' + (err instanceof Error ? err.message : String(err)) + '\n',
        );
        process.exit(1);
      }

      const { runMcp } = await import('@openuser/mcp');
      await runMcp(role);
    });
}
