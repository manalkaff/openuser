import { type Command } from 'commander';
import { createInterface, type Interface } from 'node:readline';
import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import pc from 'picocolors';
import { ensureDaemonRunning } from '../lib/daemon.js';
import { writeConfig, type OpenUserConfig } from '../lib/config.js';
import { writeMcpConfig, type Agent } from '../lib/mcp-config.js';
import { copySkills, agentsMdSnippet } from './skills.js';
import { bundledSkillsDir } from '../lib/paths.js';

const AGENTS: Agent[] = ['claude', 'codex', 'opencode', 'cursor'];
const SKILL_DEST: Record<Agent, string> = {
  claude: '.claude/skills',
  codex: '.agents/skills',
  opencode: '.agents/skills',
  cursor: '.agents/skills',
};

export interface InitArgs {
  cwd: string;
  name: string;
  baseUrl: string;
  /** When set, also install skills + write MCP config for this agent. */
  agent?: Agent;
}

/** Register (or update) the project with the daemon and write openuser.config.json. */
async function registerProject(cwd: string, name: string, baseUrl: string): Promise<number> {
  const port = await ensureDaemonRunning();
  const apiBase = `http://127.0.0.1:${port}`;

  const listRes = await fetch(`${apiBase}/api/projects`);
  if (!listRes.ok) throw new Error(`Failed to list projects: ${listRes.status}`);
  const projects = (await listRes.json()) as Array<{ id: string; path: string }>;
  const existing = projects.find((p) => p.path === cwd);

  if (existing) {
    const patchRes = await fetch(`${apiBase}/api/projects/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, baseUrl }),
    });
    if (!patchRes.ok) throw new Error(`Failed to update project: ${patchRes.status}`);
    const updated = (await patchRes.json()) as { id: string };
    console.log(pc.green('✓') + ` Updated project ${pc.bold(name)} (${updated.id})`);
  } else {
    const postRes = await fetch(`${apiBase}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: cwd, baseUrl, environments: [] }),
    });
    if (!postRes.ok) throw new Error(`Failed to create project: ${postRes.status}`);
    const created = (await postRes.json()) as { id: string };
    console.log(pc.green('✓') + ` Registered project ${pc.bold(name)} (${created.id})`);
  }

  const config: OpenUserConfig = { name, baseUrl, environments: [] };
  writeConfig(cwd, config);
  console.log(pc.green('✓') + ` Wrote openuser.config.json`);
  return port;
}

/** Install skills + write MCP config for the chosen agent. */
function setupAgent(cwd: string, agent: Agent): void {
  const skillsRoot = bundledSkillsDir();
  if (!existsSync(skillsRoot)) {
    throw new Error(
      `Skills directory not found: ${skillsRoot}\n` +
        '  Skills are bundled with the npm package. If running from source,\n' +
        '  run `pnpm run build:release` in the monorepo root first.',
    );
  }

  copySkills({ agent, which: 'both', skillsRoot, cwd });
  console.log(pc.green('✓') + ` Installed skills → ${SKILL_DEST[agent]}/`);

  const { path, merged } = writeMcpConfig(agent, cwd);
  const rel = path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
  console.log(
    pc.green('✓') + ` ${merged ? 'Updated' : 'Wrote'} MCP servers → ${rel}`,
  );

  const agentsMd = agentsMdSnippet(agent);
  if (agentsMd) console.log(agentsMd);

  if (agent === 'claude') {
    console.log(pc.dim('  Approve the two MCP servers on next Claude Code launch.'));
  }
}

export async function runInit(args: InitArgs): Promise<void> {
  const { cwd, name, baseUrl, agent } = args;
  const port = await registerProject(cwd, name, baseUrl);
  if (agent) setupAgent(cwd, agent);
  console.log(pc.dim(`  Dashboard: http://127.0.0.1:${port}`));
}

function question(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

/** Prompt for the agent. Returns the chosen Agent, or undefined to skip agent setup. */
async function promptAgent(rl: Interface): Promise<Agent | undefined> {
  console.log('');
  console.log('Which coding agent should I set up skills + MCP for?');
  console.log('  1) claude    (Claude Code → .claude/skills + .mcp.json)');
  console.log('  2) codex     (.agents/skills + .codex/config.json)');
  console.log('  3) opencode  (.agents/skills + .opencode/config.json)');
  console.log('  4) cursor    (.agents/skills + .cursor/mcp.json)');
  console.log('  5) skip      (register project only)');
  const choice = (await question(rl, 'Choose [1-5, default 1]: ')).trim();
  switch (choice) {
    case '':
    case '1':
      return 'claude';
    case '2':
      return 'codex';
    case '3':
      return 'opencode';
    case '4':
      return 'cursor';
    case '5':
      return undefined;
    default:
      // Allow typing the agent name directly.
      if ((AGENTS as string[]).includes(choice)) return choice as Agent;
      console.log(pc.yellow('!') + ` Unrecognized choice "${choice}" — defaulting to claude.`);
      return 'claude';
  }
}

/** Parse an --agent flag value into an Agent | undefined (skip), or exit on bad input. */
function parseAgentFlag(value: string): Agent | undefined {
  if (value === 'skip') return undefined;
  if ((AGENTS as string[]).includes(value)) return value as Agent;
  console.error(pc.red('✗') + '  --agent must be: claude | codex | opencode | cursor | skip');
  process.exit(1);
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Register this directory as an OpenUser project and set up your agent')
    .option('--name <name>', 'Project name (skips the prompt)')
    .option('--base-url <url>', 'Base URL of your running app, e.g. http://localhost:3000')
    .option('--agent <agent>', 'Skip the prompt: claude | codex | opencode | cursor | skip')
    .action(async (opts: { name?: string; baseUrl?: string; agent?: string }) => {
      const cwd = process.cwd();
      const defaultName = basename(cwd);

      // Fully non-interactive when name + base-url are both supplied as flags.
      const needsName = opts.name === undefined;
      const needsUrl = opts.baseUrl === undefined;
      const needsAgent = opts.agent === undefined;

      let name = opts.name?.trim() || defaultName;
      let baseUrl = opts.baseUrl?.trim() ?? '';
      let agent: Agent | undefined = needsAgent ? 'claude' : parseAgentFlag(opts.agent as string);

      if (needsName || needsUrl || needsAgent) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          if (needsName) {
            const nameInput = await question(rl, `Project name [${defaultName}]: `);
            name = nameInput.trim() || defaultName;
          }
          if (needsUrl) {
            const urlInput = await question(rl, 'Base URL (e.g. http://localhost:3000): ');
            baseUrl = urlInput.trim();
          }
          if (needsAgent) {
            agent = await promptAgent(rl);
          }
        } finally {
          rl.close();
        }
      }

      if (!baseUrl) {
        console.error(pc.red('✗') + '  Base URL is required (pass --base-url or enter it when prompted)');
        process.exit(1);
      }

      try {
        await runInit(agent ? { cwd, name, baseUrl, agent } : { cwd, name, baseUrl });
      } catch (err) {
        console.error(pc.red('✗') + '  ' + (err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
    });
}
