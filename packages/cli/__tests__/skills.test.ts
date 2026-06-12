import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('skills copy logic', () => {
  let tmpDir: string;
  let fakeSkillsRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openuser-skills-'));
    fakeSkillsRoot = join(tmpDir, 'skills');
    mkdirSync(join(fakeSkillsRoot, 'openuser-manager'), { recursive: true });
    mkdirSync(join(fakeSkillsRoot, 'openuser-tester'), { recursive: true });
    writeFileSync(join(fakeSkillsRoot, 'openuser-manager', 'SKILL.md'), '# Manager Skill');
    writeFileSync(join(fakeSkillsRoot, 'openuser-tester', 'SKILL.md'), '# Tester Skill');
    vi.clearAllMocks();
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies manager skill to .claude/skills/ for claude agent', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = join(tmpDir, 'project');
    mkdirSync(targetDir);
    copySkills({ agent: 'claude', which: 'manager', skillsRoot: fakeSkillsRoot, cwd: targetDir });
    const dest = join(targetDir, '.claude', 'skills', 'openuser-manager', 'SKILL.md');
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, 'utf8')).toBe('# Manager Skill');
  });

  it('copies tester skill to .claude/skills/ for claude agent', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = join(tmpDir, 'project');
    mkdirSync(targetDir);
    copySkills({ agent: 'claude', which: 'tester', skillsRoot: fakeSkillsRoot, cwd: targetDir });
    expect(existsSync(join(targetDir, '.claude', 'skills', 'openuser-tester', 'SKILL.md'))).toBe(true);
  });

  it('copies both skills for claude agent when which=both', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = join(tmpDir, 'project');
    mkdirSync(targetDir);
    copySkills({ agent: 'claude', which: 'both', skillsRoot: fakeSkillsRoot, cwd: targetDir });
    expect(existsSync(join(targetDir, '.claude', 'skills', 'openuser-manager', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(targetDir, '.claude', 'skills', 'openuser-tester', 'SKILL.md'))).toBe(true);
  });

  it('copies skills to .agents/skills/ for codex agent', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = join(tmpDir, 'project');
    mkdirSync(targetDir);
    copySkills({ agent: 'codex', which: 'both', skillsRoot: fakeSkillsRoot, cwd: targetDir });
    expect(existsSync(join(targetDir, '.agents', 'skills', 'openuser-manager', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(targetDir, '.agents', 'skills', 'openuser-tester', 'SKILL.md'))).toBe(true);
  });

  it('copies skills to .agents/skills/ for opencode agent', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = join(tmpDir, 'project');
    mkdirSync(targetDir);
    copySkills({ agent: 'opencode', which: 'manager', skillsRoot: fakeSkillsRoot, cwd: targetDir });
    expect(existsSync(join(targetDir, '.agents', 'skills', 'openuser-manager', 'SKILL.md'))).toBe(true);
  });
});
