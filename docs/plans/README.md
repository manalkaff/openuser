# OpenUser v1 — Implementation Plans Index

> **For agentic workers:** Execute plans strictly in this order. Each plan is self-contained, uses checkbox (`- [ ]`) task tracking, and assumes only its listed dependencies are done. Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans per plan.

Authoritative references (read before executing any plan):
- Spec: `docs/specs/2026-06-11-openuser-v1-design.md`
- **Binding contracts: `docs/specs/contracts.md`** (including the Addenda section — it wins over any conflicting plan text)

| Order | Plan | Builds | Depends on |
|---|---|---|---|
| 1 | `2026-06-11-01-foundation.md` | monorepo scaffold, `@openuser/shared`, CI skeleton | — |
| 2 | `2026-06-11-02-server-core.md` | Drizzle DB, REST, WS, run lifecycle (FakeRunner), tokens, watchdog | 01 |
| 3 | `2026-06-11-03-runner.md` | PlaywrightRunner: recording, a11y snapshots/refs, checkpoints | 02 |
| 4 | `2026-06-11-04-mcp.md` | MCP manager + tester roles, daemon autostart | 02 |
| 5 | `2026-06-11-05-dashboard.md` | SvelteKit SPA: all pages, live WS run view (+ events-route addendum) | 02 |
| 6 | `2026-06-11-06-cli-packaging.md` | CLI commands, bundling, npm publish workflow, doctor | 01–05 |
| 7 | `2026-06-11-07-skills-demo-readme.md` | both skills, demo-shop, README, full e2e, final CI | 01–06 |

Notes for executors:
- Plans 04 and 05 are independent of each other (both depend on 02; 04's live-browser e2e additionally benefits from 03). They may be executed in parallel worktrees, but sequential execution is the safe default.
- Plan 05 contains a small **server addendum task** (`GET /api/runs/:id/events`) that modifies `packages/server` — execute it as written.
- Definition of done for v1: all 7 plans complete, `pnpm -r test` green, `pnpm build:release && pnpm test:pack` green, demo-shop e2e green, README accurate against actual behavior.
