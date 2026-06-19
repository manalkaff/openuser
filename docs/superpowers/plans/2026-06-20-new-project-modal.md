# New Project Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "New project" modal to the dashboard Projects page that hands the user a copyable, base-URL-tailored `openuser init` command.

**Architecture:** A new presentational Svelte 5 component (`NewProjectModal.svelte`) wraps the existing `Modal` and derives the command string from a single base-URL input. The Projects page (`+page.svelte`) gains a boolean state and opens the modal from both the header button and the empty-state action. Entirely client-side; no API calls.

**Tech Stack:** Svelte 5 (runes: `$state`, `$derived`, `$props`), SvelteKit, Tailwind CSS v4.

## Global Constraints

- **Scope:** `packages/ui/` only. No CLI, server, daemon, or README changes.
- **No new API calls.** The modal is static/client-side; project registration happens out of band when the user runs `openuser init`.
- **Reuse existing components:** `Modal` (`src/lib/components/Modal.svelte`, props `open`/`onclose`/`title`/`size`/children) and `CopyButton` (`src/lib/components/CopyButton.svelte`, props `text`/`label`).
- **Svelte 5 runes only** — match the existing files: `$state()`, `$derived()`, `$props()`. No legacy `export let` / stores for local state.
- **No validation** on the base-URL input; empty input is valid and degrades to bare `openuser init`.
- **No project-name input** — `openuser init` defaults the name to the directory basename.
- **Verification gate:** `pnpm --filter @openuser/ui check` (svelte-check) must pass with no new errors. There are no UI unit tests in this repo; do not add one.

---

### Task 1: Build the `NewProjectModal` component

**Files:**
- Create: `packages/ui/src/lib/components/NewProjectModal.svelte`

**Interfaces:**
- Consumes: `Modal` from `$lib/components/Modal.svelte` (props: `open: boolean`, `onclose: () => void`, `title: string`, `size?: 'sm'|'md'|'lg'|'xl'`, children snippet). `CopyButton` from `$lib/components/CopyButton.svelte` (props: `text: string`, `label?: string`).
- Produces: default export component with props `{ open: boolean; onclose: () => void }`. Used by Task 2.

- [ ] **Step 1: Create the component file**

Create `packages/ui/src/lib/components/NewProjectModal.svelte` with exactly this content:

```svelte
<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';

  const { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let baseUrl = $state('');

  const command = $derived(
    baseUrl.trim() ? `openuser init --base-url ${baseUrl.trim()}` : 'openuser init',
  );

  const agentPrompt = 'Test my app as a new user with OpenUser.';
</script>

<Modal {open} {onclose} title="New project" size="lg">
  <div class="space-y-5">
    <p class="text-sm text-muted-foreground">
      Register a new project by running one command in its directory. Your agent handles the rest.
    </p>

    <!-- Base URL input -->
    <div>
      <label class="block text-sm font-medium text-foreground mb-1.5" for="new-project-url">
        Base URL of your running app
      </label>
      <input
        id="new-project-url"
        type="text"
        bind:value={baseUrl}
        placeholder="http://localhost:3000"
        class="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground
               placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none"
      />
      <p class="mt-1 text-xs text-muted-foreground">Leave blank to be prompted interactively.</p>
    </div>

    <!-- Command block -->
    <div class="rounded-xl ring-1 ring-foreground/10 bg-card overflow-hidden">
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span class="text-xs text-muted-foreground font-medium">Run in your project directory</span>
        <CopyButton text={command} label="Copy" />
      </div>
      <pre class="px-4 py-4 text-sm text-brand font-mono overflow-x-auto">{command}</pre>
    </div>

    <!-- Steps -->
    <ol class="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
      <li>Run the command above in your project directory.</li>
      <li>Approve the OpenUser MCP servers / restart your agent when prompted.</li>
      <li class="flex flex-wrap items-center gap-2">
        <span>Tell your agent:</span>
        <code class="font-mono text-foreground/80 text-xs">"{agentPrompt}"</code>
        <CopyButton text={agentPrompt} label="Copy prompt" class="text-xs px-2 py-1" />
      </li>
    </ol>

    <!-- Refresh note -->
    <p class="text-xs text-muted-foreground/70 border-t border-border pt-3">
      Your new project will appear here after you run the command — refresh this page if it's already open.
    </p>

    <!-- Settings link -->
    <p class="text-xs">
      <a href="/settings" class="text-brand hover:underline">
        Need MCP config for a specific agent? → Settings
      </a>
    </p>
  </div>
</Modal>
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm --filter @openuser/ui check`
Expected: PASS — no errors referencing `NewProjectModal.svelte`. (Pre-existing warnings elsewhere, if any, are unchanged.)

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/components/NewProjectModal.svelte
git commit -m "feat(ui): add NewProjectModal with copyable openuser init command"
```

---

### Task 2: Wire the modal into the Projects page

**Files:**
- Modify: `packages/ui/src/routes/+page.svelte`

**Interfaces:**
- Consumes: `NewProjectModal` from Task 1 (props `open: boolean`, `onclose: () => void`).
- Produces: nothing downstream.

- [ ] **Step 1: Import the modal and add open state**

In `packages/ui/src/routes/+page.svelte`, in the `<script>` block, add the import alongside the existing component imports (after the `RelativeTime` import on line 7):

```ts
  import NewProjectModal from '$lib/components/NewProjectModal.svelte';
```

Then add this state declaration after the existing `error` state (after line 11, `let error = $state<string | null>(null);`):

```ts
  let showNewProject = $state(false);
```

- [ ] **Step 2: Replace the header link with a button**

Replace the header anchor (currently lines 36-44, the `<a href="/settings">…Register project…</a>` block) with this button. Keep the same icon and classes; only the element type, the click handler, and the label change:

```svelte
    <button
      type="button"
      onclick={() => (showNewProject = true)}
      class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
      </svg>
      New project
    </button>
```

- [ ] **Step 3: Make the empty-state action open the modal**

Replace the empty-state `action` snippet (currently lines 63-68, the `{#snippet action()}…{/snippet}` block containing the static `openuser init` code) with a button that opens the modal:

```svelte
      {#snippet action()}
        <button
          type="button"
          onclick={() => (showNewProject = true)}
          class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
        >
          <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
          </svg>
          New project
        </button>
      {/snippet}
```

- [ ] **Step 4: Render the modal at the end of the page**

At the very end of the file, after the closing `</div>` of the `<div class="p-8">` wrapper (after line 116), add:

```svelte

<NewProjectModal open={showNewProject} onclose={() => (showNewProject = false)} />
```

- [ ] **Step 5: Verify it type-checks**

Run: `pnpm --filter @openuser/ui check`
Expected: PASS — no new errors in `+page.svelte`.

- [ ] **Step 6: Manual verification in the running dashboard**

Start the UI dev server (`pnpm --filter @openuser/ui dev`) or use a built daemon, then confirm:
1. Click "New project" (header) → modal opens.
2. Type `http://localhost:5173` in the URL field → command shows `openuser init --base-url http://localhost:5173`.
3. Clear the field → command falls back to `openuser init`.
4. Click "Copy" on the command → CopyButton shows "Copied!".
5. Click "Copy prompt" → clipboard has the agent prompt text.
6. Press Esc, click backdrop, and click X → each closes the modal.
7. (If you have a fresh/empty daemon) the empty-state "New project" button opens the same modal.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/routes/+page.svelte
git commit -m "feat(ui): open New Project modal from Projects page header and empty state"
```

---

## Self-Review

**Spec coverage:**
- New component `NewProjectModal.svelte` → Task 1. ✓
- Single Base-URL input, no name, no validation → Task 1, Step 1 + Global Constraints. ✓
- Derived command with empty-URL fallback → Task 1, Step 1 (`$derived`). ✓
- Command block styled like settings snippets + CopyButton → Task 1, Step 1. ✓
- Three numbered steps + agent-prompt CopyButton → Task 1, Step 1. ✓
- Refresh note → Task 1, Step 1. ✓
- Settings footer link → Task 1, Step 1. ✓
- Rename button + link→button + state toggle → Task 2, Steps 1-2. ✓
- Empty-state action shares the same entry point → Task 2, Step 3. ✓
- Render modal once on the page → Task 2, Step 4. ✓
- Manual verification matching no-UI-tests convention → Task 2, Step 6. ✓
- Out of scope (live updates, validation, name input, CLI/README) → respected; nothing added. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/vague steps. All code blocks are complete and literal.

**Type consistency:** `NewProjectModal` props `{ open, onclose }` are declared identically in Task 1 (definition) and Task 2, Step 4 (usage). `command` and `agentPrompt` names are consistent within Task 1. `CopyButton` `text`/`label`/`class` and `Modal` `open`/`onclose`/`title`/`size` match the real component signatures verified in the source.
