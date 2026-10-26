import { type Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { bridgeWithStore } from '@openuser/mcp';
import { listBridgeCandidates, openDatabase, recordFindingIssue } from '@openuser/server';
import { readDaemonJson } from '../lib/daemon.js';
import { bundledMigrationsDir } from '../lib/paths.js';

export function registerBridge(program: Command): void {
  program
    .command('bridge')
    .description('File kind:finding Multica issues for new high-severity findings (comments on known ones)')
    .requiredOption('--project <id>', 'Project ID (prj_...)')
    .action(async (opts: { project: string }) => {
      // Reads the local database directly, so it works without a running daemon.
      const home = process.env['OPENUSER_HOME'] ?? join(homedir(), '.openuser');
      let handle: ReturnType<typeof openDatabase> | undefined;
      try {
        handle = openDatabase(home, { migrate: existsSync(bundledMigrationsDir()) });
        const { db } = handle;
        const port = readDaemonJson()?.port;
        const artifactUrl = (rel: string) =>
          port ? `http://127.0.0.1:${port}/artifacts/${rel}` : join(home, 'artifacts', rel);
        const r = await bridgeWithStore(
          {
            list: async (id) => listBridgeCandidates(db, id, artifactUrl),
            record: async (findingId, issueId) => {
              recordFindingIssue(db, findingId, issueId);
            },
          },
          opts.project,
        );
        console.log(
          `${pc.green('✓')} filed ${r.filed.length}, commented ${r.commented.length}, digest-only ${r.digestOnly}, below threshold ${r.skipped}`,
        );
        for (const f of r.filed) console.log(`  ${f.priority} ${f.issueId}`);
      } catch (err) {
        process.stderr.write(pc.red('✗') + '  ' + (err instanceof Error ? err.message : String(err)) + '\n');
        process.exitCode = 1;
      } finally {
        handle?.sqlite.close();
      }
    });
}
