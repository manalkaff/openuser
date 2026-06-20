<script lang="ts">
  import { onMount } from 'svelte';
  import { getSettings, patchSettings } from '$lib/api.js';
  import type { SettingsMap } from '$lib/api.js';
  import CopyButton from '$lib/components/CopyButton.svelte';

  let settings = $state<SettingsMap | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let saving = $state(false);
  let saveMsg = $state('');
  let saveError = $state<string | null>(null);

  let watchdogMinutes = $state(5);
  let headed = $state(false);
  let browserChannel = $state('chromium');

  onMount(async () => {
    try {
      settings = await getSettings();
      watchdogMinutes = settings.watchdogMinutes;
      headed = settings.headed;
      browserChannel = settings.browserChannel;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      loading = false;
    }
  });

  async function handleSave() {
    saving = true;
    saveMsg = '';
    saveError = null;
    try {
      const updated = await patchSettings({
        watchdogMinutes: Number(watchdogMinutes),
        headed,
        browserChannel: browserChannel.trim(),
      });
      settings = updated;
      saveMsg = 'Saved!';
      setTimeout(() => { saveMsg = ''; }, 2000);
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  const mcpSnippets: { agent: string; label: string; json: string }[] = [
    {
      agent: 'claude',
      label: 'Claude Code (.claude/settings.json)',
      json: JSON.stringify({
        mcpServers: {
          'openuser-manager': {
            type: 'stdio',
            command: 'openuser',
            args: ['mcp', '--role', 'manager'],
          },
          'openuser-tester': {
            type: 'stdio',
            command: 'openuser',
            args: ['mcp', '--role', 'tester'],
          },
        },
      }, null, 2),
    },
    {
      agent: 'codex',
      label: 'Codex (codex.json)',
      json: JSON.stringify({
        mcpServers: {
          'openuser-manager': {
            command: 'openuser',
            args: ['mcp', '--role', 'manager'],
          },
          'openuser-tester': {
            command: 'openuser',
            args: ['mcp', '--role', 'tester'],
          },
        },
      }, null, 2),
    },
    {
      agent: 'opencode',
      label: 'opencode (.opencode/config.json)',
      json: JSON.stringify({
        mcp: {
          servers: {
            'openuser-manager': {
              command: 'openuser',
              args: ['mcp', '--role', 'manager'],
            },
            'openuser-tester': {
              command: 'openuser',
              args: ['mcp', '--role', 'tester'],
            },
          },
        },
      }, null, 2),
    },
    {
      agent: 'cursor',
      label: 'Cursor (.cursor/mcp.json)',
      json: JSON.stringify({
        mcpServers: {
          'openuser-manager': {
            command: 'openuser',
            args: ['mcp', '--role', 'manager'],
          },
          'openuser-tester': {
            command: 'openuser',
            args: ['mcp', '--role', 'tester'],
          },
        },
      }, null, 2),
    },
  ];

  const skillsInstallCommands: { agent: string; label: string; cmd: string }[] = [
    { agent: 'claude', label: 'Claude Code', cmd: 'openuser skills install --agent claude' },
    { agent: 'codex', label: 'Codex', cmd: 'openuser skills install --agent codex' },
    { agent: 'opencode', label: 'opencode', cmd: 'openuser skills install --agent opencode' },
    { agent: 'cursor', label: 'Cursor', cmd: 'openuser skills install --agent cursor' },
  ];

  let activeAgent = $state('claude');
  const activeSnippet = $derived(mcpSnippets.find(s => s.agent === activeAgent) ?? mcpSnippets[0]!);
  const activeSkillCmd = $derived(skillsInstallCommands.find(s => s.agent === activeAgent) ?? skillsInstallCommands[0]!);
</script>

<div class="p-8 max-w-4xl">
  <div class="mb-8">
    <h1 class="text-2xl font-bold text-foreground">Settings</h1>
    <p class="mt-1 text-sm text-muted-foreground">Daemon configuration and MCP setup guides.</p>
  </div>

  {#if loading}
    <div class="animate-pulse rounded-xl ring-1 ring-foreground/10 bg-card h-48"></div>
  {:else if error}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive mb-6">{error}</div>
  {:else}
    <!-- Daemon settings form -->
    <section class="mb-10">
      <h2 class="text-lg font-semibold text-foreground mb-4">Daemon settings</h2>
      <div class="rounded-xl ring-1 ring-foreground/10 bg-card p-6 space-y-5">
        <!-- Watchdog timeout -->
        <div class="flex items-center justify-between gap-6">
          <div>
            <label class="block text-sm font-medium text-foreground" for="watchdog">Watchdog timeout</label>
            <p class="text-xs text-muted-foreground mt-0.5">Abort run if tester makes no tool call for this many minutes.</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <input
              id="watchdog"
              type="number"
              bind:value={watchdogMinutes}
              min="1"
              max="60"
              class="w-20 rounded border border-border bg-muted px-3 py-1.5 text-sm text-foreground
                     text-center focus:border-ring focus:outline-none"
            />
            <span class="text-sm text-muted-foreground">min</span>
          </div>
        </div>

        <!-- Headed mode -->
        <div class="flex items-center justify-between gap-6">
          <div>
            <p class="text-sm font-medium text-foreground">Headed browser</p>
            <p class="text-xs text-muted-foreground mt-0.5">Show the browser window when running tests (useful for debugging).</p>
          </div>
          <label class="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" class="sr-only peer" bind:checked={headed} />
            <div class="w-11 h-6 rounded-full bg-muted peer-checked:bg-brand
                        after:content-[''] after:absolute after:top-0.5 after:left-0.5
                        after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all
                        peer-checked:after:translate-x-5"></div>
          </label>
        </div>

        <!-- Browser channel -->
        <div class="flex items-center justify-between gap-6">
          <div>
            <label class="block text-sm font-medium text-foreground" for="browser-channel">Browser channel</label>
            <p class="text-xs text-muted-foreground mt-0.5">Playwright browser channel to use for runs.</p>
          </div>
          <select
            id="browser-channel"
            bind:value={browserChannel}
            class="rounded border border-border bg-muted px-3 py-1.5 text-sm text-foreground
                   focus:border-ring focus:outline-none"
          >
            <option value="chromium">Chromium (default)</option>
            <option value="chrome">Chrome</option>
            <option value="msedge">Microsoft Edge</option>
          </select>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-border">
          {#if saveMsg}
            <p class="text-sm text-success">{saveMsg}</p>
          {:else if saveError}
            <p class="text-sm text-destructive">{saveError}</p>
          {:else}
            <span></span>
          {/if}
          <button
            type="button"
            onclick={handleSave}
            disabled={saving}
            class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground
                   hover:bg-primary/80 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </section>

    <!-- MCP setup -->
    <section class="mb-10">
      <h2 class="text-lg font-semibold text-foreground mb-2">MCP setup</h2>
      <p class="text-sm text-muted-foreground mb-4">
        Configure your coding agent to use the OpenUser MCP servers. Add the snippet below to your agent's MCP config, then install the skills.
      </p>

      <!-- Agent picker -->
      <div class="flex gap-2 mb-4 flex-wrap">
        {#each mcpSnippets as s (s.agent)}
          <button
            type="button"
            onclick={() => { activeAgent = s.agent; }}
            class="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors
                   {activeAgent === s.agent
                     ? 'bg-primary text-primary-foreground'
                     : 'border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20'}"
          >
            {s.agent === 'claude' ? 'Claude Code' :
             s.agent === 'codex' ? 'Codex' :
             s.agent === 'opencode' ? 'opencode' : 'Cursor'}
          </button>
        {/each}
      </div>

      <!-- Config snippet -->
      <div class="rounded-xl ring-1 ring-foreground/10 bg-card overflow-hidden mb-4">
        <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span class="text-xs text-muted-foreground font-medium">{activeSnippet.label}</span>
          <CopyButton text={activeSnippet.json} label="Copy JSON" />
        </div>
        <pre class="px-4 py-4 text-xs text-foreground font-mono overflow-x-auto">{activeSnippet.json}</pre>
      </div>

      <!-- Skills install -->
      <div class="rounded-xl ring-1 ring-foreground/10 bg-card overflow-hidden">
        <div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <span class="text-xs text-muted-foreground font-medium">Install skills — {activeSkillCmd.label}</span>
          <CopyButton text={activeSkillCmd.cmd} label="Copy" />
        </div>
        <div class="px-4 py-3 flex items-center gap-3">
          <code class="text-sm font-mono text-brand">{activeSkillCmd.cmd}</code>
        </div>
      </div>

      <p class="mt-3 text-xs text-muted-foreground">
        The <strong class="text-foreground/80">openuser-manager</strong> skill teaches your agent how to register projects, design personas, dispatch tester subagents, and triage results.
        The <strong class="text-foreground/80">openuser-tester</strong> skill teaches subagents how to embody a persona and report findings.
      </p>
    </section>

    <!-- Data directory info -->
    <section>
      <h2 class="text-lg font-semibold text-foreground mb-4">Data directory</h2>
      <div class="rounded-xl ring-1 ring-foreground/10 bg-card p-4 space-y-2 text-sm">
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">Location</span>
          <code class="text-foreground font-mono text-xs">~/.openuser/</code>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">Database</span>
          <code class="text-foreground font-mono text-xs">~/.openuser/openuser.db</code>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">Artifacts</span>
          <code class="text-foreground font-mono text-xs">~/.openuser/artifacts/&lt;runId&gt;/</code>
        </div>
        <div class="flex justify-between gap-4">
          <span class="text-muted-foreground">Checkpoints</span>
          <code class="text-foreground font-mono text-xs">~/.openuser/checkpoints/&lt;id&gt;/</code>
        </div>
        <p class="text-xs text-muted-foreground/60 pt-1">Override with the <code class="font-mono">OPENUSER_HOME</code> environment variable.</p>
      </div>
    </section>
  {/if}
</div>
