// BISNIS-41 AC2: P0 item 2, `openuser bridge` files kind:finding Multica issues.
// Needs the built CLI (CI runs `pnpm build` before the server tests).
// A fake `multica` on PATH records every call and the content of every --description-file / --content-file.
import { describe, it, expect, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { startHarness, type Harness } from './helpers.js';

const CLI = new URL('../../../cli/dist/index.js', import.meta.url).pathname;

interface Call {
  argv: string[];
  files: string[];
  text: string;
}

function installFakeMultica(dir: string): { binDir: string; calls: () => Call[] } {
  const binDir = join(dir, 'bin');
  const logPath = join(dir, 'calls.jsonl');
  spawnSync('mkdir', ['-p', binDir]);
  writeFileSync(
    join(binDir, 'multica'),
    `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
const files = [];
argv.forEach((a, i) => {
  if (/^--(description|content)-file$/.test(a) && fs.existsSync(argv[i + 1])) files.push(fs.readFileSync(argv[i + 1], 'utf8'));
});
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ argv, files }) + '\\n');
if (argv[0] === 'issue' && argv[1] === 'create') console.log(JSON.stringify({ id: 'iss-' + Date.now() + Math.random(), identifier: 'X-1' }));
else console.log('[]');
`,
  );
  chmodSync(join(binDir, 'multica'), 0o755);
  return {
    binDir,
    calls: () =>
      existsSync(logPath)
        ? readFileSync(logPath, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => {
              const c = JSON.parse(l) as { argv: string[]; files: string[] };
              return { ...c, text: [...c.argv, ...c.files].join('\n') };
            })
        : [],
  };
}

describe('BISNIS-41 acceptance', () => {
  let h: Harness;
  afterEach(async () => {
    await h.close();
  });

  it('AC2 bridge files one kind:finding issue per qualifying fingerprint and comments on re-run', async () => {
    h = await startHarness();
    const dir = mkdtempSync(join(tmpdir(), 'acc-bridge-'));
    const fake = installFakeMultica(dir);

    const mk = async (severity: string, title: string, times: number) => {
      for (let i = 0; i < times; i++) {
        const r = await h.startRun();
        await h.finding(r.token, { type: 'functional', severity, title, description: `desc ${title}`, route: '/x' });
        await h.complete(r.token);
      }
    };
    await mk('critical', 'Crit bug', 1);
    await mk('high', 'High bug', 1);
    await mk('medium', 'Medium rare', 2); // below the 3-occurrence bar
    await mk('medium', 'Medium often', 3); // meets the bar
    await mk('low', 'Low bug', 5); // digest only, never filed

    const env = { ...process.env, OPENUSER_HOME: h.homeDir, PATH: `${fake.binDir}:${process.env['PATH']}` };
    const run = () => spawnSync(process.execPath, [CLI, 'bridge', '--project', h.projectId], { env, encoding: 'utf8' });

    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const creates = fake.calls().filter((c) => c.argv[0] === 'issue' && c.argv[1] === 'create');
    expect(creates).toHaveLength(3);

    const forTitle = (t: string) => creates.find((c) => c.text.includes(t))!;
    const crit = forTitle('Crit bug');
    const high = forTitle('High bug');
    const med = forTitle('Medium often');
    expect(crit.text).toMatch(/\bP1\b/);
    expect(high.text).toMatch(/\bP2\b/);
    expect(med.text).toMatch(/\bP3\b/);
    expect(creates.map((c) => c.text).join('\n')).not.toMatch(/\bP0\b/);
    expect(creates.every((c) => c.text.includes('kind:finding'))).toBe(true);
    expect(creates.map((c) => c.text).join('\n')).not.toContain('Medium rare');
    expect(creates.map((c) => c.text).join('\n')).not.toContain('Low bug');

    // Body: steps, screenshot links, persona, run id, fingerprint.
    const body = crit.files.join('\n');
    expect(body).toMatch(/steps/i);
    expect(body).toMatch(/screenshot/i);
    expect(body).toContain('Alice');
    expect(body).toMatch(/run_[A-Za-z0-9_-]+/);
    expect(body).toMatch(/fingerprint/i);

    // Re-run: nothing new is filed; the existing issues get comments instead.
    const before = fake.calls().length;
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    const after = fake.calls().slice(before);
    expect(after.filter((c) => c.argv[0] === 'issue' && c.argv[1] === 'create')).toHaveLength(0);
    expect(after.filter((c) => c.argv[0] === 'issue' && c.argv[1] === 'comment')).toHaveLength(3);
  });
});
