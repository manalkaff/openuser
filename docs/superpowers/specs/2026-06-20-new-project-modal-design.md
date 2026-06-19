# New Project modal on the dashboard

**Date:** 2026-06-20
**Status:** Approved, ready for implementation plan
**Scope:** `packages/ui/` only. No CLI, server, or daemon changes.

## Problem

When a user wants to create a new OpenUser project from the dashboard, the "Register project"
button on the Projects page (`packages/ui/src/routes/+page.svelte`) links to `/settings` — a page
full of per-agent MCP JSON. That is the wrong altitude for "I just want to start a new project."
There is no single, tailored copy-paste command that initializes a new project.

The empty state on the same page shows a non-copyable `openuser init` snippet, which is closer but
still not copyable and not tailored to the user's app URL.

## Goal

Clicking "New project" on the Projects page opens a **modal** that hands the user a **copyable
`openuser init` command**, tailored with their app's base URL. The user runs it in their project
directory; the project then appears on the dashboard.

This is a UI-only, client-side change. No new API calls. The actual project registration still
happens when the user runs `openuser init`, exactly as today.

## Background: confirmed runtime behavior (no change required)

These were verified against the current code and inform the modal's copy. They are **not** things
this spec changes.

- **`openuser init` auto-registers the project.** `registerProject()`
  (`packages/cli/src/commands/init.ts`) calls `ensureDaemonRunning()` then POSTs to
  `/api/projects` on the same daemon the dashboard reads from. The project appears in the dashboard.
- **It is not live, though.** The Projects page fetches the list only in `onMount`
  (`+page.svelte`). A project registered while the dashboard is open shows up only after a refresh.
  → The modal must tell the user to refresh.
- **One daemon = one dashboard, shared across all projects.** `ensureDaemonRunning()` and
  `openuser start` both health-check `~/.openuser/daemon.json` first and reuse a running daemon
  rather than spawning a second one. Multiple projects do **not** mean multiple dashboards. The
  modal therefore does not need to start anything or reason about ports.
- **Re-running `init` is idempotent** — it PATCHes the existing project matched by directory path
  rather than creating a duplicate.

## Components and changes

All files under `packages/ui/`.

### 1. New component: `src/lib/components/NewProjectModal.svelte`

**Props:**

```ts
{ open: boolean; onclose: () => void }
```

**Structure:** wraps the existing `Modal` component (`title="New project"`, `size="lg"`).

**State:** one piece of local state, `baseUrl` (string, default `''`).

**Single input — Base URL:**
- Text input, placeholder `http://localhost:3000`, bound to `baseUrl`.
- Label: "Base URL of your running app".
- Free text; **no validation**. Empty is allowed and degrades gracefully (see command logic).
- Project name is intentionally **omitted**: `openuser init` defaults the project name to the
  directory basename, and prompting for a name here that must match the real directory is
  error-prone. The command is correct without it.

**Derived command** (`$derived`):
- If `baseUrl.trim()` is non-empty: `openuser init --base-url <trimmed-url>`
- If empty: `openuser init` (the CLI prompts for the URL interactively)

**Command block:** rendered in the same style as the settings page snippets — a
`rounded-xl ring-1 ring-foreground/10 bg-card` container with a header row containing a label
("Run in your project directory") and a `CopyButton` whose `text` is the derived command, and a
`<pre>`/`<code>` body showing the command.

**Steps below the command** (concise, numbered):
1. Run the command above in your project directory.
2. Approve the OpenUser MCP servers / restart your agent when prompted.
3. Tell your agent: *"Test my app as a new user with OpenUser."* — rendered with its own small
   `CopyButton` for the quoted prompt text.

**Refresh note:** a muted line near the bottom:
> Your new project will appear here after you run the command — refresh this page if it's already open.

**Footer link:** a subtle link "Need MCP config for a specific agent? → Settings" pointing to
`/settings`, preserving the deep setup path without making it the front door.

### 2. `src/routes/+page.svelte` (Projects page)

- Add local state: `let showNewProject = $state(false)`.
- Import `NewProjectModal`.
- **Header button:** rename "Register project" → **"New project"**. Change it from
  `<a href="/settings">` to a `<button type="button" onclick={() => (showNewProject = true)}>`.
  Keep the existing plus-icon and styling.
- **Empty state action:** the existing snippet currently renders a static, non-copyable
  `openuser init`. Change its action to a button that also sets `showNewProject = true`, so the
  empty state and the header button share one entry point. (Keep the "Quick start" framing.)
- Render `<NewProjectModal open={showNewProject} onclose={() => (showNewProject = false)} />` once,
  at the end of the page markup.

## Data flow

Entirely client-side and static. The command string is derived from the base-URL input via a Svelte
`$derived`. No new API calls, no daemon round-trip from the modal. Project registration happens out
of band when the user runs `openuser init`.

## Error handling

- Clipboard copy: handled by the existing `CopyButton`, which fails silently in insecure/denied
  contexts.
- Base-URL input: free text, no validation. Empty input degrades to interactive `openuser init`.
- No network, so no network error states.

## Reused components

- `Modal` (`src/lib/components/Modal.svelte`) — props `open`, `onclose`, `title`, `size`, children.
  Handles Esc-to-close, backdrop click, body scroll lock, focus.
- `CopyButton` (`src/lib/components/CopyButton.svelte`) — props `text`, `label`.

## Testing

`packages/ui/` currently has no component tests. To match the repo's conventions, verification is
**manual** against the running dashboard:

1. From the Projects page, click "New project" → modal opens.
2. Type a URL → the command updates to `openuser init --base-url <url>` live.
3. Clear the URL → command falls back to `openuser init`.
4. Click Copy on the command → clipboard contains the shown command (CopyButton shows "Copied!").
5. Click Copy on the agent prompt → clipboard contains the quoted prompt.
6. Esc / backdrop / X closes the modal.
7. Empty-state button (when no projects exist) opens the same modal.

If a component test is later desired, it would be the first in `ui/` and is out of scope here.

## Out of scope

- Live-updating the projects list (websocket/poll) when a project is registered while the dashboard
  is open. The refresh note covers this for now.
- Any CLI, server, daemon, or README change.
- URL validation or a project-name input.
- Per-agent MCP setup inside the modal (the Settings link covers that).
