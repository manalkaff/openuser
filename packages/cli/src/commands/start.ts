import { type Command } from 'commander';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { bundledUiDir } from '../lib/paths.js';
import { readDaemonJson, isDaemonHealthy } from '../lib/daemon.js';

export interface StartOptions {
  port?: string;
  host?: string;
  open: boolean;
  detach: boolean;
}

export function registerStart(program: Command): void {
  program
    .command('start', { isDefault: true })
    .description('Start the OpenUser daemon and open the dashboard')
    .option('-p, --port <port>', 'Port to listen on (default 8737)')
    .option('--host <host>', 'Host to bind (default 127.0.0.1)')
    .option('--no-open', 'Do not open browser after start')
    .option('--detach', 'Spawn daemon in background and exit')
    .action(async (opts: StartOptions) => {
      await runStart(opts);
    });
}

function openHost(host: string): string {
  return host === '0.0.0.0' ? 'localhost' : host;
}

export async function runStart(opts: StartOptions): Promise<void> {
  const requestedPort = opts.port ? parseInt(opts.port, 10) : 8737;
  const host = opts.host ?? '127.0.0.1';

  // ── If a healthy daemon is already recorded, just open and exit ───────────
  const info = readDaemonJson();
  if (info && (await isDaemonHealthy(info.port))) {
    const url = `http://127.0.0.1:${info.port}`;
    console.log(pc.green('✓') + ` OpenUser already running at ${url}`);
    if (opts.open) {
      const { default: open } = await import('open');
      await open(url);
    }
    return;
  }

  // ── Detach mode: re-spawn self in the background (child runs foreground) ───
  if (opts.detach) {
    const { spawn } = await import('node:child_process');
    const entry = process.argv[1];
    if (!entry) throw new Error('Cannot locate CLI entry to spawn detached daemon.');
    const args = ['start', '--no-open'];
    if (opts.port) args.push('--port', opts.port);
    if (opts.host) args.push('--host', opts.host);
    const child = spawn(process.execPath, [entry, ...args], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    child.on('error', () => {});
    console.log(pc.cyan('→') + ` Daemon spawning in background (port ${requestedPort})…`);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = readDaemonJson();
      if (fresh && (await isDaemonHealthy(fresh.port))) {
        const url = `http://${openHost(host)}:${fresh.port}`;
        console.log(pc.green('✓') + ` Daemon ready at ${url}`);
        if (opts.open) {
          const { default: open } = await import('open');
          await open(url);
        }
        return;
      }
    }
    console.log(pc.yellow('⚠') + '  Daemon may still be starting. Check `openuser doctor`.');
    return;
  }

  // ── Foreground mode: start the server in-process ──────────────────────────
  const homeDir = process.env['OPENUSER_HOME'] ?? join(homedir(), '.openuser');
  const { createServer } = await import('@openuser/server');
  const instance = await createServer({
    homeDir,
    port: requestedPort,
    host,
    uiDir: bundledUiDir(),
  });

  const url = `http://${openHost(host)}:${instance.port}`;
  console.log(pc.green('✓') + ` OpenUser running at ${pc.bold(url)}`);
  console.log(pc.dim('  Press Ctrl+C to stop'));

  if (opts.open) {
    const { default: open } = await import('open');
    await open(url);
  }

  // Graceful shutdown on Ctrl+C. Surface a close failure via a non-zero exit
  // code rather than masking it with 0.
  const shutdown = (): void => {
    instance
      .close()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        console.error(pc.red('✗') + '  ' + (err instanceof Error ? err.message : String(err)));
        process.exit(1);
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive; the HTTP server holds the event loop open.
  await new Promise<never>(() => {});
}
