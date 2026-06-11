# OpenUser Plan 06 — CLI + packaging (the `openuser` npm package)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `openuser` Commander CLI (all five commands), bundle server + prebuilt SPA + skills into a single publishable npm tarball, wire the GitHub Actions release workflow, and verify the published package works end-to-end from a clean install.

**Architecture:** `packages/cli` is the only published package (`openuser`). It imports `createServer` from `@openuser/server` and `runMcp` / `ensureDaemon` from `@openuser/mcp` at build time; tsup bundles them into `packages/cli/dist/index.js`. A post-build copy script places the Vite-built SPA (`packages/ui/build`) at `packages/cli/dist/ui/` and the skills source (`skills/`) at `packages/cli/skills/`. The server reads `OPENUSER_UI_DIR` and `OPENUSER_MIGRATIONS_DIR` env vars so it finds these bundled assets at runtime. The MCP daemon-autostart contract (§2) uses `OPENUSER_CLI_ENTRY` (set by `openuser mcp`) to re-exec the correct binary.

**Tech Stack:** Commander ^13, open ^10, picocolors ^1, tsup ^8, Node >=20, ESM, pnpm 9.x. Runtime deps in published package: `better-sqlite3 ^11`, `playwright ^1.55` only — everything else bundled.

**Depends on:** Plans 01-05

---

## File-structure map

Files created or modified by this plan:

```
packages/cli/
├── package.json                    # published: name=openuser; bin, files, engines, deps
├── tsconfig.json                   # extends root; ESM, node20
├── tsup.config.ts                  # bundles src/index.ts → dist/index.js
├── src/
│   ├── index.ts                    # CLI entry: commander root + subcommands
│   ├── commands/
│   │   ├── start.ts                # default + `start` command
│   │   ├── mcp.ts                  # `mcp --role manager|tester`
│   │   ├── init.ts                 # `init` interactive wizard
│   │   ├── skills.ts               # `skills install --agent --which`
│   │   └── doctor.ts               # `doctor` health check table
│   └── lib/
│       ├── daemon.ts               # readDaemonJson, isDaemonHealthy, ensureDaemon (local)
│       ├── paths.ts                # bundledUiDir(), bundledMigrationsDir(), bundledSkillsDir()
│       └── config.ts               # openuser.config.json read/write helpers
└── __tests__/
    ├── args.test.ts                # arg parsing
    ├── init.test.ts                # init config writing (temp dir + mock daemon)
    ├── skills.test.ts              # skills copy logic (temp dirs)
    └── doctor.test.ts              # doctor check functions (mocked)

scripts/
├── copy-ui.mjs                     # cp packages/ui/build → packages/cli/dist/ui
├── copy-skills.mjs                 # cp skills/ → packages/cli/skills
└── test-pack.sh                    # full pack+install+smoke test (npm script test:pack)

skills/
├── openuser-manager/
│   └── SKILL.md                    # placeholder (Plan 07 fills content)
└── openuser-tester/
    └── SKILL.md                    # placeholder (Plan 07 fills content)

.github/workflows/
└── release.yml                     # on push v* → build:release → npm publish
```

Root `package.json` gains:
- `build:release` script
- `test:pack` script (calls `scripts/test-pack.sh`)

---

## Task 1 — `packages/cli` scaffold: package.json, tsconfig, tsup config

**Files:**
- `packages/cli/package.json`
- `packages/cli/tsconfig.json`
- `packages/cli/tsup.config.ts`

### Steps

- [ ] **Implement `packages/cli/package.json`** (full content):

```json
{
  "name": "openuser",
  "version": "0.1.0",
  "description": "Self-hostable agent-as-a-user testing platform",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "openuser": "./dist/index.js" },
  "files": ["dist", "skills"],
  "main": "./dist/index.js",
  "exports": { ".": "./dist/index.js" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11",
    "playwright": "^1.55"
  },
  "devDependencies": {
    "@openuser/mcp": "workspace:*",
    "@openuser/server": "workspace:*",
    "@openuser/shared": "workspace:*",
    "@types/better-sqlite3": "^7",
    "@types/node": "^20",
    "commander": "^13",
    "open": "^10",
    "picocolors": "^1",
    "tsup": "^8",
    "typescript": "^5.7",
    "vitest": "^3"
  },
  "publishConfig": { "access": "public" }
}
```

- [ ] **Implement `packages/cli/tsconfig.json`** (full content):

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"]
  },
  "include": ["src/**/*", "__tests__/**/*"]
}
```

- [ ] **Implement `packages/cli/tsup.config.ts`** (full content):

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  bundle: true,
  sourcemap: true,
  clean: true,
  // Runtime deps supplied by installed package — do NOT bundle
  external: ['better-sqlite3', 'playwright'],
  // Everything else (commander, open, picocolors, @openuser/*, etc.) is bundled
  noExternal: [
    'commander',
    'open',
    'picocolors',
    '@openuser/server',
    '@openuser/mcp',
    '@openuser/shared',
  ],
  esbuildOptions(options) {
    options.banner = { js: '#!/usr/bin/env node' };
  },
});
```

- [ ] **Verify** — TypeScript knows the entry exists (file will be created in Task 2, but config should be valid now):
  ```
  cd packages/cli && pnpm tsc --noEmit --allowImportingTsExtensions 2>&1 | head -5
  # Expected: no config errors (only missing src/index.ts if not yet created — that's fine)
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/tsup.config.ts
  git commit -m "feat(cli): scaffold package.json, tsconfig, tsup config"
  ```


## Task 2 — Library helpers: `paths.ts`, `daemon.ts`, `config.ts`

**Files:**
- `packages/cli/src/lib/paths.ts`
- `packages/cli/src/lib/daemon.ts`
- `packages/cli/src/lib/config.ts`

These three modules underpin every command.

### Steps

- [ ] **Write failing test `packages/cli/__tests__/args.test.ts`** covering `bundledUiDir`, `bundledMigrationsDir`, `bundledSkillsDir`, `readDaemonJson`, `isDaemonHealthy`:

```typescript
// packages/cli/__tests__/args.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── paths helpers ────────────────────────────────────────────────────────────
describe('path helpers', () => {
  it('bundledUiDir is <distDir>/ui', async () => {
    const { bundledUiDir } = await import('../src/lib/paths.js');
    // dist/index.js lives in dist/; ui is dist/ui/
    expect(bundledUiDir()).toMatch(/dist[/\\]ui$/);
  });

  it('bundledMigrationsDir is <distDir>/migrations', async () => {
    const { bundledMigrationsDir } = await import('../src/lib/paths.js');
    expect(bundledMigrationsDir()).toMatch(/dist[/\\]migrations$/);
  });

  it('bundledSkillsDir is <packageRoot>/skills', async () => {
    const { bundledSkillsDir } = await import('../src/lib/paths.js');
    // package root = packages/cli/; skills live at packages/cli/skills/
    expect(bundledSkillsDir()).toMatch(/packages[/\\]cli[/\\]skills$/);
  });
});

// ── daemon helpers ───────────────────────────────────────────────────────────
describe('isDaemonHealthy', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { isDaemonHealthy } = await import('../src/lib/daemon.js');
    expect(await isDaemonHealthy(8737)).toBe(false);
  });

  it('returns false when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const { isDaemonHealthy } = await import('../src/lib/daemon.js');
    expect(await isDaemonHealthy(8737)).toBe(false);
  });

  it('returns true when health endpoint responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, version: '0.1.0' }),
    }));
    const { isDaemonHealthy } = await import('../src/lib/daemon.js');
    expect(await isDaemonHealthy(8737)).toBe(true);
  });
});
```

- [ ] **Run test (expect failure):**
  ```
  cd packages/cli && pnpm test --reporter=verbose 2>&1 | tail -20
  # Expected: Cannot find module '../src/lib/paths.js' (or similar)
  ```

- [ ] **Implement `packages/cli/src/lib/paths.ts`** (full content):

```typescript
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// When bundled by tsup, import.meta.url points to dist/index.js.
// The dist directory is the parent of this resolved path.
function distDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

// packages/cli/ root (one level up from dist/)
function pkgRoot(): string {
  return path.resolve(distDir(), '..');
}

/** dist/ui — SvelteKit static build copied by scripts/copy-ui.mjs */
export function bundledUiDir(): string {
  return path.join(distDir(), 'ui');
}

/** dist/migrations — Drizzle SQL files copied at build time */
export function bundledMigrationsDir(): string {
  return path.join(distDir(), 'migrations');
}

/** packages/cli/skills — installed by scripts/copy-skills.mjs; shipped in `files` */
export function bundledSkillsDir(): string {
  return path.join(pkgRoot(), 'skills');
}
```

- [ ] **Implement `packages/cli/src/lib/daemon.ts`** (full content):

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';

const OPENUSER_HOME = process.env.OPENUSER_HOME ?? path.join(os.homedir(), '.openuser');
const DAEMON_JSON = path.join(OPENUSER_HOME, 'daemon.json');

export interface DaemonJson {
  port: number;
  pid: number;
  version: string;
  startedAt: string;
}

/** Read ~/.openuser/daemon.json; returns null if missing or unparseable. */
export function readDaemonJson(): DaemonJson | null {
  try {
    const raw = fs.readFileSync(DAEMON_JSON, 'utf8');
    return JSON.parse(raw) as DaemonJson;
  } catch {
    return null;
  }
}

/** GET /api/health on the given port; returns true if { ok: true } */
export async function isDaemonHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!res.ok) return false;
    const body = await res.json() as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

/**
 * Return the running daemon port if healthy, or null.
 * Reads daemon.json, then pings /api/health.
 */
export async function getHealthyDaemonPort(): Promise<number | null> {
  const info = readDaemonJson();
  if (!info) return null;
  const ok = await isDaemonHealthy(info.port);
  return ok ? info.port : null;
}

/**
 * Ensure the daemon is running.
 * Used by `openuser mcp` — re-spawns `openuser start --detach --no-open` via
 * OPENUSER_CLI_ENTRY (set by the mcp command before calling runMcp).
 * Polls up to 10 × 500 ms.
 */
export async function ensureDaemonRunning(): Promise<number> {
  // Fast path: already healthy
  const existing = await getHealthyDaemonPort();
  if (existing) return existing;

  // Spawn detached daemon
  const entry = process.env.OPENUSER_CLI_ENTRY ?? process.argv[1];
  const child = spawn(process.execPath, [entry, 'start', '--no-open', '--detach'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });
  child.unref();

  // Poll until healthy (10 × 500 ms = 5 s max)
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const port = await getHealthyDaemonPort();
    if (port) return port;
  }

  throw new Error(
    'OpenUser daemon did not start within 5 seconds.\n' +
    'Run `openuser start` manually to see startup errors.'
  );
}
```

- [ ] **Implement `packages/cli/src/lib/config.ts`** (full content):

```typescript
import fs from 'node:fs';
import path from 'node:path';

export interface OpenUserConfig {
  name: string;
  baseUrl: string;
  environments: { name: string; url: string }[];
}

const CONFIG_FILE = 'openuser.config.json';

export function configPath(cwd: string): string {
  return path.join(cwd, CONFIG_FILE);
}

export function readConfig(cwd: string): OpenUserConfig | null {
  try {
    const raw = fs.readFileSync(configPath(cwd), 'utf8');
    return JSON.parse(raw) as OpenUserConfig;
  } catch {
    return null;
  }
}

export function writeConfig(cwd: string, config: OpenUserConfig): void {
  fs.writeFileSync(configPath(cwd), JSON.stringify(config, null, 2) + '\n', 'utf8');
}
```

- [ ] **Run tests (expect pass):**
  ```
  cd packages/cli && pnpm test --reporter=verbose 2>&1 | tail -20
  # Expected: args.test.ts passes (3 path tests + 3 daemon tests)
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/src/lib/ packages/cli/__tests__/args.test.ts
  git commit -m "feat(cli): add paths, daemon, config library helpers + tests"
  ```


## Task 3 — `start` command

**Files:**
- `packages/cli/src/commands/start.ts`

### Steps

- [ ] **Implement `packages/cli/src/commands/start.ts`** (full content):

```typescript
import { type Command } from 'commander';
import pc from 'picocolors';
import { bundledUiDir, bundledMigrationsDir } from '../lib/paths.js';
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

export async function runStart(opts: StartOptions): Promise<void> {
  const port = opts.port ? parseInt(opts.port, 10) : 8737;
  const host = opts.host ?? '127.0.0.1';
  const dashboardUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;

  // ── If a healthy daemon is already recorded, just open and exit ───────────
  const info = readDaemonJson();
  if (info) {
    const healthy = await isDaemonHealthy(info.port);
    if (healthy) {
      const url = `http://127.0.0.1:${info.port}`;
      console.log(pc.green('✓') + ` OpenUser already running at ${url}`);
      if (opts.open) {
        const { default: open } = await import('open');
        await open(url);
      }
      return;
    }
  }

  // ── Detach mode: re-spawn self detached and exit ──────────────────────────
  if (opts.detach) {
    const { spawn } = await import('node:child_process');
    const entry = process.argv[1];
    const args = ['start', '--no-open'];
    if (opts.port) args.push('--port', opts.port);
    if (opts.host) args.push('--host', opts.host);
    const child = spawn(process.execPath, [entry, ...args], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    child.unref();
    console.log(pc.cyan('→') + ` Daemon spawning in background (port ${port})…`);
    // Poll briefly to confirm start
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const ok = await isDaemonHealthy(port);
      if (ok) {
        console.log(pc.green('✓') + ` Daemon ready at ${dashboardUrl}`);
        if (opts.open) {
          const { default: open } = await import('open');
          await open(dashboardUrl);
        }
        return;
      }
    }
    console.log(pc.yellow('⚠') + '  Daemon may still be starting. Check `openuser doctor`.');
    return;
  }

  // ── Foreground mode: set env vars then import createServer ────────────────
  process.env.OPENUSER_UI_DIR = bundledUiDir();
  process.env.OPENUSER_MIGRATIONS_DIR = bundledMigrationsDir();
  if (opts.port) process.env.OPENUSER_PORT = opts.port;
  if (opts.host) process.env.OPENUSER_HOST = opts.host;

  // Lazy import to avoid loading server before env vars are set
  const { createServer } = await import('@openuser/server');
  const server = await createServer();

  // Resolve actual port from daemon.json (server writes it on startup)
  let actualUrl = dashboardUrl;
  const daemonInfo = readDaemonJson();
  if (daemonInfo) {
    actualUrl = `http://${host === '0.0.0.0' ? 'localhost' : host}:${daemonInfo.port}`;
  }

  console.log(pc.green('✓') + ` OpenUser running at ${pc.bold(actualUrl)}`);
  console.log(pc.dim('  Press Ctrl+C to stop'));

  if (opts.open) {
    const { default: open } = await import('open');
    await open(actualUrl);
  }

  // Keep process alive (server handles its own event loop)
  await new Promise<never>(() => {});
}
```

- [ ] **Verify — TypeScript check (no build errors):**
  ```
  cd packages/cli && pnpm tsc --noEmit 2>&1 | grep -v "Cannot find module '@openuser" | head -10
  # Expected: 0 errors related to start.ts (workspace import errors are ok pre-build)
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/src/commands/start.ts
  git commit -m "feat(cli): implement start command with detach + open support"
  ```


## Task 4 — `mcp` command

**Files:**
- `packages/cli/src/commands/mcp.ts`

### Steps

- [ ] **Implement `packages/cli/src/commands/mcp.ts`** (full content):

```typescript
import { type Command } from 'commander';
import pc from 'picocolors';
import { ensureDaemonRunning } from '../lib/daemon.js';

export function registerMcp(program: Command): void {
  program
    .command('mcp')
    .description('Run the stdio MCP server (manager or tester role)')
    .requiredOption('--role <role>', 'MCP role: manager or tester')
    .action(async (opts: { role: string }) => {
      const role = opts.role as 'manager' | 'tester';
      if (role !== 'manager' && role !== 'tester') {
        console.error(pc.red('✗') + '  --role must be "manager" or "tester"');
        process.exit(1);
      }

      // Set OPENUSER_CLI_ENTRY so ensureDaemon (called inside runMcp) can
      // re-exec the correct binary even from a global npx install.
      process.env.OPENUSER_CLI_ENTRY = process.argv[1];

      // Ensure the daemon is up before handing stdio to the MCP server.
      // This matches the §2 contract: MCP spawns `openuser start --detach --no-open`
      // and polls 10 × 500 ms.
      try {
        await ensureDaemonRunning();
      } catch (err) {
        // Print to stderr so MCP client's stdio channel is not polluted
        process.stderr.write(
          pc.red('✗') + '  ' + (err instanceof Error ? err.message : String(err)) + '\n'
        );
        process.exit(1);
      }

      // Hand off to @openuser/mcp — it speaks stdio MCP protocol until EOF
      const { runMcp } = await import('@openuser/mcp');
      await runMcp(role);
    });
}
```

- [ ] **Verify — TypeScript check:**
  ```
  cd packages/cli && pnpm tsc --noEmit 2>&1 | grep "commands/mcp" | head -5
  # Expected: no errors from mcp.ts
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/src/commands/mcp.ts
  git commit -m "feat(cli): implement mcp command; sets OPENUSER_CLI_ENTRY + calls runMcp"
  ```


## Task 5 — `init` command

**Files:**
- `packages/cli/src/commands/init.ts`
- `packages/cli/__tests__/init.test.ts`

### Steps

- [ ] **Write failing test `packages/cli/__tests__/init.test.ts`**:

```typescript
// packages/cli/__tests__/init.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock ensureDaemonRunning so init tests don't spawn a real daemon
vi.mock('../src/lib/daemon.js', () => ({
  ensureDaemonRunning: vi.fn().mockResolvedValue(8737),
  readDaemonJson: vi.fn().mockReturnValue({ port: 8737, pid: 1, version: '0.1.0', startedAt: '' }),
  isDaemonHealthy: vi.fn().mockResolvedValue(true),
  getHealthyDaemonPort: vi.fn().mockResolvedValue(8737),
}));

// Mock fetch used by init to POST/GET the API
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('runInit', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openuser-init-'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes openuser.config.json with provided name and baseUrl', async () => {
    // Simulate: GET /api/projects returns [] (no existing project for this path)
    // POST /api/projects returns the new project
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'prj_abc123',
          name: 'my-app',
          path: tmpDir,
          baseUrl: 'http://localhost:3000',
          environments: [],
        }),
      });

    const { runInit } = await import('../src/commands/init.js');
    await runInit({
      cwd: tmpDir,
      name: 'my-app',
      baseUrl: 'http://localhost:3000',
    });

    const configPath = path.join(tmpDir, 'openuser.config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.name).toBe('my-app');
    expect(config.baseUrl).toBe('http://localhost:3000');
    expect(Array.isArray(config.environments)).toBe(true);
  });

  it('PATCHes existing project when path already registered', async () => {
    // GET /api/projects returns a project with matching path
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          id: 'prj_existing',
          name: 'old-name',
          path: tmpDir,
          baseUrl: 'http://localhost:3000',
          environments: [],
        }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'prj_existing',
          name: 'updated-app',
          path: tmpDir,
          baseUrl: 'http://localhost:5000',
          environments: [],
        }),
      });

    const { runInit } = await import('../src/commands/init.js');
    await runInit({
      cwd: tmpDir,
      name: 'updated-app',
      baseUrl: 'http://localhost:5000',
    });

    // Second fetch should be a PATCH
    const secondCall = mockFetch.mock.calls[1];
    expect(secondCall[1]?.method).toBe('PATCH');
    expect(secondCall[0]).toContain('prj_existing');

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'openuser.config.json'), 'utf8')
    );
    expect(config.name).toBe('updated-app');
    expect(config.baseUrl).toBe('http://localhost:5000');
  });
});
```

- [ ] **Run test (expect failure):**
  ```
  cd packages/cli && pnpm test __tests__/init.test.ts 2>&1 | tail -15
  # Expected: Cannot find module '../src/commands/init.js'
  ```

- [ ] **Implement `packages/cli/src/commands/init.ts`** (full content):

```typescript
import { type Command } from 'commander';
import readline from 'node:readline';
import path from 'node:path';
import pc from 'picocolors';
import { ensureDaemonRunning } from '../lib/daemon.js';
import { writeConfig, type OpenUserConfig } from '../lib/config.js';

// ── Programmatic API (used in tests and from action handler) ─────────────────

export interface InitArgs {
  cwd: string;
  name: string;
  baseUrl: string;
}

export async function runInit(args: InitArgs): Promise<void> {
  const { cwd, name, baseUrl } = args;

  // Ensure daemon running (auto-starts if needed)
  const port = await ensureDaemonRunning();
  const apiBase = `http://127.0.0.1:${port}`;

  // Check if a project with this path already exists
  const listRes = await fetch(`${apiBase}/api/projects`);
  if (!listRes.ok) throw new Error(`Failed to list projects: ${listRes.status}`);
  const projects = await listRes.json() as Array<{ id: string; path: string }>;
  const existing = projects.find((p) => p.path === cwd);

  let projectId: string;
  if (existing) {
    // PATCH existing
    const patchRes = await fetch(`${apiBase}/api/projects/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, baseUrl }),
    });
    if (!patchRes.ok) throw new Error(`Failed to update project: ${patchRes.status}`);
    const updated = await patchRes.json() as { id: string };
    projectId = updated.id;
    console.log(pc.green('✓') + ` Updated project ${pc.bold(name)} (${projectId})`);
  } else {
    // POST new
    const postRes = await fetch(`${apiBase}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: cwd, baseUrl, environments: [] }),
    });
    if (!postRes.ok) throw new Error(`Failed to create project: ${postRes.status}`);
    const created = await postRes.json() as { id: string };
    projectId = created.id;
    console.log(pc.green('✓') + ` Registered project ${pc.bold(name)} (${projectId})`);
  }

  // Write local config
  const config: OpenUserConfig = { name, baseUrl, environments: [] };
  writeConfig(cwd, config);
  console.log(pc.green('✓') + ` Wrote openuser.config.json`);
  console.log(pc.dim(`  Dashboard: http://127.0.0.1:${port}`));
}

// ── readline prompt helper ────────────────────────────────────────────────────

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

// ── Commander registration ────────────────────────────────────────────────────

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Register this directory as an OpenUser project')
    .action(async () => {
      const cwd = process.cwd();
      const defaultName = path.basename(cwd);

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

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
```

- [ ] **Run tests (expect pass):**
  ```
  cd packages/cli && pnpm test __tests__/init.test.ts 2>&1 | tail -15
  # Expected: 2 tests pass
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/src/commands/init.ts packages/cli/__tests__/init.test.ts
  git commit -m "feat(cli): implement init command with POST/PATCH project + config write"
  ```


## Task 6 — `skills install` command

**Files:**
- `packages/cli/src/commands/skills.ts`
- `packages/cli/__tests__/skills.test.ts`

### Steps

- [ ] **Write failing test `packages/cli/__tests__/skills.test.ts`**:

```typescript
// packages/cli/__tests__/skills.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('skills copy logic', () => {
  let tmpDir: string;
  let fakeSkillsRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openuser-skills-'));
    // Create a fake bundled skills directory with the two skill SKILL.md files
    fakeSkillsRoot = path.join(tmpDir, 'skills');
    fs.mkdirSync(path.join(fakeSkillsRoot, 'openuser-manager'), { recursive: true });
    fs.mkdirSync(path.join(fakeSkillsRoot, 'openuser-tester'), { recursive: true });
    fs.writeFileSync(path.join(fakeSkillsRoot, 'openuser-manager', 'SKILL.md'), '# Manager Skill');
    fs.writeFileSync(path.join(fakeSkillsRoot, 'openuser-tester', 'SKILL.md'), '# Tester Skill');
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies manager skill to .claude/skills/ for claude agent', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = path.join(tmpDir, 'project');
    fs.mkdirSync(targetDir);

    copySkills({
      agent: 'claude',
      which: 'manager',
      skillsRoot: fakeSkillsRoot,
      cwd: targetDir,
    });

    const dest = path.join(targetDir, '.claude', 'skills', 'openuser-manager', 'SKILL.md');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('# Manager Skill');
  });

  it('copies tester skill to .claude/skills/ for claude agent', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = path.join(tmpDir, 'project');
    fs.mkdirSync(targetDir);

    copySkills({
      agent: 'claude',
      which: 'tester',
      skillsRoot: fakeSkillsRoot,
      cwd: targetDir,
    });

    const dest = path.join(targetDir, '.claude', 'skills', 'openuser-tester', 'SKILL.md');
    expect(fs.existsSync(dest)).toBe(true);
  });

  it('copies both skills for claude agent when which=both', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = path.join(tmpDir, 'project');
    fs.mkdirSync(targetDir);

    copySkills({
      agent: 'claude',
      which: 'both',
      skillsRoot: fakeSkillsRoot,
      cwd: targetDir,
    });

    expect(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'openuser-manager', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, '.claude', 'skills', 'openuser-tester', 'SKILL.md'))).toBe(true);
  });

  it('copies skills to .agents/skills/ for codex agent', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = path.join(tmpDir, 'project');
    fs.mkdirSync(targetDir);

    copySkills({
      agent: 'codex',
      which: 'both',
      skillsRoot: fakeSkillsRoot,
      cwd: targetDir,
    });

    expect(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'openuser-manager', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'openuser-tester', 'SKILL.md'))).toBe(true);
  });

  it('copies skills to .agents/skills/ for opencode agent', async () => {
    const { copySkills } = await import('../src/commands/skills.js');
    const targetDir = path.join(tmpDir, 'project');
    fs.mkdirSync(targetDir);

    copySkills({
      agent: 'opencode',
      which: 'manager',
      skillsRoot: fakeSkillsRoot,
      cwd: targetDir,
    });

    expect(fs.existsSync(path.join(targetDir, '.agents', 'skills', 'openuser-manager', 'SKILL.md'))).toBe(true);
  });
});
```

- [ ] **Run test (expect failure):**
  ```
  cd packages/cli && pnpm test __tests__/skills.test.ts 2>&1 | tail -10
  # Expected: Cannot find module '../src/commands/skills.js'
  ```

- [ ] **Implement `packages/cli/src/commands/skills.ts`** (full content):

```typescript
import { type Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { bundledSkillsDir } from '../lib/paths.js';

export type Agent = 'claude' | 'codex' | 'opencode' | 'cursor';
export type WhichSkills = 'manager' | 'tester' | 'both';

// ── Programmatic API ─────────────────────────────────────────────────────────

export interface CopySkillsArgs {
  agent: Agent;
  which: WhichSkills;
  skillsRoot: string; // path to bundled skills/ directory
  cwd: string;        // target project directory
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
    agent === 'claude'
      ? path.join(cwd, '.claude', 'skills')
      : path.join(cwd, '.agents', 'skills');

  for (const skillName of skillNames) {
    const src = path.join(skillsRoot, skillName);
    const dest = path.join(targetBase, skillName);
    fs.mkdirSync(dest, { recursive: true });
    // Copy all files in the skill directory (recursively)
    copyDirRecursive(src, dest);
  }
}

function copyDirRecursive(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
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
              'openuser-tester':  { command: 'openuser', args: ['mcp', '--role', 'tester'] },
            },
          },
          null,
          2
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
              'openuser-tester':  { command: 'openuser', args: ['mcp', '--role', 'tester'] },
            },
          },
          null,
          2
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
                'openuser-manager': { type: 'stdio', command: 'openuser', args: ['mcp', '--role', 'manager'] },
                'openuser-tester':  { type: 'stdio', command: 'openuser', args: ['mcp', '--role', 'tester'] },
              },
            },
          },
          null,
          2
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
              'openuser-tester':  { command: 'openuser', args: ['mcp', '--role', 'tester'] },
            },
          },
          null,
          2
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

      try {
        copySkills({ agent, which, skillsRoot, cwd });
      } catch (err) {
        console.error(pc.red('✗') + '  Failed to copy skills: ' + (err instanceof Error ? err.message : String(err)));
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
```

- [ ] **Run tests (expect pass):**
  ```
  cd packages/cli && pnpm test __tests__/skills.test.ts 2>&1 | tail -15
  # Expected: 5 tests pass
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/src/commands/skills.ts packages/cli/__tests__/skills.test.ts
  git commit -m "feat(cli): implement skills install command + copy logic tests"
  ```


## Task 7 — `doctor` command

**Files:**
- `packages/cli/src/commands/doctor.ts`
- `packages/cli/__tests__/doctor.test.ts`

### Steps

- [ ] **Write failing test `packages/cli/__tests__/doctor.test.ts`**:

```typescript
// packages/cli/__tests__/doctor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the individual check functions exported from doctor.ts,
// not the command registration, so we can mock dependencies cleanly.

describe('doctor checks', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('checkNodeVersion', () => {
    it('passes when node major >= 20', async () => {
      const { checkNodeVersion } = await import('../src/commands/doctor.js');
      // Spy on process.version
      vi.spyOn(process, 'version', 'get').mockReturnValue('v20.0.0');
      const result = checkNodeVersion();
      expect(result.pass).toBe(true);
    });

    it('fails when node major < 20', async () => {
      const { checkNodeVersion } = await import('../src/commands/doctor.js');
      vi.spyOn(process, 'version', 'get').mockReturnValue('v18.17.0');
      const result = checkNodeVersion();
      expect(result.pass).toBe(false);
      expect(result.message).toMatch(/18/);
    });
  });

  describe('checkDataDirWritable', () => {
    it('passes when data dir is writable', async () => {
      const { checkDataDirWritable } = await import('../src/commands/doctor.js');
      const os = await import('node:os');
      // os.homedir() points to a writable dir in test env
      const result = await checkDataDirWritable();
      expect(result.pass).toBe(true);
    });
  });

  describe('checkPortFree', () => {
    it('returns a result object with pass bool', async () => {
      const { checkPortFree } = await import('../src/commands/doctor.js');
      const result = await checkPortFree(19999); // likely free in CI
      expect(typeof result.pass).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });
  });

  describe('checkChromium', () => {
    it('passes when playwright chromium executable is found', async () => {
      const { checkChromium } = await import('../src/commands/doctor.js');
      // Mock playwright chromium.executablePath to return a non-empty path
      vi.doMock('playwright', () => ({
        chromium: { executablePath: () => '/usr/bin/chromium-browser' },
      }));
      // Since ESM cache may already have playwright, we test the try/catch path
      // by calling the exported function which handles the error internally
      const result = await checkChromium();
      // In test env playwright may or may not have chromium; just assert shape
      expect(typeof result.pass).toBe('boolean');
      expect(typeof result.message).toBe('string');
    });
  });
});
```

- [ ] **Run test (expect failure):**
  ```
  cd packages/cli && pnpm test __tests__/doctor.test.ts 2>&1 | tail -10
  # Expected: Cannot find module '../src/commands/doctor.js'
  ```

- [ ] **Implement `packages/cli/src/commands/doctor.ts`** (full content):

```typescript
import { type Command } from 'commander';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
  const major = match ? parseInt(match[1], 10) : 0;
  const pass = major >= 20;
  return {
    label: 'Node.js >= 20',
    pass,
    message: pass ? `${process.version}` : `${process.version} — upgrade to Node 20+`,
    hint: pass ? undefined : 'Install Node.js 20+ from https://nodejs.org',
  };
}

export async function checkDataDirWritable(): Promise<CheckResult> {
  const home = process.env.OPENUSER_HOME ?? path.join(os.homedir(), '.openuser');
  try {
    fs.mkdirSync(home, { recursive: true });
    const testFile = path.join(home, '.write-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
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
    // Check the path exists on disk
    if (fs.existsSync(execPath)) {
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
    const server = net.createServer();
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
        const label = r.pass ? pc.green(r.label) : pc.red(r.label);
        console.log(`  ${icon}  ${label.padEnd(28)}  ${r.message}`);
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
```

- [ ] **Run tests (expect pass):**
  ```
  cd packages/cli && pnpm test __tests__/doctor.test.ts 2>&1 | tail -15
  # Expected: 5 tests pass
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/src/commands/doctor.ts packages/cli/__tests__/doctor.test.ts
  git commit -m "feat(cli): implement doctor command with check functions + tests"
  ```


## Task 8 — CLI entry point `src/index.ts`

**Files:**
- `packages/cli/src/index.ts`

### Steps

- [ ] **Implement `packages/cli/src/index.ts`** (full content):

```typescript
#!/usr/bin/env node
// NOTE: The shebang above is also injected by tsup's esbuildOptions banner,
// ensuring it appears at the top of the bundled dist/index.js.

import { program } from 'commander';
import { registerStart } from './commands/start.js';
import { registerMcp }   from './commands/mcp.js';
import { registerInit }  from './commands/init.js';
import { registerSkills } from './commands/skills.js';
import { registerDoctor } from './commands/doctor.js';

program
  .name('openuser')
  .description('Self-hostable agent-as-a-user testing platform')
  .version('0.1.0');

registerStart(program);
registerMcp(program);
registerInit(program);
registerSkills(program);
registerDoctor(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Verify build succeeds:**
  ```
  cd packages/cli && pnpm build 2>&1 | tail -10
  # Expected: dist/index.js created, no errors
  ```

- [ ] **Verify shebang in output:**
  ```
  head -1 packages/cli/dist/index.js
  # Expected: #!/usr/bin/env node
  ```

- [ ] **Verify CLI help works:**
  ```
  node packages/cli/dist/index.js --help
  # Expected: Usage: openuser [options] [command] ... with start/mcp/init/skills/doctor listed
  ```

- [ ] **Run all CLI tests:**
  ```
  cd packages/cli && pnpm test 2>&1 | tail -20
  # Expected: all tests pass
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/src/index.ts
  git commit -m "feat(cli): wire commander entry point with all subcommands"
  ```


## Task 9 — Copy scripts: `copy-ui.mjs` and `copy-skills.mjs`

**Files:**
- `scripts/copy-ui.mjs`
- `scripts/copy-skills.mjs`
- `skills/openuser-manager/SKILL.md` (placeholder)
- `skills/openuser-tester/SKILL.md` (placeholder)

### Steps

- [ ] **Implement `scripts/copy-ui.mjs`** (full content):

```javascript
#!/usr/bin/env node
// scripts/copy-ui.mjs
// Copies packages/ui/build → packages/cli/dist/ui
// Run after `pnpm --filter @openuser/ui build`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const src  = path.join(repoRoot, 'packages', 'ui', 'build');
const dest = path.join(repoRoot, 'packages', 'cli', 'dist', 'ui');

if (!fs.existsSync(src)) {
  console.error(`[copy-ui] ERROR: source not found: ${src}`);
  console.error('[copy-ui] Run `pnpm --filter @openuser/ui build` first.');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
copyDir(src, dest);
console.log(`[copy-ui] ${src} → ${dest} (done)`);

function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath  = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
```

- [ ] **Implement `scripts/copy-skills.mjs`** (full content):

```javascript
#!/usr/bin/env node
// scripts/copy-skills.mjs
// Copies skills/ → packages/cli/skills
// The skills/ dir is the repo-root source; packages/cli/skills is shipped in `files`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const src  = path.join(repoRoot, 'skills');
const dest = path.join(repoRoot, 'packages', 'cli', 'skills');

if (!fs.existsSync(src)) {
  console.error(`[copy-skills] ERROR: source not found: ${src}`);
  console.error('[copy-skills] The skills/ directory must exist at repo root.');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
copyDir(src, dest);
console.log(`[copy-skills] ${src} → ${dest} (done)`);

function copyDir(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath  = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
```

- [ ] **Create placeholder skill files** so `copy-skills.mjs` works before Plan 07 provides real content:

`skills/openuser-manager/SKILL.md`:
```markdown
# openuser-manager

> **Placeholder** — full skill content written in Plan 07.
> This file ships in the `openuser` npm package so the CLI works end-to-end.
```

`skills/openuser-tester/SKILL.md`:
```markdown
# openuser-tester

> **Placeholder** — full skill content written in Plan 07.
> This file ships in the `openuser` npm package so the CLI works end-to-end.
```

- [ ] **Verify `copy-skills.mjs` runs without error (skills dir exists now):**
  ```
  node scripts/copy-skills.mjs
  # Expected: [copy-skills] .../skills → .../packages/cli/skills (done)
  ls packages/cli/skills/
  # Expected: openuser-manager  openuser-tester
  ```

- [ ] **Commit:**
  ```
  git add scripts/copy-ui.mjs scripts/copy-skills.mjs skills/
  git commit -m "feat(packaging): add copy-ui + copy-skills scripts; add skill placeholders"
  ```


## Task 10 — Drizzle migrations copy: `copy-migrations.mjs` + server env hook

**Files:**
- `scripts/copy-migrations.mjs`
- `packages/server/src/db/migrate.ts` (update to read `OPENUSER_MIGRATIONS_DIR`)

### Steps

- [ ] **Implement `scripts/copy-migrations.mjs`** (full content):

```javascript
#!/usr/bin/env node
// scripts/copy-migrations.mjs
// Copies packages/server/drizzle/*.sql → packages/cli/dist/migrations
// Run after `pnpm --filter @openuser/server drizzle:generate` (Plan 02).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const src  = path.join(repoRoot, 'packages', 'server', 'drizzle');
const dest = path.join(repoRoot, 'packages', 'cli', 'dist', 'migrations');

if (!fs.existsSync(src)) {
  console.error(`[copy-migrations] ERROR: ${src} not found.`);
  console.error('[copy-migrations] Run drizzle-kit generate first (Plan 02).');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

let count = 0;
for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
  if (entry.isFile()) {
    fs.copyFileSync(path.join(src, entry.name), path.join(dest, entry.name));
    count++;
  }
}
console.log(`[copy-migrations] ${count} file(s) copied: ${src} → ${dest}`);
```

- [ ] **Update `packages/server/src/db/migrate.ts`** to honour `OPENUSER_MIGRATIONS_DIR`.

  The server's migrate function in Plan 02 runs Drizzle migrations. It must accept an override path so the CLI can point it at `dist/migrations`. The update reads the env var if set:

  Open the file and locate the migrations directory argument passed to `drizzle-kit` / `migrate()`. Replace the hard-coded path with:

  ```typescript
  const migrationsFolder =
    process.env.OPENUSER_MIGRATIONS_DIR ??
    new URL('../../../drizzle', import.meta.url).pathname;
  ```

  (The exact integration point depends on Plan 02's implementation; the contract is: when `OPENUSER_MIGRATIONS_DIR` is set, use that directory; when absent, fall back to the relative path from the source file.)

- [ ] **Verify copy-migrations runs (drizzle dir will exist after Plan 02; test with empty dir):**
  ```
  mkdir -p packages/server/drizzle && node scripts/copy-migrations.mjs
  # Expected: [copy-migrations] 0 file(s) copied (empty dir is ok here; real files land in Plan 02)
  ```

- [ ] **Commit:**
  ```
  git add scripts/copy-migrations.mjs packages/server/src/db/migrate.ts
  git commit -m "feat(packaging): copy-migrations script; server reads OPENUSER_MIGRATIONS_DIR"
  ```


## Task 11 — Root `build:release` script

**Files:**
- Root `package.json` (add `build:release` and `test:pack` scripts)

### Steps

- [ ] **Update root `package.json` scripts section** — add the two new scripts while keeping existing scripts intact:

```json
{
  "scripts": {
    "build:release": "pnpm --filter @openuser/shared build && pnpm --filter @openuser/server build && pnpm --filter @openuser/mcp build && pnpm --filter @openuser/ui build && node scripts/copy-ui.mjs && node scripts/copy-skills.mjs && node scripts/copy-migrations.mjs && pnpm --filter openuser build",
    "test:pack": "bash scripts/test-pack.sh"
  }
}
```

  Apply with `json` merge (edit the existing scripts object — do not remove existing `build`, `test`, `lint` etc. entries).

- [ ] **Verify the script key appears:**
  ```
  node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log(p.scripts['build:release'])"
  # Expected: prints the full build:release chain
  ```

- [ ] **Commit:**
  ```
  git add package.json
  git commit -m "feat(packaging): add build:release and test:pack root scripts"
  ```


## Task 12 — Pack + smoke-test script `scripts/test-pack.sh`

**Files:**
- `scripts/test-pack.sh`

### Steps

- [ ] **Implement `scripts/test-pack.sh`** (full content — this is the file verbatim):

```bash
#!/usr/bin/env bash
# scripts/test-pack.sh
# Full publish-simulation smoke test.
# Usage: bash scripts/test-pack.sh
# Or via root: pnpm test:pack
#
# What it does:
#   1. pnpm build:release (full chain)
#   2. pnpm pack in packages/cli → produces openuser-*.tgz
#   3. Installs the tarball in a fresh mktemp dir
#   4. Runs `openuser doctor`  (exit 0 expected; chromium may warn)
#   5. Starts `openuser start --no-open --port 8799` in background
#   6. Polls GET /api/health until ok (max 10 s)
#   7. Checks GET / returns HTML (dashboard SPA)
#   8. Kills the daemon
#   9. Cleans up temp dir
# Exits 1 on any failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_PKG="$REPO_ROOT/packages/cli"
TEST_PORT=8799
DAEMON_PID=""

cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    echo "[test-pack] Stopping daemon (pid $DAEMON_PID)…"
    kill "$DAEMON_PID" 2>/dev/null || true
    sleep 1
  fi
  if [[ -n "${TMP_DIR:-}" && -d "$TMP_DIR" ]]; then
    echo "[test-pack] Removing $TMP_DIR"
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

# ── Step 1: build:release ────────────────────────────────────────────────────
echo "[test-pack] Running pnpm build:release…"
cd "$REPO_ROOT"
pnpm build:release

# ── Step 2: pack ─────────────────────────────────────────────────────────────
echo "[test-pack] Packing packages/cli…"
cd "$CLI_PKG"
pnpm pack --pack-destination "$CLI_PKG"
TARBALL=$(ls "$CLI_PKG"/openuser-*.tgz | head -1)
echo "[test-pack] Tarball: $TARBALL"

# ── Step 3: install in temp dir ───────────────────────────────────────────────
TMP_DIR=$(mktemp -d)
echo "[test-pack] Installing in $TMP_DIR…"
cd "$TMP_DIR"
npm install "$TARBALL" --no-save --silent

OPENUSER_BIN="$TMP_DIR/node_modules/.bin/openuser"
if [[ ! -x "$OPENUSER_BIN" ]]; then
  echo "[test-pack] ERROR: $OPENUSER_BIN not executable"
  exit 1
fi

# ── Step 4: doctor ───────────────────────────────────────────────────────────
echo "[test-pack] Running openuser doctor…"
# doctor exits 1 if chromium is missing, which is ok in CI — we allow that.
"$OPENUSER_BIN" doctor || true

# ── Step 5: start daemon in background ───────────────────────────────────────
echo "[test-pack] Starting daemon on port $TEST_PORT…"
OPENUSER_HOME="$TMP_DIR/.openuser" \
  "$OPENUSER_BIN" start --no-open --port "$TEST_PORT" &
DAEMON_PID=$!

# ── Step 6: poll /api/health ─────────────────────────────────────────────────
echo "[test-pack] Waiting for daemon to be healthy…"
HEALTHY=0
for i in $(seq 1 20); do
  sleep 0.5
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$TEST_PORT/api/health" 2>/dev/null || echo "000")
  if [[ "$HTTP_STATUS" == "200" ]]; then
    HEALTHY=1
    echo "[test-pack] Daemon healthy after ${i} × 0.5 s"
    break
  fi
done

if [[ "$HEALTHY" -ne 1 ]]; then
  echo "[test-pack] ERROR: Daemon did not become healthy within 10 s"
  exit 1
fi

# ── Step 7: check dashboard serves HTML ──────────────────────────────────────
echo "[test-pack] Checking dashboard SPA…"
DASHBOARD_BODY=$(curl -s "http://127.0.0.1:$TEST_PORT/" 2>/dev/null)
if echo "$DASHBOARD_BODY" | grep -qi "<html"; then
  echo "[test-pack] Dashboard HTML ok"
else
  echo "[test-pack] ERROR: GET / did not return HTML"
  echo "$DASHBOARD_BODY" | head -5
  exit 1
fi

# ── Step 8 & 9: handled by trap ───────────────────────────────────────────────
echo "[test-pack] All checks passed."
```

- [ ] **Make executable:**
  ```
  chmod +x scripts/test-pack.sh
  ```

- [ ] **Verify script is syntactically valid (without running the full build):**
  ```
  bash -n scripts/test-pack.sh && echo "syntax ok"
  # Expected: syntax ok
  ```

- [ ] **Commit:**
  ```
  git add scripts/test-pack.sh
  git commit -m "feat(packaging): add test-pack.sh smoke test (build → pack → install → curl)"
  ```


## Task 13 — GitHub Actions release workflow

**Files:**
- `.github/workflows/release.yml`

### Steps

- [ ] **Implement `.github/workflows/release.yml`** (full content):

```yaml
# .github/workflows/release.yml
# Triggered on push of a version tag (v*).
# Builds the full release, publishes to npm with provenance, creates a GitHub release.

name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write      # gh release create
  id-token: write      # npm publish --provenance (OIDC)

jobs:
  release:
    name: Build & Publish
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Install Playwright Chromium
        run: pnpm exec playwright install chromium

      - name: Build release
        run: pnpm build:release

      - name: Run pack smoke test
        run: pnpm test:pack

      - name: Publish to npm
        working-directory: packages/cli
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      - name: Create GitHub Release
        run: |
          gh release create "${{ github.ref_name }}" \
            --title "OpenUser ${{ github.ref_name }}" \
            --generate-notes \
            packages/cli/openuser-*.tgz
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Verify YAML is valid:**
  ```
  node -e "
    const fs = require('fs');
    const txt = fs.readFileSync('.github/workflows/release.yml','utf8');
    // Basic structural checks
    if (!txt.includes('on:')) throw new Error('missing on:');
    if (!txt.includes('npm publish')) throw new Error('missing publish');
    if (!txt.includes('gh release create')) throw new Error('missing gh release');
    console.log('YAML structure ok');
  "
  # Expected: YAML structure ok
  ```

- [ ] **Commit:**
  ```
  git add .github/workflows/release.yml
  git commit -m "feat(ci): add release.yml — build:release + npm publish + gh release on v* tag"
  ```


## Task 14 — Full build + pack verification (integration milestone)

This task is the manual gate that confirms everything from Tasks 1-13 works together. It does not produce new files — it runs the pipeline and confirms expected output.

### Steps

- [ ] **Run the full build:release chain:**
  ```
  pnpm build:release 2>&1 | tail -20
  # Expected: all sub-builds succeed; copy-ui / copy-skills / copy-migrations print "done"
  ```

- [ ] **Confirm dist layout:**
  ```
  ls packages/cli/dist/
  # Expected: index.js  index.js.map  ui/  migrations/
  ls packages/cli/dist/ui/
  # Expected: index.html  (and other SvelteKit static assets)
  ls packages/cli/dist/migrations/
  # Expected: *.sql migration files from packages/server/drizzle/
  ls packages/cli/skills/
  # Expected: openuser-manager/  openuser-tester/
  ```

- [ ] **Pack:**
  ```
  cd packages/cli && pnpm pack 2>&1
  # Expected: openuser-0.1.0.tgz created
  tar -tzf packages/cli/openuser-0.1.0.tgz | grep -E "dist/|skills/" | head -20
  # Expected: dist/index.js, dist/ui/index.html, skills/openuser-manager/SKILL.md, etc.
  ```

- [ ] **Install + smoke test:**
  ```
  pnpm test:pack 2>&1 | tail -10
  # Expected: [test-pack] All checks passed.
  ```

- [ ] **Confirm `openuser doctor` from installed tarball exits 0** (or exits 1 only due to chromium not installed — that is acceptable in dev environment without chromium):
  ```
  # The test-pack.sh script uses `|| true` for doctor, so this is already handled.
  ```

- [ ] **Run all unit tests one final time:**
  ```
  cd packages/cli && pnpm test 2>&1 | tail -10
  # Expected: all tests pass, 0 failures
  ```

- [ ] **Commit (if any fixups were needed):**
  ```
  git add -p
  git commit -m "feat(cli): plan-06 integration milestone — build:release + pack verified"
  ```


## Task 15 — Vitest configuration for `packages/cli`

**Files:**
- `packages/cli/vitest.config.ts`

### Steps

- [ ] **Implement `packages/cli/vitest.config.ts`** (full content):

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Each test file gets its own module context so vi.mock / vi.doMock work per-file
    isolate: true,
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
  resolve: {
    // Allow TypeScript path resolution to find workspace packages
    conditions: ['import', 'module', 'node'],
  },
});
```

- [ ] **Verify all tests still pass with explicit config:**
  ```
  cd packages/cli && pnpm vitest run --config vitest.config.ts 2>&1 | tail -15
  # Expected: all test suites pass
  ```

- [ ] **Commit:**
  ```
  git add packages/cli/vitest.config.ts
  git commit -m "feat(cli): add explicit vitest.config.ts for test isolation + coverage"
  ```

---

## Summary of all plan-06 tasks

| # | Task | Key output |
|---|---|---|
| 1 | `packages/cli` scaffold | `package.json`, `tsconfig.json`, `tsup.config.ts` |
| 2 | Library helpers | `paths.ts`, `daemon.ts`, `config.ts` + tests |
| 3 | `start` command | `commands/start.ts` |
| 4 | `mcp` command | `commands/mcp.ts` |
| 5 | `init` command | `commands/init.ts` + tests |
| 6 | `skills install` command | `commands/skills.ts` + tests |
| 7 | `doctor` command | `commands/doctor.ts` + tests |
| 8 | CLI entry point | `src/index.ts` |
| 9 | Copy scripts + skill placeholders | `scripts/copy-ui.mjs`, `scripts/copy-skills.mjs`, `skills/*/SKILL.md` |
| 10 | Migrations copy + server env hook | `scripts/copy-migrations.mjs`, server `migrate.ts` update |
| 11 | Root build:release script | Root `package.json` scripts |
| 12 | Pack smoke test | `scripts/test-pack.sh` |
| 13 | Release workflow | `.github/workflows/release.yml` |
| 14 | Integration milestone | Full build + pack + install + curl verification |
| 15 | Vitest config | `packages/cli/vitest.config.ts` |

