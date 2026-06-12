import { type Command } from 'commander';
import { createInterface, type Interface } from 'node:readline';
import { basename } from 'node:path';
import pc from 'picocolors';
import { ensureDaemonRunning } from '../lib/daemon.js';
import { writeConfig, type OpenUserConfig } from '../lib/config.js';

export interface InitArgs {
  cwd: string;
  name: string;
  baseUrl: string;
}

export async function runInit(args: InitArgs): Promise<void> {
  const { cwd, name, baseUrl } = args;
  const port = await ensureDaemonRunning();
  const apiBase = `http://127.0.0.1:${port}`;

  const listRes = await fetch(`${apiBase}/api/projects`);
  if (!listRes.ok) throw new Error(`Failed to list projects: ${listRes.status}`);
  const projects = (await listRes.json()) as Array<{ id: string; path: string }>;
  const existing = projects.find((p) => p.path === cwd);

  let projectId: string;
  if (existing) {
    const patchRes = await fetch(`${apiBase}/api/projects/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, baseUrl }),
    });
    if (!patchRes.ok) throw new Error(`Failed to update project: ${patchRes.status}`);
    const updated = (await patchRes.json()) as { id: string };
    projectId = updated.id;
    console.log(pc.green('✓') + ` Updated project ${pc.bold(name)} (${projectId})`);
  } else {
    const postRes = await fetch(`${apiBase}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: cwd, baseUrl, environments: [] }),
    });
    if (!postRes.ok) throw new Error(`Failed to create project: ${postRes.status}`);
    const created = (await postRes.json()) as { id: string };
    projectId = created.id;
    console.log(pc.green('✓') + ` Registered project ${pc.bold(name)} (${projectId})`);
  }

  const config: OpenUserConfig = { name, baseUrl, environments: [] };
  writeConfig(cwd, config);
  console.log(pc.green('✓') + ` Wrote openuser.config.json`);
  console.log(pc.dim(`  Dashboard: http://127.0.0.1:${port}`));
}

function question(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Register this directory as an OpenUser project')
    .action(async () => {
      const cwd = process.cwd();
      const defaultName = basename(cwd);
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      let name: string;
      let baseUrl: string;
      try {
        const nameInput = await question(rl, `Project name [${defaultName}]: `);
        name = nameInput.trim() || defaultName;
        const urlInput = await question(rl, 'Base URL (e.g. http://localhost:3000): ');
        baseUrl = urlInput.trim();
        if (!baseUrl) {
          console.error(pc.red('✗') + '  Base URL is required');
          process.exit(1);
        }
      } finally {
        rl.close();
      }
      try {
        await runInit({ cwd, name, baseUrl });
      } catch (err) {
        console.error(pc.red('✗') + '  ' + (err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
