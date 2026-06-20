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
