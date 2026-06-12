# OpenUser — Per-harness MCP config and dispatch recipes

This document is for contributors and advanced users who want to understand exactly how
OpenUser integrates with each supported agent harness.

## MCP server binary

Both roles are served by the same binary:

```bash
openuser mcp --role manager   # manager tools only
openuser mcp --role tester    # tester tools only
```

The binary auto-spawns the OpenUser daemon (`openuser start --detach --no-open`) if the daemon
is not reachable, then retries the health check 10 times with 500ms backoff before failing with
an instructive error.

## One-command setup: `openuser init`

For most users, `openuser init` is the only setup command needed. It prompts for a project
name + base URL, asks which agent to configure, then for that agent:

- registers the project and writes `openuser.config.json`,
- copies both skills to the agent-appropriate location, and
- **writes** the MCP server config into the agent's project-local file, merging into any
  existing config (it never clobbers unrelated keys or other servers).

| Agent | MCP file written | Skills dir |
|---|---|---|
| claude | `.mcp.json` | `.claude/skills/` |
| codex | `.codex/config.json` | `.agents/skills/` |
| opencode | `.opencode/config.json` | `.agents/skills/` |
| cursor | `.cursor/mcp.json` | `.agents/skills/` |

Non-interactive form: `openuser init --name <n> --base-url <url> --agent <agent|skip>`.

For codex/opencode the canonical MCP config is a *global* file (`~/.codex/config.json`,
`~/.config/opencode/config.json`); `init` writes a project-local equivalent so setup stays
scoped to the repo. The sections below document the global locations and exact shapes if you
prefer to configure manually or globally.

## Claude Code

### MCP config

Easiest via the CLI:

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

### Skill install

```bash
npx openuser skills install --agent claude
# copies skills/openuser-manager/SKILL.md → .claude/skills/openuser-manager/SKILL.md
# copies skills/openuser-tester/SKILL.md  → .claude/skills/openuser-tester/SKILL.md
# then prints the MCP config snippet above
```

### Dispatch recipe (Task tool)

The manager agent dispatches a tester using Claude Code's Task tool. The tester subagent
must have **only** the `openuser-tester` MCP configured — no filesystem tools, no editor
tools, no code-reading tools. The Task prompt is the `testerPrompt` string returned by
`prepare_run`, passed verbatim without modification.

```
Task({
  description: "OpenUser tester — run <runId>",
  prompt: "<testerPrompt exactly as returned by prepare_run>",
})
```

The `testerPrompt` already contains everything the tester needs: the run token, persona
preview, mission preview, and the instruction to call `begin_run` immediately. Do not add
file paths, component names, API routes, or any code context.

## Codex

### MCP config (`codex.json` or `~/.codex/config.json`)

```json
{
  "mcpServers": {
    "openuser-manager": { "command": "openuser", "args": ["mcp", "--role", "manager"] },
    "openuser-tester":  { "command": "openuser", "args": ["mcp", "--role", "tester"] }
  }
}
```

### Skill install

```bash
npx openuser skills install --agent codex
# copies the SKILL.md files into .agents/skills/openuser-manager/ and
# .agents/skills/openuser-tester/, then PRINTS an AGENTS.md discovery
# snippet (and the MCP config above) for you to paste — it does not
# write AGENTS.md for you.
```

### Dispatch recipe (paste-prompt)

Codex does not have a programmatic Task-spawning tool. Use the paste-prompt recipe:

1. The manager calls `prepare_run` to get `testerPrompt`.
2. Open a new Codex session with no project files mounted and only the `openuser-tester`
   MCP configured.
3. Paste `testerPrompt` as the initial user message.

Alternatively, use the dashboard copy-prompt button: Tests → Run → select persona → Copy.

## opencode

### MCP config (`~/.config/opencode/config.json`)

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

### Skill install

```bash
npx openuser skills install --agent opencode
# copies the SKILL.md files into .agents/skills/, then PRINTS an
# AGENTS.md discovery snippet (and the MCP config above) to paste.
```

### Dispatch recipe (paste-prompt)

Same as Codex: open a new opencode session, configure only the tester MCP, paste `testerPrompt`.

## Cursor

### MCP config (`.cursor/mcp.json` or `~/.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "openuser-manager": { "command": "openuser", "args": ["mcp", "--role", "manager"] },
    "openuser-tester":  { "command": "openuser", "args": ["mcp", "--role", "tester"] }
  }
}
```

### Skill install

```bash
npx openuser skills install --agent cursor
# copies the SKILL.md files into .agents/skills/, then PRINTS an
# AGENTS.md discovery snippet (and the MCP config above) to paste.
```

### Dispatch recipe (agent mode paste-prompt)

Open a new Cursor window with no project folder. Configure only `openuser-tester` MCP.
Paste `testerPrompt` into the Cursor Agent chat.

## Token lifecycle

- `prepare_run` generates a one-time run token (`rt_<nanoid(24)>`). Only `sha256(token)` is
  stored in the database.
- The token is embedded in `testerPrompt`. The tester MCP passes it as the `begin_run`
  argument and caches it in-process for all subsequent tester tool calls.
- The token expires when `complete_run` is called, when the watchdog fires, or when the
  daemon restarts. Expired tokens return 401.
- One token = one run. Never reuse a token across runs.

## Purity enforcement

The tester subagent must have zero code context:

- Dispatch via a fresh Task/session with no project files mounted.
- Do not augment `testerPrompt` with file paths, component names, API routes, or
  implementation details.
- The `testerPrompt` is server-generated from template + DB data only. By construction it
  cannot leak codebase knowledge.
- Hard harness lockdown (process-level isolation, restricted tool lists) is roadmap v2.
