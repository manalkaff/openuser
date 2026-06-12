import { type Command } from 'commander';
import { createServer as createNetServer } from 'node:net';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import pc from 'picocolors';
import { readDaemonJson, isDaemonHealthy } from '../lib/daemon.js';

export interface CheckResult {
  label: string;
  pass: boolean;
  message: string;
  hint?: string;
}

// ── Individual check functions (exported for testing) ────────────────────────

export function checkNodeVersion(): CheckResult {
  const match = process.version.match(/^v(\d+)/);
  const major = match?.[1] ? parseInt(match[1], 10) : 0;
  const pass = major >= 20;
  if (pass) {
    return {
      label: 'Node.js >= 20',
      pass: true,
      message: `${process.version}`,
    };
  }
  return {
    label: 'Node.js >= 20',
    pass: false,
    message: `${process.version} — upgrade to Node 20+`,
    hint: 'Install Node.js 20+ from https://nodejs.org',
  };
}

export async function checkDataDirWritable(): Promise<CheckResult> {
  const home = process.env['OPENUSER_HOME'] ?? join(homedir(), '.openuser');
  try {
    mkdirSync(home, { recursive: true });
    const testFile = join(home, '.write-test');
    writeFileSync(testFile, 'ok');
    unlinkSync(testFile);
    return { label: 'Data dir writable', pass: true, message: home };
  } catch (err) {
    return {
      label: 'Data dir writable',
      pass: false,
      message: `${home} — ${(err as Error).message}`,
      hint: `Check permissions on ${home}`,
    };
  }
}

export async function checkDaemonHealth(): Promise<CheckResult> {
  const info = readDaemonJson();
  if (!info) {
    return {
      label: 'Daemon',
      pass: true, // Not a failure — will autostart on first use
      message: 'Not running (will autostart on first `openuser mcp` or `openuser start`)',
    };
  }
  const ok = await isDaemonHealthy(info.port);
  return {
    label: 'Daemon',
    pass: true, // Daemon being down is informational; it autostarts
    message: ok
      ? `Running on port ${info.port} (pid ${info.pid})`
      : `daemon.json exists (port ${info.port}) but not responding — will autostart`,
  };
}

export async function checkChromium(): Promise<CheckResult> {
  try {
    // playwright is a runtime dep; dynamic import to catch missing binary gracefully
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath)) {
      return { label: 'Playwright Chromium', pass: true, message: execPath };
    }
    return {
      label: 'Playwright Chromium',
      pass: false,
      message: 'Chromium binary not found',
      hint: 'Run: npx playwright install chromium',
    };
  } catch {
    return {
      label: 'Playwright Chromium',
      pass: false,
      message: 'Could not locate Chromium executable',
      hint: 'Run: npx playwright install chromium',
    };
  }
}

export async function checkPortFree(port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({
          label: `Port ${port}`,
          pass: false,
          message: `Port ${port} is already in use`,
          hint: 'Use --port to choose a different port, or stop the process using it.',
        });
      } else {
        resolve({
          label: `Port ${port}`,
          pass: false,
          message: `Port check failed: ${err.message}`,
        });
      }
    });
    server.once('listening', () => {
      server.close(() => {
        resolve({ label: `Port ${port}`, pass: true, message: `${port} is free` });
      });
    });
    server.listen(port, '127.0.0.1');
  });
}

// ── Commander registration ────────────────────────────────────────────────────

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check system requirements and daemon health')
    .option('-p, --port <port>', 'Port to check (default 8737)', '8737')
    .action(async (opts: { port: string }) => {
      const port = parseInt(opts.port, 10);

      const results: CheckResult[] = await Promise.all([
        Promise.resolve(checkNodeVersion()),
        checkDataDirWritable(),
        checkDaemonHealth(),
        checkChromium(),
        checkPortFree(port),
      ]);

      console.log('');
      console.log(pc.bold('OpenUser doctor'));
      console.log('');

      let anyFail = false;
      for (const r of results) {
        const icon = r.pass ? pc.green('✓') : pc.red('✗');
        // Pad the RAW label before colorizing — padEnd counts the invisible ANSI
        // escape codes, so padding a color-wrapped string misaligns the column.
        const paddedLabel = r.label.padEnd(28);
        const label = r.pass ? pc.green(paddedLabel) : pc.red(paddedLabel);
        console.log(`  ${icon}  ${label}  ${r.message}`);
        if (!r.pass && r.hint) {
          console.log(`     ${pc.dim('→  ' + r.hint)}`);
        }
        if (!r.pass) anyFail = true;
      }

      console.log('');
      if (anyFail) {
        console.log(pc.red('✗') + '  Some checks failed. See hints above.');
        process.exit(1);
      } else {
        console.log(pc.green('✓') + '  All checks passed.');
      }
    });
}
