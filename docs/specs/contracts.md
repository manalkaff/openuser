# OpenUser v1 — Binding Contracts

This document pins every cross-package interface. **Implementation plans and code MUST match this exactly.** If a plan conflicts with this doc, this doc wins. Spec: `docs/specs/2026-06-11-openuser-v1-design.md`.

## 1. Workspace & versions

pnpm monorepo, TypeScript strict, ESM everywhere.

| Package (dir) | npm name | Published | Purpose |
|---|---|---|---|
| `packages/shared` | `@openuser/shared` | no (bundled) | zod schemas, types, constants |
| `packages/server` | `@openuser/server` | no (bundled) | Hono daemon, Drizzle, runner |
| `packages/mcp` | `@openuser/mcp` | no (bundled) | stdio MCP, both roles |
| `packages/ui` | `@openuser/ui` | no (built into cli) | SvelteKit SPA dashboard |
| `packages/cli` | **`openuser`** | **yes** | commander CLI, bundles all |

Pinned versions (use these in package.json; `^` ranges):
- node `>=20` (engines), pnpm `9.x`, typescript `^5.7`
- hono `^4.7`, `@hono/node-server` `^1.13`, `@hono/node-ws` `^1.0`
- drizzle-orm `^0.44`, drizzle-kit `^0.31`, better-sqlite3 `^11`
- playwright `^1.55` (library, not @playwright/test, for the runner)
- zod `^3.24`, nanoid `^5`, commander `^13`, open `^10`, picocolors `^1`
- `@modelcontextprotocol/sdk` `^1.18`
- svelte `^5` via SvelteKit: `@sveltejs/kit` `^2`, `@sveltejs/adapter-static` `^3` (SPA mode: `ssr=false`, fallback `index.html`), vite `^6`, tailwindcss `^4` (`@import "tailwindcss"` syntax)
- build: tsup `^8` (server/mcp/cli)
- tests: vitest `^3` (unit/integration), `@playwright/test` `^1.55` (dashboard e2e)

Svelte 5 code uses **runes** (`$state`, `$derived`, `$effect`, `$props`). Tailwind 4 uses CSS-first config.

## 2. Filesystem layout (runtime)

Data root: `~/.openuser/` (override: env `OPENUSER_HOME`).

```
~/.openuser/
├─ openuser.db                 # SQLite, WAL
├─ daemon.json                 # {port, pid, version, startedAt} written on daemon start
├─ artifacts/<runId>/
│   ├─ video.webm
│   ├─ steps/<stepIdx>.png     # auto screenshot per action
│   ├─ shots/<nanoid>.png      # on-demand browser_screenshot + finding evidence
│   ├─ console.jsonl           # every console event
│   └─ network.jsonl           # every request/response summary
└─ checkpoints/<checkpointId>/
    ├─ storageState.json       # Playwright storageState
    └─ journey.json            # {notes: string, savedAtStep: number, url: string}
```

Default port **8737**; if busy, increment until free, write actual port to `daemon.json`. Daemon binds `127.0.0.1` (flag `--host` to override). MCP discovers the daemon via `daemon.json` + `GET /api/health`; if unreachable, MCP spawns `openuser start --detach --no-open` and polls health (10 × 500ms backoff).

## 3. IDs, enums, tokens

- IDs: `<prefix>_<nanoid(12)>` — `prj_ per_ chk_ tst_ run_ stp_ fnd_ evt_`.
- Run token: `rt_<nanoid(24)>`, returned once by prepare; only `sha256(token)` stored (`runs.token_hash`). Sent as `Authorization: Bearer rt_...` on all `/api/tester/*` calls. Invalid/expired → 401 `{error}`.
- Enums (exact strings):
  - `RunStatus`: `pending | running | passed | blocked | failed | aborted`
  - `Verdict`: `goal_achieved | blocked | partial`
  - `FindingType`: `functional | console | network | ux_confusion`
  - `Severity`: `critical | high | medium | low`
  - `FindingStatus`: `open | acknowledged | resolved | dismissed`
  - `StepKind`: `begin | navigate | click | type | select | scroll | back | wait | screenshot`
  - `TestSource`: `manual | agent | promoted_from_run`
- Status computation on `complete_run`: `goal_achieved` → `passed` if no open finding with severity `critical|high` else `failed`; `blocked` → `blocked`; `partial` → `failed`. Watchdog/crash → `aborted`/`failed` per spec §10.

## 4. Drizzle schema (authoritative)

`packages/server/src/db/schema.ts` — exact tables/columns:

```ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  baseUrl: text('base_url').notNull(),
  environments: text('environments', { mode: 'json' }).$type<{ name: string; url: string }[]>().notNull().default([]),
  defaultViewport: text('default_viewport', { mode: 'json' }).$type<{ width: number; height: number }>().notNull().default({ width: 1280, height: 720 }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const personas = sqliteTable('personas', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  name: text('name').notNull(),
  role: text('role').notNull(),
  identity: text('identity', { mode: 'json' }).$type<PersonaIdentity>().notNull(),
  behavior: text('behavior', { mode: 'json' }).$type<PersonaBehavior>().notNull(),
  knowledge: text('knowledge', { mode: 'json' }).$type<PersonaKnowledge>().notNull(),
  notes: text('notes'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  personaId: text('persona_id').notNull().references(() => personas.id),
  name: text('name').notNull(),
  description: text('description'),
  storageStatePath: text('storage_state_path').notNull(),
  journey: text('journey', { mode: 'json' }).$type<{ notes: string; savedAtStep: number; url: string }>().notNull(),
  createdFromRunId: text('created_from_run_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const tests = sqliteTable('tests', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  title: text('title').notNull(),
  goal: text('goal').notNull(),
  preconditions: text('preconditions'),
  expectedOutcome: text('expected_outcome'),
  defaultPersonaId: text('default_persona_id'),
  priority: text('priority').$type<'low' | 'medium' | 'high'>().notNull().default('medium'),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default([]),
  source: text('source').$type<TestSource>().notNull().default('manual'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id),
  testId: text('test_id'),                    // NULL = ad-hoc
  adhocGoal: text('adhoc_goal'),
  personaId: text('persona_id').notNull().references(() => personas.id),
  checkpointId: text('checkpoint_id'),
  environmentName: text('environment_name'),
  baseUrlResolved: text('base_url_resolved').notNull(),
  status: text('status').$type<RunStatus>().notNull().default('pending'),
  verdict: text('verdict').$type<Verdict>(),
  summary: text('summary'),
  agentLabel: text('agent_label'),
  tokenHash: text('token_hash').notNull(),
  videoPath: text('video_path'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const steps = sqliteTable('steps', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  idx: integer('idx').notNull(),
  kind: text('kind').$type<StepKind>().notNull(),
  description: text('description').notNull(),
  pageUrl: text('page_url'),
  screenshotPath: text('screenshot_path'),
  status: text('status').$type<'ok' | 'error'>().notNull().default('ok'),
  error: text('error'),
  note: text('note'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const findings = sqliteTable('findings', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  stepId: text('step_id'),
  projectId: text('project_id').notNull().references(() => projects.id),
  type: text('type').$type<FindingType>().notNull(),
  severity: text('severity').$type<Severity>().notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  evidence: text('evidence', { mode: 'json' }).$type<FindingEvidence>().notNull(),
  status: text('status').$type<FindingStatus>().notNull().default('open'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const logEvents = sqliteTable('log_events', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => runs.id),
  stepIdx: integer('step_idx').notNull(),
  kind: text('kind').$type<'console' | 'network'>().notNull(),
  level: text('level'),                 // console: 'error'|'warning' ; network: HTTP status as string or 'failed'
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
});
```

Settings keys: `watchdogMinutes` (default `5`), `headed` (default `false`), `browserChannel` (default `"chromium"`).

## 5. Shared types (`@openuser/shared`)

zod schemas exported with inferred types; names exact:

```ts
PersonaIdentity = { fullName: string; roleLabel: string; credentials?: { username: string; password: string }; signupInstructions?: string; locale: string }
PersonaBehavior = { techSavviness: 'novice'|'average'|'expert'; patience: 'low'|'medium'|'high'; readingStyle: 'skims'|'reads'; device: 'desktop'|'mobile'; viewport: { width: number; height: number }; habits: string }
PersonaKnowledge = { productKnowledge: string; expectations: string; vocabulary: string }
FindingEvidence = { screenshotPath?: string; consoleExcerpt?: unknown[]; networkExcerpt?: { method: string; url: string; status: number|'failed'; bodySnippet?: string }[] }
TesterAction = discriminated union on `kind`:
  { kind:'navigate'; url: string } | { kind:'click'; ref: string } |
  { kind:'type'; ref: string; text: string; submit?: boolean } |
  { kind:'select'; ref: string; value: string } |
  { kind:'scroll'; direction:'up'|'down'; amountPx?: number } |
  { kind:'back' } | { kind:'wait'; seconds: number /* max 30 */ }
PageSnapshot = { url: string; title: string; tree: string }   // tree = a11y outline text with [ref=eN] markers
```

Also exported: all enums (§3), all API request/response schemas (§6), WS event schema (§7), `DEFAULT_PORT = 8737`, id/token helpers.

## 6. REST API (Hono, all JSON)

Manager-facing (no auth in v1):

| Method & path | Body → Response |
|---|---|
| `GET /api/health` | → `{ ok: true, version }` |
| `POST /api/projects` | `{name, path, baseUrl, environments?, defaultViewport?}` → Project |
| `GET /api/projects` | → Project[] (each + `openFindings`, `lastRunAt` aggregates) |
| `GET /api/projects/:id` · `PATCH /api/projects/:id` | partial update |
| `POST /api/projects/:id/personas` · `GET /api/projects/:id/personas` · `PATCH /api/personas/:id` | |
| `POST /api/projects/:id/tests` · `GET /api/projects/:id/tests` · `PATCH /api/tests/:id` | tests GET includes `lastRun: {id,status,finishedAt} \| null` |
| `POST /api/runs` | `{projectId, testId?, adhocGoal?, personaId, checkpointId?, environment?, agentLabel?}` (exactly one of testId/adhocGoal) → `{runId, token, testerPrompt}` |
| `GET /api/runs?projectId&status&limit` | → RunSummary[] |
| `GET /api/runs/:id` | → Run + steps[] + findings[] |
| `GET /api/runs/:id/report` | → `text/markdown` |
| `POST /api/runs/:id/promote` | `{title, priority?, tags?}` → Test (source `promoted_from_run`, goal from adhocGoal/test goal) |
| `GET /api/findings?projectId&severity&type&status` | → Finding[] |
| `PATCH /api/findings/:id` | `{status}` |
| `GET /api/projects/:id/checkpoints` · `DELETE /api/checkpoints/:id` | |
| `GET /api/settings` · `PATCH /api/settings` | |
| `GET /artifacts/<runId>/...` | static files from artifacts dir |

Tester-facing (Bearer run token; 401 on bad/expired; 409 if run not in expected state):

| Method & path | Body → Response |
|---|---|
| `POST /api/tester/begin` | `{}` → `{ personaCard: string, mission: string, journeyNotes?: string, snapshot: PageSnapshot }` |
| `POST /api/tester/snapshot` | `{}` → PageSnapshot |
| `POST /api/tester/action` | `TesterAction & { note?: string }` → `{ ok: true, snapshot: PageSnapshot } \| { ok: false, error, snapshot? }` |
| `POST /api/tester/screenshot` | `{}` → `{ path }` (MCP returns the image content) |
| `POST /api/tester/finding` | `{type, severity, title, description}` → Finding (server auto-attaches stepId + screenshot + last 20 error-level log events) |
| `POST /api/tester/checkpoint` | `{name, description?, journeyNotes}` → Checkpoint |
| `POST /api/tester/complete` | `{verdict, summary}` → `{ status, findings: Finding[] }` |

Errors: non-2xx with `{ error: string }`.

## 7. WebSocket

Endpoint `GET /ws` (`@hono/node-ws`). Client → `{ type:'subscribe', channel: 'global' | 'run:<runId>' }` (multiple allowed). Server → `{ channel, type, payload }` with types:
`run.created | run.updated | step.created | finding.created | log.event | run.completed` (payload = the relevant row; `run.updated` on status change; `log.event` only error-level). Everything sent on its `run:<id>` channel AND `global`.

## 8. Runner interface (server-internal)

`packages/server/src/runner/types.ts` — plan 02 ships `FakeRunner`, plan 03 ships `PlaywrightRunner`, same interface:

```ts
interface RunnerSession {
  begin(opts: { baseUrl: string; viewport: {width:number;height:number}; storageStatePath?: string;
                videoDir: string; headed: boolean;
                onConsole: (e: ConsoleEvent) => void; onNetwork: (e: NetworkEvent) => void }): Promise<PageSnapshot>;
  snapshot(): Promise<PageSnapshot>;
  act(action: TesterAction): Promise<{ snapshot: PageSnapshot; screenshotPath: string; pageUrl: string }>;
  screenshot(dir: string): Promise<{ path: string }>;
  saveStorageState(path: string): Promise<void>;
  close(): Promise<{ videoPath?: string }>;
}
```

Snapshot tree: Playwright `page.accessibility`-style outline rendered as indented text, interactive elements annotated `[ref=eN]`; server keeps `Map<ref, locator>` per run, rebuilt on every snapshot; acting with a stale ref returns the error hint `"page changed — call browser_snapshot again"`.

## 9. MCP tools (names exact)

One binary: `openuser mcp --role manager|tester`. Thin proxy → REST. Tool list:

- **manager**: `register_project, list_projects, create_persona, update_persona, list_personas, create_test, update_test, list_tests, prepare_run, get_run, list_runs, get_findings, update_finding, list_checkpoints, delete_checkpoint, get_report`
- **tester**: `begin_run, browser_snapshot, browser_navigate, browser_click, browser_type, browser_select, browser_scroll, browser_back, browser_wait, browser_screenshot, report_finding, save_checkpoint, complete_run`

Tester MCP takes the token as the `begin_run` argument and caches it in-process for the rest of the session. Input schemas mirror §6 bodies (zod from `@openuser/shared`).

## 10. testerPrompt template (server-generated)

```
You are about to act as a real user of a web application. You have NO knowledge of its codebase.

First: call the `begin_run` tool with token "{{token}}" (openuser tester MCP).
It returns who you are, your mission, and the current page.

Follow your openuser-tester skill strictly: stay in character as the persona at all
times, navigate only by what you can see, report problems and confusion as findings
in the user's voice, save checkpoints after costly setup, and finish with complete_run.

Persona preview: {{personaName}} — {{roleLabel}}.
Mission preview: {{goal}}

Do not read any source code. Do not use any tools other than the openuser tester tools.
```

`personaCard` (returned by begin): markdown rendering of identity+behavior+knowledge. `mission`: test goal + preconditions + expected outcome (or adhocGoal).

## 11. Plan documents

| # | File (docs/plans/) | Builds | Depends on |
|---|---|---|---|
| 01 | `2026-06-11-01-foundation.md` | monorepo scaffold, shared package, CI skeleton | — |
| 02 | `2026-06-11-02-server-core.md` | Drizzle DB, REST, WS, run lifecycle w/ FakeRunner, tokens, watchdog | 01 |
| 03 | `2026-06-11-03-runner.md` | PlaywrightRunner: recording, snapshots/refs, checkpoints, artifacts | 02 |
| 04 | `2026-06-11-04-mcp.md` | both MCP roles, daemon autostart/discovery | 02 (03 for live e2e) |
| 05 | `2026-06-11-05-dashboard.md` | SvelteKit SPA: all pages, live WS run view | 02 |
| 06 | `2026-06-11-06-cli-packaging.md` | CLI commands, SPA+server bundling, npm publish, doctor | 03+04+05 |
| 07 | `2026-06-11-07-skills-demo-readme.md` | both skills, demo-shop, README, full-lifecycle integration test, CI final | all |

Execution order: 01 → 02 → 03 → 04 → 05 → 06 → 07 (04 and 05 may run in parallel after 02/03).

---

## Addenda (post-plan-review)

### A1. LogEvent type (§5 addition)

`LogEvent` is defined in `@openuser/shared` alongside the other shared types. Add `LogEventSchema` to `packages/shared/src/types.ts` and export it from `packages/shared/src/index.ts`:

```ts
export const LogEventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stepIdx: z.number().int(),
  kind: z.enum(['console', 'network']),
  level: z.string().nullable(),   // 'error'|'warning' for console; HTTP status string or 'failed' for network
  payload: z.record(z.unknown()),
  createdAt: z.number(),          // timestamp ms
});
export type LogEvent = z.infer<typeof LogEventSchema>;
```

### A2. GET /api/runs/:id/events (§6 addition)

New manager REST route (add to §6 manager table):

| Method | Path | Auth | Body/Params | Response |
|--------|------|------|-------------|----------|
| GET | `/api/runs/:id/events` | session | — | `LogEvent[]` |

Handler: `SELECT * FROM log_events WHERE run_id = :id ORDER BY created_at ASC`. Plan 05 implements this route and its Vitest test in `packages/server`.

### A3. Screenshot path format

`POST /api/tester/screenshot` and the auto-screenshot in `POST /api/tester/finding` return `{ path: string }` where **path is relative to the artifacts root**, e.g. `run_abc123/shots/xYznanoid.png`. The MCP `browser_screenshot` tool fetches the image at `GET /artifacts/<path>` (i.e. `${baseUrl}/artifacts/${result.path}`). Implementations must NOT return absolute filesystem paths.

### A4. MCP tool inputs mirror §6 REST bodies

MCP tool input schemas (§9) mirror the corresponding §6 REST request bodies exactly, using zod schemas from `@openuser/shared`. In particular, `prepare_run` includes `projectId: z.string()` in its input schema, matching `POST /api/runs` body.

### A5. browserChannel routing

`PlaywrightRunner` reads `browserChannel` from the settings service directly (via `SettingsService.get()`); it is not a field on the `RunnerSession.begin()` opts object. The `RunnerSession` interface (§8) is unchanged. Plan 03 wires this internally in `PlaywrightRunner.begin()`.

### A6. ConsoleEvent and NetworkEvent canonical shapes

The canonical `ConsoleEvent` and `NetworkEvent` shapes (used by both `FakeRunner` in Plan 02 and `PlaywrightRunner` in Plan 03) are:

```ts
export interface ConsoleEvent {
  level: 'log' | 'info' | 'warning' | 'error' | 'debug';
  text: string;
  location?: string;   // "url:line" — optional, Playwright provides this
  stepIdx: number;
  timestamp: number;
}

export interface NetworkEvent {
  kind: 'request' | 'response' | 'failed';
  method: string;
  url: string;
  status?: number;         // present on 'response'
  resourceType: string;
  bodySnippet?: string;    // present for failed JSON/api responses only
  stepIdx: number;
  timestamp: number;
}
```

`LogPipelineService.handleConsole` filters on `event.level === 'error'`; `handleNetwork` filters on `event.kind === 'failed'` or `event.kind === 'response' && event.status >= 400`.
