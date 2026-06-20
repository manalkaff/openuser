<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getProject, getTests, getPersonas, getCheckpoints, prepareRun } from '$lib/api.js';
  import type { ProjectSummary, TestWithLastRun } from '$lib/api.js';
  import type { Persona, Checkpoint } from '@openuser/shared';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';

  const projectId = $derived($page.params['id'] ?? '');

  let project = $state<ProjectSummary | null>(null);
  let tests = $state<TestWithLastRun[]>([]);
  let personas = $state<Persona[]>([]);
  let checkpoints = $state<Checkpoint[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let modalOpen = $state(false);
  let selectedTest = $state<TestWithLastRun | null>(null);
  let modalMode = $state<'test' | 'adhoc'>('test');

  let selectedPersonaId = $state('');
  let selectedCheckpointId = $state('');
  let selectedEnvironment = $state('');
  let adhocGoal = $state('');

  let testerPrompt = $state('');
  let promptVisible = $state(false);
  let preparing = $state(false);
  let prepareError = $state<string | null>(null);

  onMount(async () => {
    try {
      [project, tests, personas, checkpoints] = await Promise.all([
        getProject(projectId),
        getTests(projectId),
        getPersonas(projectId),
        getCheckpoints(projectId),
      ]);
      const firstActive = personas.find((p) => !p.archived);
      if (firstActive) selectedPersonaId = firstActive.id;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load project';
    } finally {
      loading = false;
    }
  });

  function openRunModal(test: TestWithLastRun | null, mode: 'test' | 'adhoc') {
    selectedTest = test;
    modalMode = mode;
    testerPrompt = '';
    promptVisible = false;
    prepareError = null;
    adhocGoal = '';
    const firstActive = personas.find((p) => !p.archived);
    if (firstActive) selectedPersonaId = firstActive.id;
    selectedCheckpointId = '';
    selectedEnvironment = '';
    modalOpen = true;
  }

  async function handlePrepareRun() {
    if (!selectedPersonaId) {
      prepareError = 'Select a persona first.';
      return;
    }
    if (modalMode === 'adhoc' && !adhocGoal.trim()) {
      prepareError = 'Enter a goal for the ad-hoc run.';
      return;
    }
    prepareError = null;
    preparing = true;
    try {
      const body: Parameters<typeof prepareRun>[0] = {
        projectId,
        personaId: selectedPersonaId,
        ...(modalMode === 'test' && selectedTest ? { testId: selectedTest.id } : {}),
        ...(modalMode === 'adhoc' ? { adhocGoal: adhocGoal.trim() } : {}),
        ...(selectedCheckpointId ? { checkpointId: selectedCheckpointId } : {}),
        ...(selectedEnvironment ? { environment: selectedEnvironment } : {}),
      };
      const result = await prepareRun(body);
      testerPrompt = result.testerPrompt;
      promptVisible = true;
    } catch (e) {
      prepareError = e instanceof Error ? e.message : 'Failed to prepare run';
    } finally {
      preparing = false;
    }
  }

  function priorityClass(p: string) {
    if (p === 'high') return 'text-warning';
    if (p === 'medium') return 'text-yellow-400';
    return 'text-muted-foreground';
  }
</script>

<div class="p-8">
  <!-- Header -->
  {#if project}
    <div class="mb-6">
      <div class="flex items-center gap-2 text-sm text-muted-foreground mb-1">
        <a href="/" class="hover:text-foreground transition-colors">Projects</a>
        <svg aria-hidden="true" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
        </svg>
        <span class="text-foreground">{project.name}</span>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold text-foreground">{project.name}</h1>
          <p class="text-sm text-muted-foreground mt-0.5">{project.baseUrl}</p>
        </div>
        <div class="flex items-center gap-3">
          <button
            type="button"
            onclick={() => openRunModal(null, 'adhoc')}
            class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
          >
            <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd"/>
            </svg>
            Ad-hoc run
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if loading}
    <div class="space-y-2">
      {#each [1, 2, 3] as i (i)}
        <div class="animate-pulse rounded-lg border border-border bg-card h-16"></div>
      {/each}
    </div>
  {:else if error}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
  {:else if tests.length === 0}
    <EmptyState
      title="No tests yet"
      description="Create tests for this project or run an ad-hoc exploration. Tests can also be promoted from runs."
    >
      {#snippet action()}
        <button
          type="button"
          onclick={() => openRunModal(null, 'adhoc')}
          class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
        >
          Start an ad-hoc run
        </button>
      {/snippet}
    </EmptyState>
  {:else}
    <!-- Tests table -->
    <div class="rounded-xl ring-1 ring-foreground/10 bg-card overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
            <th class="py-3 px-4 text-left font-medium">Test</th>
            <th class="py-3 px-4 text-left font-medium w-24">Priority</th>
            <th class="py-3 px-4 text-left font-medium w-28">Last run</th>
            <th class="py-3 px-4 text-left font-medium w-32">Status</th>
            <th class="py-3 px-4 text-right font-medium w-20"></th>
          </tr>
        </thead>
        <tbody>
          {#each tests as test (test.id)}
            <tr class="border-b border-border last:border-0 hover:bg-accent/50 transition-colors group">
              <td class="py-3 px-4">
                <div class="font-medium text-foreground">{test.title}</div>
                <div class="text-xs text-muted-foreground mt-0.5 line-clamp-1">{test.goal}</div>
                {#if test.tags.length > 0}
                  <div class="flex gap-1 mt-1.5 flex-wrap">
                    {#each test.tags as tag (tag)}
                      <span class="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{tag}</span>
                    {/each}
                  </div>
                {/if}
              </td>
              <td class="py-3 px-4">
                <span class="text-xs font-medium {priorityClass(test.priority)} capitalize">{test.priority}</span>
              </td>
              <td class="py-3 px-4">
                {#if test.lastRun}
                  <button
                    type="button"
                    onclick={() => goto(`/runs/${test.lastRun!.id}`)}
                    class="text-xs text-muted-foreground hover:text-brand transition-colors"
                  >
                    <RelativeTime timestamp={test.lastRun.finishedAt} />
                  </button>
                {:else}
                  <span class="text-xs text-muted-foreground/40">Never</span>
                {/if}
              </td>
              <td class="py-3 px-4">
                {#if test.lastRun}
                  <StatusBadge status={test.lastRun.status} />
                {:else}
                  <span class="text-xs text-muted-foreground/40">—</span>
                {/if}
              </td>
              <td class="py-3 px-4 text-right">
                <button
                  type="button"
                  onclick={() => openRunModal(test, 'test')}
                  class="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/80 transition-colors"
                >
                  Run
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Run modal -->
<Modal
  open={modalOpen}
  onclose={() => { modalOpen = false; }}
  title={modalMode === 'test' && selectedTest ? `Run: ${selectedTest.title}` : 'Ad-hoc run'}
  size="lg"
>
  {#snippet children()}
    {#if promptVisible}
      <div class="space-y-4">
        <div class="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          Run prepared! Copy this prompt and paste it into a tester-MCP agent (Claude Code, Codex, opencode, or Cursor with the tester MCP configured).
        </div>
        <div>
          <div class="flex items-center justify-between mb-2">
            <p class="text-sm font-medium text-foreground">Tester prompt</p>
            <CopyButton text={testerPrompt} label="Copy prompt" />
          </div>
          <pre class="rounded-lg border border-border bg-background p-4 text-xs text-foreground font-mono whitespace-pre-wrap overflow-y-auto max-h-64">{testerPrompt}</pre>
        </div>
        <p class="text-xs text-muted-foreground">
          Paste into a fresh agent that has <code class="text-foreground/80 font-mono">openuser mcp --role tester</code> configured. The agent will embody the persona and run the test.
        </p>
        <div class="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onclick={() => { modalOpen = false; }}
            class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    {:else}
      <div class="space-y-4">
        {#if modalMode === 'adhoc'}
          <div>
            <label class="block text-sm font-medium text-foreground mb-1.5" for="adhoc-goal">
              Goal <span class="text-destructive">*</span>
            </label>
            <textarea
              id="adhoc-goal"
              bind:value={adhocGoal}
              rows="3"
              placeholder="E.g. Buy a product using bank transfer as a first-time buyer"
              class="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground
                     placeholder:text-muted-foreground/50 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring
                     resize-none"
            ></textarea>
          </div>
        {/if}

        <div>
          <label class="block text-sm font-medium text-foreground mb-1.5" for="persona-select">
            Persona <span class="text-destructive">*</span>
          </label>
          {#if personas.length === 0}
            <p class="text-sm text-muted-foreground">
              No personas yet.
              <a href="/projects/{projectId}/personas" class="text-brand hover:text-brand/80">Create one first.</a>
            </p>
          {:else}
            <select
              id="persona-select"
              bind:value={selectedPersonaId}
              class="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground
                     focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {#each personas.filter(p => !p.archived) as persona (persona.id)}
                <option value={persona.id}>{persona.name} — {persona.role}</option>
              {/each}
            </select>
          {/if}
        </div>

        <div>
          <label class="block text-sm font-medium text-foreground mb-1.5" for="checkpoint-select">
            Checkpoint <span class="text-xs text-muted-foreground">(optional — resume from saved session)</span>
          </label>
          <select
            id="checkpoint-select"
            bind:value={selectedCheckpointId}
            class="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground
                   focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">None — start fresh</option>
            {#each checkpoints as cp (cp.id)}
              <option value={cp.id}>{cp.name}</option>
            {/each}
          </select>
        </div>

        {#if project && project.environments.length > 0}
          <div>
            <label class="block text-sm font-medium text-foreground mb-1.5" for="env-select">
              Environment <span class="text-xs text-muted-foreground">(optional)</span>
            </label>
            <select
              id="env-select"
              bind:value={selectedEnvironment}
              class="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground
                     focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Default ({project.baseUrl})</option>
              {#each project.environments as env (env.name)}
                <option value={env.name}>{env.name} — {env.url}</option>
              {/each}
            </select>
          </div>
        {/if}

        {#if prepareError}
          <p class="text-sm text-destructive">{prepareError}</p>
        {/if}

        <div class="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onclick={() => { modalOpen = false; }}
            class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onclick={handlePrepareRun}
            disabled={preparing || !selectedPersonaId}
            class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground
                   hover:bg-primary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {preparing ? 'Preparing…' : 'Generate prompt'}
          </button>
        </div>
      </div>
    {/if}
  {/snippet}
</Modal>
