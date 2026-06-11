# OpenUser v1 — Design Spec

**Date:** 2026-06-11
**Status:** Approved by owner, pending implementation plan
**License:** MIT
**npm package:** `openuser` (verified available 2026-06-11)

## 1. Product definition

OpenUser is an open-source, self-hostable "agent as a user" testing platform — an alternative to TestSprite that runs entirely on your machine.

A coding agent (Claude Code, Codex, opencode, Cursor — any MCP-capable harness) summons **tester subagents** that embody **user personas** and use your running web app like real humans: no code context, no developer knowledge. They pursue goals ("buy a product with bank transfer"), and when something breaks or confuses them they **escalate findings** (functional errors, console/network errors, UX confusion) to a local **dashboard**. Runs are fully recorded: video, per-step screenshots, console, network.

**Motivation:** "agent as a user, so I don't have to test anymore." The human reviews findings, not flows.

### Differentiators vs TestSprite (confirmed gaps in their docs)

| Feature | TestSprite | OpenUser |
|---|---|---|
| Self-hosted / offline | ✗ (cloud-only) | ✓ `npx openuser` |
| User personas (multiple named profiles) | ✗ (single credential set) | ✓ first-class |
| Checkpoints (session + journey resume) | ✗ | ✓ first-class |
| UX-confusion findings (subjective, user-voice) | ✗ | ✓ signature feature |
| Console + network viewer in dashboard | ✗ | ✓ per-step |
| Agentic every run (catches UX issues) | ✗ (generated scripts) | ✓ always agentic |
| Dashboard fully drivable via MCP | partial | ✓ everything UI does, MCP does |
| Open source | ✗ | ✓ MIT |

### v1 non-goals (roadmap, not scope)

Scheduling/cron, webhooks/email notifications, raw API testing mode (no UI), visual/a11y finding types, auto-heal, multi-user auth/RBAC, cloud execution, GitHub PR integration, built-in BYO-key agent loop (v1 brain is always the coding agent), Docker browser isolation, kanban/orchestrator integration (out of scope by owner decision — OpenUser only returns structured results that an external orchestrator can consume).

## 2. Architecture (decided: central daemon, thin MCPs)

```
┌────────────────────────────────────────────────────────────┐
│ Coding agent (Claude Code / Codex / opencode / Cursor)     │
│  ├─ manager skill + manager MCP   (has code context)       │
│  └─ summons tester subagents                               │
│       └─ tester skill + tester MCP  (NO code context)      │
└──────────────┬─────────────────────────────────────────────┘
               │ stdio MCP → localhost HTTP (run-scoped tokens)
┌──────────────▼─────────────────────────────────────────────┐
│ openuser daemon (`npx openuser`, default port 8737)        │
│  ├─ Hono REST API + WebSocket (live run events)            │
│  ├─ Runner: Playwright Chromium, one BrowserContext/run    │
│  │   · video, per-action screenshot, console, network      │
│  │   · a11y-snapshot page interface with element refs      │
│  ├─ SQLite (Drizzle ORM + better-sqlite3, WAL mode)        │
│  └─ serves prebuilt Svelte 5 SPA (dashboard)               │
└──────────────┬─────────────────────────────────────────────┘
               │ ~/.openuser/
               ├─ openuser.db
               ├─ artifacts/<runId>/   video.webm, steps/*.png,
               │                       console.jsonl, network.jsonl
               └─ checkpoints/<id>/    storageState.json, journey.json
```

Key decisions and rationale:

- **The brain is the coding agent** (v1). OpenUser provides context, tools, recording, storage, and UI — not LLM inference. No API keys needed to run OpenUser itself. Multi-provider own-loop is roadmap (Vercel AI SDK chosen for when it lands).
- **Browser lives in the daemon**, never in the MCP process. Recording survives agent crashes; runs stream live to the dashboard; N concurrent testers share one daemon (single SQLite writer, no contention).
- **Always agentic runs.** Every run is a live agent thinking like a user. Each run stores its step trace, enabling a future replay mode without changing the schema.
- **One npm package** (promptfoo distribution pattern): CLI + server + prebuilt SPA bundled. Truly offline. Data global at `~/.openuser/` (multi-project dashboard, repo stays clean); an optional committable `openuser.config.json` per repo carries project defaults (name, baseUrl, environments) for instant team setup.
- **Run launch = copy-prompt** (v1). Dashboard "Run" button generates the exact prompt/command to paste into any agent. No process spawning by the daemon in v1 (roadmap: spawn configured agent CLI headless).
- **Browser-only, full-stack signals.** The agent acts only through the UI, but console + every network request/response is captured and attributed to the causing step — backend failures surface as the user experiences them.

## 3. CLI (`openuser` package, Node >= 20)

| Command | Behavior |
|---|---|
| `npx openuser` / `openuser start` | Start daemon (if not running) + open dashboard in browser. `--port`, `--no-open`, `--detach` flags. |
| `openuser mcp --role manager\|tester` | Run the thin stdio MCP server. Auto-spawns the daemon (detached) if not reachable; retries; otherwise instructive error. |
| `openuser init` | Register the cwd as a project (interactive: name, base URL); writes `openuser.config.json`. |
| `openuser skills install --agent claude\|codex\|opencode\|cursor` | Copy the two skills to the agent-appropriate location (e.g. `.claude/skills/`, `AGENTS.md` snippet) and print the matching MCP config to add. |
| `openuser doctor` | Check Node version, Playwright browser installed (offer `npx playwright install chromium`), port free, data dir writable. |

First run: create `~/.openuser/`, run Drizzle migrations, prompt to install the Playwright Chromium browser if missing.

## 4. Data model (SQLite, Drizzle)

All ids are prefixed nanoids (`prj_`, `per_`, `chk_`, `tst_`, `run_`, `stp_`, `fnd_`).

- **projects** — `id, name, path (unique), base_url, environments JSON [{name,url}], default_viewport JSON, created_at`
- **personas** — `id, project_id FK, name, role, identity JSON, behavior JSON, knowledge JSON, notes, archived, created_at`
  - `identity`: full name, role label (e.g. "reseller", "first-time buyer"), credentials `{username,password}` or signup instructions, locale/language
  - `behavior`: tech_savviness (novice/average/expert), patience (low/medium/high), reading_style (skims/reads), device + viewport (mobile/desktop dims), habits/goals free text
  - `knowledge`: what they already know about the product, expectations, domain vocabulary they'd use
- **checkpoints** — `id, project_id FK, persona_id FK, name, description, storage_state_path, journey JSON (free-form progress notes), created_from_run_id, created_at`
- **tests** — `id, project_id FK, title, goal (natural-language mission), preconditions, expected_outcome, default_persona_id FK?, priority (low/med/high), tags JSON, source (manual/agent/promoted_from_run), archived, created_at`
- **runs** — `id, project_id FK, test_id FK NULL (NULL = ad-hoc), adhoc_goal NULL, persona_id FK, checkpoint_id FK?, environment_name, base_url_resolved, status (pending/running/passed/blocked/failed/aborted), verdict (goal_achieved/blocked/partial) NULL, summary TEXT, agent_label, token_hash, started_at, finished_at, video_path`
- **steps** — `id, run_id FK, idx, kind (navigate/click/type/select/scroll/back/wait/screenshot/snapshot), description, page_url, screenshot_path, status (ok/error), error TEXT?, note (tester's optional in-character thought), duration_ms, created_at`
- **findings** — `id, run_id FK, step_id FK?, project_id FK (denormalized for inbox), type (functional/console/network/ux_confusion), severity (critical/high/medium/low), title, description (user-voice narrative), evidence JSON (screenshot path, console excerpt, network excerpt {method,url,status,body_snippet}), status (open/acknowledged/resolved/dismissed), created_at`
- **log_events** — error-level console entries and failed (4xx/5xx/network-error) requests only: `id, run_id FK, step_idx, kind (console/network), level/status, payload JSON, created_at`. Full streams live in `console.jsonl` / `network.jsonl` artifacts; this table powers querying, step-linking, and auto-evidence.
- **settings** — key/value (dashboard prefs, watchdog timeout, browser channel, headed default).

## 5. Run lifecycle

1. **Prepare** — manager calls `prepare_run` (testId or `adhocGoal`, personaId, checkpointId?, environment?). Daemon creates `run` (status `pending`), generates a one-time scoped token, and returns `{runId, token, testerPrompt}`. `testerPrompt` is **server-generated from templates + DB data only** — by construction it cannot leak code context. It embeds the token, persona card, mission, and tester-skill reminder.
2. **Dispatch** — the manager (or human via dashboard copy-prompt) gives that prompt to a fresh subagent that has the tester MCP configured.
3. **Begin** — tester calls `begin_run(token)`. Daemon: preflight-checks `base_url` reachability (clear error if app is down), launches a recorded BrowserContext (restoring checkpoint `storageState` if set), navigates to the start URL, returns persona card + mission + journey notes + first page snapshot. Status → `running`. Dashboard gets a live WS channel.
4. **Act** — tester loops: `browser_snapshot` → think as persona → `browser_click/type/...`. Every action: server records a step row + screenshot, streams to WS. Console/network captured continuously, attributed to the current step. `report_finding` and `save_checkpoint` available anytime.
5. **Complete** — tester calls `complete_run(verdict, summary)`. Daemon finalizes video, closes context, expires token, computes status (`passed` if goal_achieved and no critical/high findings; `blocked`/`failed` otherwise per verdict), notifies WS. The MCP tool result returns the structured outcome (verdict + findings list) so the calling agent/orchestrator can act on it.
6. **Watchdog** — no tester tool call for N minutes (default 5, configurable): abort run, finalize artifacts, save an automatic journey checkpoint ("resume material"), status `aborted`.

**Ad-hoc feature testing is first-class:** "test the feature I just built" → manager derives goal(s) from the diff/feature description, picks persona(s) + checkpoint, dispatches. Ad-hoc runs can be **promoted to saved tests** (dashboard button or `promote_run_to_test` semantics via `create_test` with `source: promoted_from_run`).

## 6. MCP surface (one binary, two roles)

Thin stateless stdio clients (`@modelcontextprotocol/sdk`) proxying to the daemon's REST API. Separate role = separate MCP entry in agent config, so a tester subagent can be granted only tester tools.

### Manager role — `openuser mcp --role manager`

| Tool | Purpose |
|---|---|
| `register_project` | name, path, baseUrl, environments → project |
| `list_projects` | |
| `create_persona` / `update_persona` / `list_personas` | full persona JSON per §4 |
| `create_test` / `update_test` / `list_tests` | incl. promote-from-run |
| `prepare_run` | testId **or** adhocGoal; personaId; checkpointId?; environment? → `{runId, token, testerPrompt}` |
| `get_run` / `list_runs` | status, steps summary, verdict |
| `get_findings` / `update_finding` | filter project/severity/type/status; triage |
| `list_checkpoints` / `delete_checkpoint` | |
| `get_report` | markdown report for a run (findings + evidence links) |

### Tester role — `openuser mcp --role tester`

| Tool | Purpose |
|---|---|
| `begin_run` | token → persona card, mission, journey notes, first snapshot |
| `browser_snapshot` | a11y tree + URL/title, elements get short refs (e.g. `e12`) |
| `browser_navigate` / `browser_click` / `browser_type` / `browser_select` / `browser_scroll` / `browser_back` / `browser_wait` | act by ref; each auto-records a step (+optional in-character `note`) |
| `browser_screenshot` | on-demand image for vision when the a11y tree is insufficient |
| `report_finding` | type, severity, title, user-voice description; server auto-attaches current step, screenshot, recent error-level console/network events |
| `save_checkpoint` | name, description, journey notes → persists storageState + journey |
| `complete_run` | verdict (goal_achieved/blocked/partial) + summary narrative |

Token is run-scoped and single-run; tester can touch nothing else. **Purity enforcement (decided): protocol + scoped tools** — the tester MCP serves only persona/goal/checkpoint + browser tools, the skill forbids code reading, and the prompt is server-generated. Hard harness lockdown recipes are roadmap.

## 7. Skills (in `skills/`, installed via `openuser skills install`)

- **openuser-manager** — operating manual for the orchestrating agent: register project; design personas from PRD/codebase knowledge; design test flows; the "test what I just built" ad-hoc flow; how to dispatch tester subagents per harness (Claude Code Task tool with fresh context; codex/opencode/cursor recipes); triage findings; report results onward (e.g. to an external kanban — outside OpenUser's scope).
- **openuser-tester** — the "how to be a user" protocol: fully embody the persona (its patience, reading style, vocabulary); never reason like a developer (no URL guessing, no devtools thinking — navigate by what is visible); **confusion is a finding, not a failure** — report in the user's voice ("I expected the checkout button after choosing payment, but nothing happened"); severity rubric (critical = goal impossible / data loss; high = goal blocked with workaround; medium = significant friction; low = papercut); when to `save_checkpoint` (after costly setup, before risky actions); verdict rules; budget rules (persona patience → how many retries before giving up = `blocked`).

## 8. Dashboard (Svelte 5 + Vite + Tailwind v4 SPA)

| Page | Content |
|---|---|
| **Home** | all projects, health at a glance (last runs, open findings count) |
| **Project → Tests** | flows with last-run status; **Run** button → copy-prompt modal (select persona/checkpoint/environment → generates `prepare_run`-backed prompt + copy button) |
| **Run detail** (centerpiece) | live step timeline (WS); right pane tabs: screenshot/video replay · console · network · findings; persona card; verdict banner; promote-to-test for ad-hoc |
| **Findings inbox** | cross-project triage: filter severity/type/status/project; evidence deep-links to the exact run step |
| **Personas** | CRUD cards (identity/behavior/knowledge sections) + linked checkpoints |
| **Checkpoints** | list per project/persona; create-from-run; delete |
| **Settings** | data dir info, browser config (headed default, channel), watchdog timeout, danger zone |
| **MCP setup** | copy-paste MCP config snippets per agent + skill install commands |

Live updates over a single WS endpoint with per-run channels + a global event channel. The dashboard is **agent-MCP-native**: every dashboard capability exists as a manager MCP tool, so "create 5 personas from my PRD and a smoke-test suite" is one prompt.

Dashboard binds to localhost; no auth in v1 (documented; LAN exposure at user's own risk via `--host` flag, roadmap: token auth).

## 9. Repo layout (pnpm monorepo, TypeScript strict everywhere)

```
openuser/
├─ packages/
│  ├─ cli/        # the published `openuser` package; commander; embeds built server + SPA
│  ├─ server/     # Hono daemon: REST, WS, runner (Playwright), Drizzle schema, migrations
│  ├─ mcp/        # thin stdio MCP client, both roles
│  ├─ shared/     # zod schemas + types: single source of truth for API/MCP/DB contracts
│  └─ ui/         # Svelte 5 SPA
├─ skills/        # openuser-manager/SKILL.md, openuser-tester/SKILL.md
├─ examples/demo-shop/  # tiny intentionally-buggy web shop: README demo + e2e fixture
├─ docs/          # specs, architecture, agent setup guides
└─ .github/workflows/ci.yml
```

Build: `ui` → Vite build → copied into `cli` dist (promptfoo pattern); `server` + `mcp` bundled with tsup/esbuild; single publishable tarball. Playwright is a dependency of the published package; browser binary installed on first run via doctor prompt.

## 10. Error handling

| Failure | Behavior |
|---|---|
| Daemon not running when MCP starts | MCP auto-spawns `openuser start --detach`, retries with backoff, else instructive error |
| Target app unreachable | `begin_run` preflight fails with explicit message (start your dev server on `<url>`) |
| Agent abandons run | watchdog aborts after N min, finalizes video, saves auto journey checkpoint |
| Browser/context crash | run → `failed`, partial artifacts kept, journey checkpoint enables resume |
| Invalid/expired token | 401 with clear message; one token = one run |
| Element ref stale after page change | tool returns fresh snapshot + error hint ("page changed, re-snapshot") |
| SQLite contention | impossible by design: daemon is the only writer, WAL mode |
| Port 8737 busy | auto-increment with notice, persisted in `~/.openuser/daemon.json` for MCP discovery |

## 11. Testing strategy (for OpenUser itself)

- **Vitest** unit tests: server services, zod contracts, prompt generation, token scoping.
- **Integration**: MCP client (official SDK) against a live daemon — full manager→prepare→tester→complete lifecycle against `examples/demo-shop`.
- **Playwright e2e**: dashboard UI flows (view live run, triage finding, copy prompt).
- **CI**: GitHub Actions — lint (eslint+prettier), typecheck, unit, integration, e2e on every PR.

## 12. Documentation philosophy (owner requirement)

**The README is the entire human surface.** A human reads only: what OpenUser is (3 paragraphs + screenshot + demo gif), how to install (`npx openuser`, add MCP config, `openuser skills install`), and how to talk to their agent ("test my checkout flow as a new buyer"). Everything operational — creating personas, designing tests, dispatching testers, triaging, explaining results — is encoded in the **skills**, so any agent with the manager skill is a complete expert on the system. Deeper docs in `docs/` exist for contributors, not users.

## 13. First target

Dogfood on `~/projects/ecommerce-digital` (large Go + SvelteKit e-commerce platform): register project, personas like *reseller*, *first-time buyer*, *platform admin*, checkpoints for logged-in states, smoke suite over checkout/registration/kolektif flows.
