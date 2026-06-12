# Contributing to OpenUser

## Prerequisites

- Node.js >= 20
- pnpm 9.x (`npm install -g pnpm@9`)
- Playwright Chromium browser (`npx playwright install chromium`)

## Setup

```bash
git clone https://github.com/your-org/openuser.git
cd openuser
pnpm install
```

## Package map

| Directory | npm name | Role |
|---|---|---|
| `packages/shared` | `@openuser/shared` | zod schemas, types, enums — single source of truth |
| `packages/server` | `@openuser/server` | Hono daemon: REST API, WebSocket, Drizzle/SQLite, Playwright runner |
| `packages/mcp` | `@openuser/mcp` | Thin stdio MCP servers for manager and tester roles |
| `packages/ui` | `@openuser/ui` | Svelte 5 + SvelteKit SPA dashboard (adapter-static, SPA mode) |
| `packages/cli` | `openuser` | Commander CLI; bundles server + MCP + prebuilt SPA into one publishable package |
| `skills/` | — | Markdown skill files installed into coding agents |
| `examples/demo-shop/` | — | Zero-dependency demo shop with planted bugs; used in e2e tests |

## Development workflow

```bash
# Build all packages (needed before first run)
pnpm build

# Start the daemon in development mode (auto-restarts on change)
pnpm --filter @openuser/server dev

# Start the dashboard in development mode (Vite HMR)
pnpm --filter @openuser/ui dev

# Start the demo shop
pnpm demo
```

## Test commands

```bash
# All unit and integration tests across all packages
pnpm test

# Tests for a specific package
pnpm --filter @openuser/server test
pnpm --filter @openuser/shared test

# Full-lifecycle e2e test (requires Chromium)
pnpm --filter @openuser/server test e2e-demo-shop

# Dashboard unit tests (vitest + jsdom)
pnpm --filter @openuser/ui test

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Format all packages
pnpm format
```

## Running the full CI suite locally

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @openuser/ui build
```

## Key conventions

- **TypeScript strict everywhere.** All packages use `"strict": true`. No `any` without a
  comment justifying it.
- **ESM everywhere.** All packages use `"type": "module"`. No CommonJS.
- **Schemas in `@openuser/shared`.** If a type crosses a package boundary, it belongs in
  `packages/shared/src/`. Do not duplicate schemas.
- **No breaking changes to contracts.md.** Tool names, enum strings, and API paths in
  `docs/specs/contracts.md` are binding. If you need to change them, update contracts.md in
  the same PR and note the breaking change.
- **Findings in user voice.** When writing tests that assert finding descriptions, use plain
  user language, not developer/technical language.

## Opening a PR

1. Branch from `main`.
2. Run `pnpm lint && pnpm typecheck && pnpm test` — all must pass.
3. Add or update tests for any changed behavior.
4. Fill in the PR description with what changed and why.
