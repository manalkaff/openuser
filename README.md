# OpenUser

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/openuser)](https://www.npmjs.com/package/openuser)

> **Your coding agent tests your app as a real user — so you don't have to.**

![Demo](docs/assets/demo.gif)
<!-- TODO: replace with real demo gif after first dogfood run -->

---

## What is OpenUser?

OpenUser is an open-source, self-hosted platform that turns any MCP-capable coding agent
(Claude Code, Codex, opencode, Cursor) into a user-perspective tester. Instead of writing
test scripts, you tell your agent: *"test my checkout flow as a first-time buyer."* The agent
summons a tester subagent that embodies a named user persona — with a specific patience level,
reading style, and domain vocabulary — and navigates your running web app as that person would,
with no knowledge of your codebase.

OpenUser is a self-hostable alternative to TestSprite. It runs entirely on your machine:
one `npx openuser` command starts a local daemon with a Playwright browser, a SQLite database,
and a dashboard. No cloud account, no API keys, no data leaving your machine.

The human interface is minimal by design. You talk to your agent — "test registration as a
reseller", "test the feature I just shipped", "what did OpenUser find this week?" — and your
agent handles everything: creating personas, preparing runs, dispatching testers, retrieving
results, and explaining findings in plain language. You review findings, not flows.

---

## Features

- **User personas** — named profiles with identity, behavior (patience, reading style,
  tech savviness), and domain knowledge. First-class in every run.
- **UX confusion findings** — tester subagents report confusion in the user's own voice, not
  developer language. Catches issues automated scripts never find.
- **Checkpoints** — save and resume browser sessions across runs. Avoid re-doing login + setup
  steps on every test.
- **Full recording** — video, per-step screenshots, console log, network log, all attributed
  to the causing step.
- **Local dashboard** — live run timeline, findings inbox, persona and checkpoint management.
  Every dashboard capability is also a manager MCP tool.
- **Works with any MCP-capable agent** — Claude Code, Codex, opencode, Cursor, or any agent
  that can call MCP tools.
- **Fully offline** — no cloud, no account, no API keys required by OpenUser itself.
- **MIT open source** — self-hostable, forkable, extensible.

---

## Quickstart

### 1. Start the daemon

```bash
npx openuser
```

This starts the daemon on port 8737, opens the dashboard in your browser, and (on first run)
prompts you to install the Playwright Chromium browser.

### 2. Set up your project (one command)

From your project directory:

```bash
openuser init
```

This interactively asks for a project name and your app's base URL, then lets you pick your
coding agent (Claude Code, Codex, opencode, or Cursor). For the agent you choose it will:

- register the project with the daemon and write `openuser.config.json`,
- copy the `openuser-manager` + `openuser-tester` skills into the right place
  (`.claude/skills/` for Claude Code, `.agents/skills/` otherwise), and
- **write the MCP server config** into the agent's project-local config file
  (`.mcp.json`, `.codex/config.json`, `.opencode/config.json`, or `.cursor/mcp.json`),
  merging into any existing config without clobbering it.

Fully non-interactive (handy for scripts/CI):

```bash
openuser init --name my-app --base-url http://localhost:3000 --agent claude
# --agent: claude | codex | opencode | cursor | skip
```

> **Claude Code:** the MCP servers are written to project-scoped `.mcp.json`, so Claude Code
> will ask you to approve them once on next launch.

If you'd rather wire things up manually, the per-agent configs are below.

<details>
<summary>Manual MCP config (what <code>init</code> writes)</summary>

**Claude Code** — easiest is the CLI:

```bash
claude mcp add openuser-manager -- openuser mcp --role manager
claude mcp add openuser-tester  -- openuser mcp --role tester
```

Or add to `.claude/settings.json` (project) or `~/.claude/settings.json` (global):

```json
{
  "mcpServers": {
    "openuser-manager": { "command": "openuser", "args": ["mcp", "--role", "manager"] },
    "openuser-tester":  { "command": "openuser", "args": ["mcp", "--role", "tester"] }
  }
}
```

**Codex** — add to `codex.json` or `~/.codex/config.json`:

```json
{
  "mcpServers": {
    "openuser-manager": { "command": "openuser", "args": ["mcp", "--role", "manager"] },
    "openuser-tester":  { "command": "openuser", "args": ["mcp", "--role", "tester"] }
  }
}
```

**opencode** — add to `~/.config/opencode/config.json`:

```json
{
  "mcp": {
    "servers": {
      "openuser-manager": { "type": "stdio", "command": "openuser", "args": ["mcp", "--role", "manager"] },
      "openuser-tester":  { "type": "stdio", "command": "openuser", "args": ["mcp", "--role", "tester"] }
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "openuser-manager": { "command": "openuser", "args": ["mcp", "--role", "manager"] },
    "openuser-tester":  { "command": "openuser", "args": ["mcp", "--role", "tester"] }
  }
}
```

To install just the skills without touching MCP config, use
`openuser skills install --agent <agent>` (copies skill files and prints the MCP snippet).

</details>

### 3. Talk to your agent

With your dev server running:

```
Tell your agent: "Test my checkout flow as a first-time buyer using OpenUser."
```

Your agent will:
1. Register your project (once).
2. Create a first-time buyer persona (or reuse one).
3. Prepare and dispatch a tester run.
4. Report findings when complete.

---

## How it works

```
You  →  coding agent (has your codebase context)
              │
              │  openuser-manager MCP
              ▼
         OpenUser daemon  (port 8737, localhost)
              │
              │  prepare_run → testerPrompt (server-generated, no code context)
              ▼
         tester subagent  (fresh context, tester MCP only)
              │
              │  begin_run → browse → report_finding → complete_run
              ▼
         Playwright browser  (records video + screenshots + console + network)
              │
              ▼
         SQLite findings  →  dashboard  →  your agent explains results to you
```

The tester subagent **never sees your code**. Its only instructions come from a
server-generated prompt that embeds the persona card, the user-outcome goal, and a reminder to
navigate by visible UI only. This is what makes findings feel like real user reports.

---

## Concepts

**Persona** — A named user archetype with a specific identity (credentials, locale), behavior
(patience level, reading style, tech savviness, device), and knowledge (what they already know
about your product, what vocabulary they use). Every run is tied to one persona. A low-patience,
skimming novice will find completely different issues than a patient expert reader.

**Checkpoint** — A saved browser session state (cookies, localStorage, indexedDB) plus journey
notes. Checkpoints let tester runs start mid-flow — already logged in, already past setup steps.
They are saved automatically after costly setup and before risky actions, and can be reused
across runs.

**Finding** — A structured report of something wrong or confusing. Finding types are
`functional` (broken behavior), `console` (browser error), `network` (failed request), and
`ux_confusion` (the signature OpenUser type — user-voice reports of confusing UI). Every finding
has a severity, a user-voice description, and evidence (screenshot, console/network excerpt).

**Run** — One tester session: a persona pursuing a goal on your app. Runs are fully recorded
(video, per-step screenshots, console, network). A run ends with a verdict: `goal_achieved`,
`blocked`, or `partial`, plus a user-voice summary and a list of findings.

---

## FAQ

**Does OpenUser upload my code or app data anywhere?**
No. Everything runs on your machine. The daemon binds to `127.0.0.1` by default. Your code is
never read by the tester subagent. Artifacts (screenshots, video) stay in `~/.openuser/`.

**What does OpenUser cost?**
OpenUser itself is free and MIT-licensed. Running tests consumes your agent's tokens — the same
tokens you would spend on any other agent task. There is no OpenUser subscription or usage fee.

**Which agents does OpenUser work with?**
Any agent that can call MCP tools: Claude Code, Codex, opencode, Cursor, and any future
MCP-capable coding assistant. The manager and tester MCPs are standard stdio MCP servers.

**How is OpenUser different from TestSprite?**

| Feature | TestSprite | OpenUser |
|---|---|---|
| Self-hosted / offline | ✗ cloud-only | ✓ `npx openuser` |
| User personas | ✗ | ✓ first-class |
| Checkpoints | ✗ | ✓ first-class |
| UX confusion findings | ✗ | ✓ signature feature |
| Console + network in dashboard | ✗ | ✓ per step |
| Always agentic (no scripts) | ✗ generated scripts | ✓ |
| MCP-drivable dashboard | partial | ✓ everything |
| Open source | ✗ | ✓ MIT |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The repo is a pnpm monorepo; `pnpm install` then
`pnpm test` to get started.

---

MIT © OpenUser contributors
