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

## Claude Code

### MCP config (`~/.claude/mcp.json` or project `.claude/mcp.json`)

```json
{
  "mcpServers": {
    "openuser-manager": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "manager"]
    },
    "openuser-tester": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "tester"]
    }
  }
}
```

### Skill install

```bash
npx openuser skills install --agent claude
# copies skills/openuser-manager/SKILL.md → .claude/skills/openuser-manager/SKILL.md
# copies skills/openuser-tester/SKILL.md  → .claude/skills/openuser-tester/SKILL.md
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

### MCP config (`~/.codex/config.yaml`)

```yaml
mcpServers:
  openuser-manager:
    command: npx
    args: [openuser, mcp, --role, manager]
  openuser-tester:
    command: npx
    args: [openuser, mcp, --role, tester]
```

### Skill install

```bash
npx openuser skills install --agent codex
# appends skill content to AGENTS.md in the project root
```

### Dispatch recipe (paste-prompt)

Codex does not have a programmatic Task-spawning tool. Use the paste-prompt recipe:

1. The manager calls `prepare_run` to get `testerPrompt`.
2. Open a new Codex session with no project files mounted and only the `openuser-tester`
   MCP configured.
3. Paste `testerPrompt` as the initial user message.

Alternatively, use the dashboard copy-prompt button: Tests → Run → select persona → Copy.

## opencode

### MCP config (`~/.opencode/config.json`)

```json
{
  "mcp": {
    "openuser-manager": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "manager"]
    },
    "openuser-tester": {
      "command": "npx",
      "args": ["openuser", "mcp", "--role", "tester"]
    }
  }
}
```

### Skill install

```bash
npx openuser skills install --agent opencode
# appends skill content to AGENTS.md in the project root
```

### Dispatch recipe (paste-prompt)

Same as Codex: open a new opencode session, configure only the tester MCP, paste `testerPrompt`.

## Cursor

### MCP config (Settings → MCP → Add server)

Add two entries:

```json
{ "name": "openuser-manager", "command": "npx", "args": ["openuser", "mcp", "--role", "manager"] }
{ "name": "openuser-tester",  "command": "npx", "args": ["openuser", "mcp", "--role", "tester"] }
```

### Skill install

```bash
npx openuser skills install --agent cursor
# writes skill files to .cursor/rules/ as .mdc files
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
