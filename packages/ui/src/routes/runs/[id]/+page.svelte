<script lang="ts">
  import { page } from '$app/stores';
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { getRun, getRunEvents, promoteRun, getPersonas } from '$lib/api.js';
  import type { RunDetail } from '$lib/api.js';
  import type { Step, Finding, LogEvent, Persona, RunStatus } from '@openuser/shared';
  import {
    wsSubscribe, wsClearRun,
    wsRunSteps, wsRunLogEvents, wsRunStatus,
  } from '$lib/ws.svelte.js';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SeverityBadge from '$lib/components/SeverityBadge.svelte';
  import PersonaCard from '$lib/components/PersonaCard.svelte';
  import Tabs from '$lib/components/Tabs.svelte';
  import CopyButton from '$lib/components/CopyButton.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';

  // CORRECTION: use bracket notation + fallback for noUncheckedIndexedAccess
  const runId = $derived($page.params['id'] ?? '');

  let run = $state<RunDetail | null>(null);
  let persona = $state<Persona | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activeTab = $state('steps');

  // Log events for finished runs (fetched from /events)
  let finishedLogEvents = $state<LogEvent[]>([]);

  // Live log events for running runs (from WS store)
  const liveLogEvents = $derived(wsRunLogEvents[runId] ?? []);

  // Live steps from WS (appended as run progresses)
  const liveSteps = $derived(wsRunSteps[runId] ?? []);

  // CORRECTION: use $derived.by(() => {...}) so allSteps is the RESULT (not a function).
  // Access as `allSteps` (no parentheses) everywhere in the template.
  const allSteps = $derived.by((): Step[] => {
    if (!run) return liveSteps;
    const initial = run.steps;
    const liveIds = new Set(liveSteps.map(s => s.id));
    const deduped = initial.filter(s => !liveIds.has(s.id));
    return [...deduped, ...liveSteps].sort((a, b) => a.idx - b.idx);
  });

  // Effective status (WS overrides initial REST value once run progresses)
  const statusUpdate = $derived(wsRunStatus[runId]);
  // Cast to RunStatus — wsRunStatus payload is typed as string but the server always sends valid RunStatus values
  const effectiveStatus = $derived((statusUpdate?.status ?? run?.status ?? 'pending') as RunStatus);
  const effectiveVerdict = $derived(statusUpdate?.verdict ?? run?.verdict ?? null);

  // Effective log events: live while running, static when finished
  // F1: key off effectiveStatus (which reflects live WS updates), not the stale run?.status
  const logEvents = $derived(
    effectiveStatus === 'running' ? liveLogEvents : finishedLogEvents
  );
  const consoleEvents = $derived(logEvents.filter(e => e.kind === 'console'));
  const networkEvents = $derived(logEvents.filter(e => e.kind === 'network'));

  // Promote modal
  let promoteOpen = $state(false);
  let promoteTitle = $state('');
  let promotePriority = $state<'low' | 'medium' | 'high'>('medium');
  let promoteTags = $state('');
  let promoting = $state(false);
  let promoteError = $state<string | null>(null);

  // Enlarge screenshot
  let enlargedShot = $state<string | null>(null);

  onMount(async () => {
    try {
      const [runData, evts] = await Promise.all([
        getRun(runId),
        getRunEvents(runId).catch(() => [] as LogEvent[]),
      ]);
      run = runData;
      finishedLogEvents = evts;
      // Load persona card
      if (runData.projectId) {
        const ps = await getPersonas(runData.projectId).catch(() => [] as Persona[]);
        persona = ps.find(p => p.id === runData.personaId) ?? null;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load run';
    } finally {
      loading = false;
    }
    // Subscribe to WS channel for live updates
    wsSubscribe(`run:${runId}`);
  });

  onDestroy(() => {
    wsClearRun(runId);
  });

  // CORRECTION: allSteps is a value (not a function) due to $derived.by — no () needed
  const tabDefs = $derived([
    { id: 'steps', label: 'Steps', count: allSteps.length },
    { id: 'screenshots', label: 'Screenshots' },
    { id: 'console', label: 'Console', count: consoleEvents.length },
    { id: 'network', label: 'Network', count: networkEvents.length },
    { id: 'findings', label: 'Findings', count: run?.findings.length ?? 0 },
  ]);

  function stepKindIcon(kind: string): string {
    const icons: Record<string, string> = {
      navigate: '→', click: '↖', type: '⌨', select: '▾',
      scroll: '↕', back: '←', wait: '⏱', screenshot: '📸', begin: '▶',
    };
    return icons[kind] ?? '•';
  }

  function verdictColor(verdict: string | null): string {
    if (verdict === 'goal_achieved') return 'text-green-400';
    if (verdict === 'blocked') return 'text-orange-400';
    if (verdict === 'partial') return 'text-yellow-400';
    return 'text-zinc-400';
  }

  function verdictLabel(verdict: string | null): string {
    if (verdict === 'goal_achieved') return 'Goal achieved';
    if (verdict === 'blocked') return 'Blocked';
    if (verdict === 'partial') return 'Partial progress';
    return '—';
  }

  async function handlePromote() {
    if (!promoteTitle.trim()) { promoteError = 'Title is required.'; return; }
    promoteError = null;
    promoting = true;
    try {
      const tags = promoteTags.split(',').map(t => t.trim()).filter(Boolean);
      await promoteRun(runId, {
        title: promoteTitle.trim(),
        priority: promotePriority,
        ...(tags.length > 0 ? { tags } : {}),
      });
      promoteOpen = false;
      // Navigate to project tests page
      goto(`/projects/${run!.projectId}`);
    } catch (e) {
      promoteError = e instanceof Error ? e.message : 'Promote failed';
    } finally {
      promoting = false;
    }
  }
</script>

<div class="p-8 min-h-full">
  {#if loading}
    <div class="space-y-4">
      <div class="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 h-24"></div>
      <div class="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 h-96"></div>
    </div>
  {:else if error}
    <div class="rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">{error}</div>
  {:else if run}
    <!-- Verdict banner -->
    {#if effectiveStatus === 'passed' || effectiveStatus === 'failed' || effectiveStatus === 'blocked' || effectiveStatus === 'aborted'}
      <div class="mb-6 rounded-xl border {effectiveStatus === 'passed' ? 'border-green-900 bg-green-950/20' : 'border-zinc-800 bg-zinc-900'} p-5">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <StatusBadge status={effectiveStatus} />
            {#if effectiveVerdict}
              <span class="text-sm font-medium {verdictColor(effectiveVerdict)}">
                {verdictLabel(effectiveVerdict)}
              </span>
            {/if}
          </div>
          <div class="flex items-center gap-3">
            {#if run.testId === null}
              <!-- Ad-hoc run — show promote button -->
              <button
                type="button"
                onclick={() => {
                  promoteTitle = run!.adhocGoal ?? '';
                  promotePriority = 'medium';
                  promoteTags = '';
                  promoteError = null;
                  promoteOpen = true;
                }}
                class="rounded-lg border border-indigo-700 bg-indigo-600/20 px-4 py-1.5 text-sm font-medium text-indigo-400 hover:bg-indigo-600/30 transition-colors"
              >
                Promote to test
              </button>
            {/if}
            <RelativeTime timestamp={run.finishedAt ?? run.startedAt} class="text-xs text-zinc-500" />
          </div>
        </div>
        {#if run.summary}
          <p class="mt-3 text-sm text-zinc-300 border-t border-zinc-800 pt-3">{run.summary}</p>
        {/if}
      </div>
    {:else if effectiveStatus === 'running'}
      <div class="mb-6 rounded-xl border border-blue-900 bg-blue-950/20 p-4 flex items-center gap-3">
        <span class="h-2 w-2 rounded-full bg-blue-400 animate-pulse"></span>
        <span class="text-sm text-blue-300 font-medium">Run in progress — watching live…</span>
        <RelativeTime timestamp={run.startedAt} class="ml-auto text-xs text-zinc-500" />
      </div>
    {/if}

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Left: timeline + tabs -->
      <div class="lg:col-span-2">
        <Tabs tabs={tabDefs} active={activeTab} onchange={(id) => { activeTab = id; }}>
          {#snippet children()}
            <!-- STEPS TAB -->
            {#if activeTab === 'steps'}
              <div class="space-y-2">
                {#if allSteps.length === 0}
                  <p class="text-sm text-zinc-500 py-4 text-center">
                    {effectiveStatus === 'running' ? 'Waiting for first step…' : 'No steps recorded.'}
                  </p>
                {:else}
                  {#each allSteps as step (step.id)}
                    <div class="flex gap-3 rounded-lg border {step.status === 'error' ? 'border-red-900 bg-red-950/20' : 'border-zinc-800 bg-zinc-900'} p-3">
                      <!-- Index + icon -->
                      <div class="flex flex-col items-center">
                        <span class="text-lg" aria-hidden="true">{stepKindIcon(step.kind)}</span>
                        <span class="text-xs text-zinc-600 mt-1">#{step.idx}</span>
                      </div>
                      <!-- Content -->
                      <div class="flex-1 min-w-0">
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <span class="text-xs font-mono text-zinc-500 uppercase">{step.kind}</span>
                            <p class="text-sm text-zinc-200 mt-0.5">{step.description}</p>
                            {#if step.pageUrl}
                              <p class="text-xs text-zinc-500 font-mono truncate mt-0.5">{step.pageUrl}</p>
                            {/if}
                            {#if step.note}
                              <p class="mt-1.5 text-xs italic text-zinc-400 border-l-2 border-zinc-700 pl-2">"{step.note}"</p>
                            {/if}
                            {#if step.error}
                              <p class="mt-1.5 text-xs text-red-400 font-mono">{step.error}</p>
                            {/if}
                          </div>
                          <div class="flex items-center gap-2 shrink-0">
                            {#if step.durationMs !== null && step.durationMs !== undefined}
                              <span class="text-xs text-zinc-600">{step.durationMs}ms</span>
                            {/if}
                            {#if step.screenshotPath}
                              <button
                                type="button"
                                onclick={() => { enlargedShot = `/artifacts/${runId}/${step.screenshotPath}`; }}
                                class="text-xs text-zinc-500 hover:text-indigo-400 transition-colors"
                                aria-label="View screenshot"
                              >
                                📸
                              </button>
                            {/if}
                          </div>
                        </div>
                      </div>
                    </div>
                  {/each}
                  {#if effectiveStatus === 'running'}
                    <div class="flex items-center gap-2 py-2 pl-4 text-xs text-zinc-500">
                      <span class="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                      Waiting for next step…
                    </div>
                  {/if}
                {/if}
              </div>

            <!-- SCREENSHOTS TAB -->
            {:else if activeTab === 'screenshots'}
              {@const shots = allSteps.filter(s => s.screenshotPath)}
              {#if shots.length === 0}
                <p class="text-sm text-zinc-500 py-4 text-center">No screenshots yet.</p>
              {:else}
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {#each shots as step (step.id)}
                    <button
                      type="button"
                      onclick={() => { enlargedShot = `/artifacts/${runId}/${step.screenshotPath}`; }}
                      class="group relative aspect-video overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 hover:border-zinc-600 transition-colors"
                    >
                      <img
                        src={`/artifacts/${runId}/${step.screenshotPath}`}
                        alt={`Step ${step.idx} — ${step.description}`}
                        class="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end">
                        <p class="w-full bg-black/60 px-2 py-1 text-xs text-zinc-300 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                          #{step.idx} {step.description}
                        </p>
                      </div>
                    </button>
                  {/each}
                </div>
                <!-- Video player if available -->
                {#if run!.videoPath}
                  <div class="mt-6">
                    <h3 class="text-sm font-medium text-zinc-300 mb-2">Run recording</h3>
                    <video
                      controls
                      class="w-full rounded-lg border border-zinc-800 bg-black max-h-96"
                      src={`/artifacts/${runId}/${run!.videoPath}`}
                    >
                      <track kind="captions" label="No captions" />
                      Your browser does not support video playback.
                    </video>
                  </div>
                {/if}
              {/if}

            <!-- CONSOLE TAB -->
            {:else if activeTab === 'console'}
              {#if consoleEvents.length === 0}
                <p class="text-sm text-zinc-500 py-4 text-center">No error-level console events.</p>
              {:else}
                <div class="rounded-lg border border-zinc-800 bg-zinc-950 font-mono text-xs overflow-auto max-h-[50vh]">
                  {#each consoleEvents as evt (evt.id)}
                    {@const cp = evt.payload as { text?: string }}
                    <div class="flex gap-2 px-3 py-1.5 border-b border-zinc-900 last:border-0 text-red-400">
                      <span class="text-zinc-600 shrink-0">#{evt.stepIdx}</span>
                      <span class="text-zinc-500 shrink-0 uppercase text-[10px] leading-4 w-12">{evt.level}</span>
                      <span class="break-all">{cp.text ?? JSON.stringify(evt.payload)}</span>
                    </div>
                  {/each}
                </div>
              {/if}

            <!-- NETWORK TAB -->
            {:else if activeTab === 'network'}
              {#if networkEvents.length === 0}
                <p class="text-sm text-zinc-500 py-4 text-center">No failed network requests.</p>
              {:else}
                <div class="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
                  <table class="w-full text-xs font-mono">
                    <thead>
                      <tr class="border-b border-zinc-800 text-zinc-500 uppercase text-[10px] tracking-wider">
                        <th class="py-2 px-3 text-left font-medium w-8">Step</th>
                        <th class="py-2 px-3 text-left font-medium w-16">Status</th>
                        <th class="py-2 px-3 text-left font-medium w-16">Method</th>
                        <th class="py-2 px-3 text-left font-medium">URL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each networkEvents as evt (evt.id)}
                        {@const p = evt.payload as { method?: string; url?: string; status?: number | string }}
                        <tr class="border-b border-zinc-800 last:border-0 hover:bg-zinc-800/40">
                          <td class="py-2 px-3 text-zinc-500">#{evt.stepIdx}</td>
                          <td class="py-2 px-3 text-red-400">{p.status ?? evt.level}</td>
                          <td class="py-2 px-3 text-zinc-400">{p.method ?? '—'}</td>
                          <td class="py-2 px-3 text-zinc-300 truncate max-w-xs" title={p.url}>{p.url ?? '—'}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}

            <!-- FINDINGS TAB -->
            {:else if activeTab === 'findings'}
              {#if run!.findings.length === 0}
                <p class="text-sm text-zinc-500 py-4 text-center">No findings for this run.</p>
              {:else}
                <div class="space-y-3">
                  {#each run!.findings as finding (finding.id)}
                    <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                      <div class="flex items-start justify-between gap-3 mb-2">
                        <div class="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={finding.severity} />
                          <span class="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded capitalize">{finding.type.replace('_', ' ')}</span>
                        </div>
                        <span class="text-xs text-zinc-500 capitalize">{finding.status}</span>
                      </div>
                      <h4 class="text-sm font-medium text-zinc-200">{finding.title}</h4>
                      <p class="mt-1 text-sm text-zinc-400 italic">"{finding.description}"</p>
                      {#if finding.evidence.screenshotPath}
                        <button
                          type="button"
                          onclick={() => { enlargedShot = `/artifacts/${runId}/${finding.evidence.screenshotPath}`; }}
                          class="mt-2 text-xs text-indigo-500 hover:text-indigo-400 transition-colors"
                        >
                          View screenshot →
                        </button>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          {/snippet}
        </Tabs>
      </div>

      <!-- Right: persona card + run meta -->
      <div class="space-y-4">
        <!-- Run meta -->
        <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-sm space-y-2">
          <h3 class="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">Run info</h3>
          <div class="flex justify-between gap-2">
            <span class="text-zinc-500">Status</span>
            <StatusBadge status={effectiveStatus} />
          </div>
          {#if run.environmentName}
            <div class="flex justify-between gap-2">
              <span class="text-zinc-500">Environment</span>
              <span class="text-zinc-300">{run.environmentName}</span>
            </div>
          {/if}
          <div class="flex justify-between gap-2">
            <span class="text-zinc-500">Base URL</span>
            <span class="text-zinc-300 font-mono text-xs truncate max-w-[10rem]" title={run.baseUrlResolved}>
              {run.baseUrlResolved}
            </span>
          </div>
          {#if run.agentLabel}
            <div class="flex justify-between gap-2">
              <span class="text-zinc-500">Agent</span>
              <span class="text-zinc-300">{run.agentLabel}</span>
            </div>
          {/if}
          <div class="flex justify-between gap-2">
            <span class="text-zinc-500">Started</span>
            <RelativeTime timestamp={run.startedAt} class="text-zinc-300" />
          </div>
          {#if run.finishedAt}
            <div class="flex justify-between gap-2">
              <span class="text-zinc-500">Finished</span>
              <RelativeTime timestamp={run.finishedAt} class="text-zinc-300" />
            </div>
          {/if}
          {#if run.testId === null && run.adhocGoal}
            <div class="pt-2 border-t border-zinc-800">
              <p class="text-xs text-zinc-500 mb-1">Ad-hoc goal</p>
              <p class="text-xs text-zinc-300">{run.adhocGoal}</p>
            </div>
          {/if}
        </div>

        <!-- Persona card -->
        {#if persona}
          <PersonaCard {persona} />
        {:else}
          <div class="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-500">
            Persona not found (id: {run.personaId})
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- Enlarge screenshot modal -->
{#if enlargedShot}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80"
    onclick={() => { enlargedShot = null; }}
    onkeydown={(e) => { if (e.key === 'Escape') enlargedShot = null; }}
    role="dialog"
    aria-modal="true"
    aria-label="Screenshot preview"
    tabindex="-1"
  >
    <img
      src={enlargedShot}
      alt="Screenshot enlarged"
      class="max-h-[90vh] max-w-[95vw] rounded-lg shadow-2xl"
    />
    <button
      type="button"
      onclick={() => { enlargedShot = null; }}
      class="absolute top-4 right-4 rounded-full bg-zinc-900 p-2 text-zinc-400 hover:text-zinc-100"
      aria-label="Close"
    >
      <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
      </svg>
    </button>
  </div>
{/if}

<!-- Promote to test modal -->
<Modal
  open={promoteOpen}
  onclose={() => { promoteOpen = false; }}
  title="Promote run to test"
  size="md"
>
  {#snippet children()}
    <div class="space-y-4">
      <p class="text-sm text-zinc-400">Save this ad-hoc run as a named test that can be run again with any persona.</p>
      <div>
        <label class="block text-sm font-medium text-zinc-300 mb-1.5" for="promote-title">Test title *</label>
        <input
          id="promote-title"
          bind:value={promoteTitle}
          type="text"
          placeholder="e.g. First-time buyer checkout flow"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100
                 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-zinc-300 mb-1.5" for="promote-priority">Priority</label>
        <select
          id="promote-priority"
          bind:value={promotePriority}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100
                 focus:border-indigo-500 focus:outline-none"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-medium text-zinc-300 mb-1.5" for="promote-tags">Tags</label>
        <input
          id="promote-tags"
          bind:value={promoteTags}
          type="text"
          placeholder="checkout, payment, smoke (comma-separated)"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100
                 focus:border-indigo-500 focus:outline-none"
        />
      </div>
      {#if promoteError}
        <p class="text-sm text-red-400">{promoteError}</p>
      {/if}
      <div class="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onclick={() => { promoteOpen = false; }}
          class="rounded-lg px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handlePromote}
          disabled={promoting}
          class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {promoting ? 'Saving…' : 'Promote'}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>
