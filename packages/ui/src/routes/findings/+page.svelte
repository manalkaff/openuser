<script lang="ts">
  import { onMount } from 'svelte';
  import { getFindings, getProjects, patchFinding } from '$lib/api.js';
  import type { ProjectSummary } from '$lib/api.js';
  import type { Finding, Severity, FindingType, FindingStatus } from '@openuser/shared';
  import SeverityBadge from '$lib/components/SeverityBadge.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';

  let findings = $state<Finding[]>([]);
  let projects = $state<ProjectSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Filters
  let filterProject = $state('');
  let filterSeverity = $state<Severity | ''>('');
  let filterType = $state<FindingType | ''>('');
  let filterStatus = $state<FindingStatus | ''>('open');

  // Expanded rows (show evidence)
  let expandedIds = $state<Set<string>>(new Set());

  // Inline status update
  let updatingId = $state<string | null>(null);
  let statusError = $state<string | null>(null);

  onMount(async () => {
    try {
      [findings, projects] = await Promise.all([
        getFindings({ status: 'open' }),
        getProjects(),
      ]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load findings';
    } finally {
      loading = false;
    }
  });

  async function applyFilters() {
    loading = true;
    error = null;
    try {
      findings = await getFindings({
        ...(filterProject ? { projectId: filterProject } : {}),
        ...(filterSeverity ? { severity: filterSeverity } : {}),
        ...(filterType ? { type: filterType } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load findings';
    } finally {
      loading = false;
    }
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedIds = next;
  }

  async function handleStatusChange(finding: Finding, newStatus: FindingStatus) {
    statusError = null;
    updatingId = finding.id;
    try {
      const updated = await patchFinding(finding.id, newStatus);
      findings = findings.map(f => f.id === updated.id ? updated : f);
    } catch (e) {
      statusError = e instanceof Error ? e.message : 'Failed to update status';
    } finally {
      updatingId = null;
    }
  }

  function projectName(projectId: string): string {
    return projects.find(p => p.id === projectId)?.name ?? projectId;
  }

  const statusOptions: { value: FindingStatus; label: string }[] = [
    { value: 'open', label: 'Open' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' },
  ];

  const statusBadgeClass: Record<FindingStatus, string> = {
    open: 'text-orange-400',
    acknowledged: 'text-blue-400',
    resolved: 'text-green-400',
    dismissed: 'text-zinc-500',
  };
</script>

<div class="p-8">
  <!-- Header -->
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-zinc-100">Findings</h1>
    <p class="mt-1 text-sm text-zinc-400">Cross-project issue inbox — triage, acknowledge, and resolve findings from all runs.</p>
  </div>

  <!-- Filters -->
  <div class="mb-4 flex flex-wrap gap-3">
    <select
      bind:value={filterProject}
      onchange={applyFilters}
      class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300
             focus:border-indigo-500 focus:outline-none"
    >
      <option value="">All projects</option>
      {#each projects as p (p.id)}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>

    <select
      bind:value={filterSeverity}
      onchange={applyFilters}
      class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300
             focus:border-indigo-500 focus:outline-none"
    >
      <option value="">All severities</option>
      <option value="critical">Critical</option>
      <option value="high">High</option>
      <option value="medium">Medium</option>
      <option value="low">Low</option>
    </select>

    <select
      bind:value={filterType}
      onchange={applyFilters}
      class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300
             focus:border-indigo-500 focus:outline-none"
    >
      <option value="">All types</option>
      <option value="functional">Functional</option>
      <option value="console">Console</option>
      <option value="network">Network</option>
      <option value="ux_confusion">UX confusion</option>
    </select>

    <select
      bind:value={filterStatus}
      onchange={applyFilters}
      class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300
             focus:border-indigo-500 focus:outline-none"
    >
      <option value="">All statuses</option>
      <option value="open">Open</option>
      <option value="acknowledged">Acknowledged</option>
      <option value="resolved">Resolved</option>
      <option value="dismissed">Dismissed</option>
    </select>

    <span class="self-center text-xs text-zinc-500">
      {findings.length} result{findings.length !== 1 ? 's' : ''}
    </span>
  </div>

  {#if statusError}
    <div class="mb-4 rounded-lg border border-red-900 bg-red-950/30 p-3 text-sm text-red-400">{statusError}</div>
  {/if}

  {#if loading}
    <div class="space-y-2">
      {#each [1, 2, 3, 4] as i (i)}
        <div class="animate-pulse rounded-lg border border-zinc-800 bg-zinc-900 h-20"></div>
      {/each}
    </div>
  {:else if error}
    <div class="rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">{error}</div>
  {:else if findings.length === 0}
    <EmptyState
      icon="✅"
      title="No findings"
      description="No findings match your current filters. Change the filters or run tests to surface issues."
    />
  {:else}
    <div class="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      {#each findings as finding (finding.id)}
        <div class="border-b border-zinc-800 last:border-0">
          <!-- Main row -->
          <div
            class="flex items-start gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors cursor-pointer"
            onclick={() => toggleExpand(finding.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpand(finding.id); }}
            aria-expanded={expandedIds.has(finding.id)}
          >
            <!-- Severity -->
            <div class="shrink-0 pt-0.5">
              <SeverityBadge severity={finding.severity} />
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="text-sm font-medium text-zinc-200">{finding.title}</p>
                  <p class="text-xs text-zinc-500 mt-0.5">
                    <span class="capitalize">{finding.type.replace('_', ' ')}</span>
                    &middot;
                    <a
                      href="/projects/{finding.projectId}"
                      class="hover:text-zinc-300 transition-colors"
                      onclick={(e) => e.stopPropagation()}
                    >
                      {projectName(finding.projectId)}
                    </a>
                    &middot;
                    <a
                      href="/runs/{finding.runId}"
                      class="text-indigo-500 hover:text-indigo-400 transition-colors"
                      onclick={(e) => e.stopPropagation()}
                    >
                      View run →
                    </a>
                  </p>
                </div>

                <!-- Status selector -->
                <div class="flex items-center gap-2 shrink-0">
                  <RelativeTime timestamp={finding.createdAt} class="text-xs text-zinc-600 hidden sm:block" />
                  <select
                    value={finding.status}
                    disabled={updatingId === finding.id}
                    onclick={(e) => e.stopPropagation()}
                    onchange={(e) => {
                      e.stopPropagation();
                      const el = e.currentTarget as HTMLSelectElement;
                      handleStatusChange(finding, el.value as FindingStatus);
                    }}
                    class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs
                           {statusBadgeClass[finding.status]}
                           focus:border-indigo-500 focus:outline-none disabled:opacity-50"
                  >
                    {#each statusOptions as opt (opt.value)}
                      <option value={opt.value}>{opt.label}</option>
                    {/each}
                  </select>
                </div>
              </div>
            </div>

            <!-- Expand chevron -->
            <div class="shrink-0 text-zinc-600">
              <svg class="h-4 w-4 transition-transform {expandedIds.has(finding.id) ? 'rotate-180' : ''}"
                viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"/>
              </svg>
            </div>
          </div>

          <!-- Expanded evidence -->
          {#if expandedIds.has(finding.id)}
            <div class="px-4 pb-4 bg-zinc-950/40">
              <!-- Description (user-voice narrative) -->
              <blockquote class="border-l-2 border-indigo-600 pl-3 mb-3">
                <p class="text-sm text-zinc-300 italic">"{finding.description}"</p>
              </blockquote>

              <!-- Evidence -->
              <div class="space-y-2">
                {#if finding.evidence.screenshotPath}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 mb-1">Screenshot</p>
                    <a href="/runs/{finding.runId}" class="inline-block">
                      <img
                        src={`/artifacts/${finding.runId}/${finding.evidence.screenshotPath}`}
                        alt="Evidence screenshot"
                        class="rounded border border-zinc-700 max-h-32 object-cover"
                        loading="lazy"
                      />
                    </a>
                  </div>
                {/if}

                {#if finding.evidence.consoleExcerpt && finding.evidence.consoleExcerpt.length > 0}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 mb-1">Console excerpt</p>
                    <pre class="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-red-400 font-mono overflow-x-auto max-h-20">{JSON.stringify(finding.evidence.consoleExcerpt, null, 2)}</pre>
                  </div>
                {/if}

                {#if finding.evidence.networkExcerpt && finding.evidence.networkExcerpt.length > 0}
                  <div>
                    <p class="text-xs font-medium text-zinc-500 mb-1">Network excerpt</p>
                    <div class="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 space-y-1">
                      {#each finding.evidence.networkExcerpt as req, i (i)}
                        <div class="text-xs font-mono">
                          <span class="text-red-400">{req.status}</span>
                          <span class="text-zinc-500 mx-1">{req.method}</span>
                          <span class="text-zinc-300">{req.url}</span>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
