import { type Command } from 'commander';
import {
  mkdirSync,
  readdirSync,
  copyFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import { bundledSkillsDir } from '../lib/paths.js';

export type Agent = 'claude' | 'codex' | 'opencode' | 'cursor';
export type WhichSkills = 'manager' | 'tester' | 'both';

// ── Programmatic API ─────────────────────────────────────────────────────────

export interface CopySkillsArgs {
  agent: Agent;
  which: WhichSkills;
  skillsRoot: string; // path to bundled skills/ directory
  cwd: string; // target project directory
}

/** Copy skill dirs from skillsRoot to the agent-appropriate location in cwd. */
export function copySkills(args: CopySkillsArgs): void {
  const { agent, which, skillsRoot, cwd } = args;

  const skillNames: string[] =
    which === 'both'
      ? ['openuser-manager', 'openuser-tester']
      : which === 'manager'
        ? ['openuser-manager']
        : ['openuser-tester'];

  const targetBase =
    agent === 'claude' ? join(cwd, '.claude', 'skills') : join(cwd, '.agents', 'skills');

  for (const skillName of skillNames) {
    const src = join(skillsRoot, skillName);
    const dest = join(targetBase, skillName);
    mkdirSync(dest, { recursive: true });
    copyDirRecursive(src, dest);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

// ── MCP config snippets ───────────────────────────────────────────────────────

function mcpSnippet(agent: Agent): string {
  switch (agent) {
    case 'claude':
      return [
        pc.bold('Add the MCP servers to Claude Code:'),
        '',
        '  claude mcp add openuser-manager -- openuser mcp --role manager',
        '  claude mcp add openuser-tester  -- openuser mcp --role tester',
        '',
        'Or add to your .claude/settings.json / ~/.claude/settings.json:',
        JSON.stringify(
          {
            mcpServers: {
              'openuser-manager': { command: 'openuser', args: ['mcp', '--role', 'manager'] },
              'openuser-tester': { command: 'openuser', args: ['mcp', '--role', 'tester'] },
            },
          },
          null,
          2,
        ),
      ].join('\n');

    case 'codex':
      return [
        pc.bold('Add to your codex config (codex.json or ~/.codex/config.json):'),
        '',
        JSON.stringify(
          {
            mcpServers: {
              'openuser-manager': { command: 'openuser', args: ['mcp', '--role', 'manager'] },
              'openuser-tester': { command: 'openuser', args: ['mcp', '--role', 'tester'] },
            },
          },
          null,
          2,
        ),
      ].join('\n');

    case 'opencode':
      return [
        pc.bold('Add to your opencode config (~/.config/opencode/config.json):'),
        '',
        JSON.stringify(
          {
            mcp: {
              servers: {
                'openuser-manager': {
                  type: 'stdio',
                  command: 'openuser',
                  args: ['mcp', '--role', 'manager'],
                },
                'openuser-tester': {
                  type: 'stdio',
                  command: 'openuser',
                  args: ['mcp', '--role', 'tester'],
                },
              },
            },
          },
          null,
          2,
        ),
      ].join('\n');

    case 'cursor':
      return [
        pc.bold('Add to your Cursor MCP config (.cursor/mcp.json or ~/.cursor/mcp.json):'),
        '',
        JSON.stringify(
          {
            mcpServers: {
              'openuser-manager': { command: 'openuser', args: ['mcp', '--role', 'manager'] },
              'openuser-tester': { command: 'openuser', args: ['mcp', '--role', 'tester'] },
            },
          },
          null,
          2,
        ),
      ].join('\n');
  }
}

function agentsMdSnippet(agent: Agent): string | null {
  if (agent === 'claude') return null; // claude uses .claude/skills, not AGENTS.md
  return [
    '',
    pc.bold('Add to your AGENTS.md (skill discovery):'),
    '',
    '```markdown',
    '## OpenUser skills',
    '- `.agents/skills/openuser-manager/SKILL.md` — OpenUser manager skill',
    '- `.agents/skills/openuser-tester/SKILL.md`  — OpenUser tester skill',
    '```',
  ].join('\n');
}

// ── Commander registration ────────────────────────────────────────────────────

export function registerSkills(program: Command): void {
  const skills = program.command('skills').description('Manage OpenUser agent skills');

  skills
    .command('install')
    .description('Copy skills and print MCP config for the given agent')
    .requiredOption('--agent <agent>', 'Target agent: claude | codex | opencode | cursor')
    .option('--which <which>', 'Which skills: manager | tester | both', 'both')
    .action((opts: { agent: string; which: string }) => {
      const agent = opts.agent as Agent;
      const which = opts.which as WhichSkills;

      if (!['claude', 'codex', 'opencode', 'cursor'].includes(agent)) {
        console.error(pc.red('✗') + '  --agent must be: claude | codex | opencode | cursor');
        process.exit(1);
      }
      if (!['manager', 'tester', 'both'].includes(which)) {
        console.error(pc.red('✗') + '  --which must be: manager | tester | both');
        process.exit(1);
      }

      const cwd = process.cwd();
      const skillsRoot = bundledSkillsDir();

      if (!existsSync(skillsRoot)) {
        console.error(
          pc.red('✗') +
            `  Skills directory not found: ${skillsRoot}\n` +
            '     Skills are bundled with the npm package. If running from source,\n' +
            '     run `pnpm run build` in the monorepo root first.',
        );
        process.exit(1);
      }

      try {
        copySkills({ agent, which, skillsRoot, cwd });
      } catch (err) {
        console.error(
          pc.red('✗') +
            '  Failed to copy skills: ' +
            (err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
      }

      const installed =
        which === 'both'
          ? ['openuser-manager', 'openuser-tester']
          : which === 'manager'
            ? ['openuser-manager']
            : ['openuser-tester'];

      const destBase = agent === 'claude' ? '.claude/skills' : '.agents/skills';
      for (const name of installed) {
        console.log(pc.green('✓') + ` Installed ${pc.bold(name)} → ${destBase}/${name}/`);
      }

      const agentsMd = agentsMdSnippet(agent);
      if (agentsMd) console.log(agentsMd);

      console.log('');
      console.log(mcpSnippet(agent));
    });
}
