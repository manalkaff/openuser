<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { getCheckpoints, getPersonas, deleteCheckpoint } from '$lib/api.js';
  import type { Checkpoint, Persona } from '@openuser/shared';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';

  const projectId = $derived($page.params['id'] ?? '');

  let checkpoints = $state<Checkpoint[]>([]);
  let personas = $state<Persona[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let deletingId = $state<string | null>(null);

  onMount(async () => {
    try {
      [checkpoints, personas] = await Promise.all([
        getCheckpoints(projectId),
        getPersonas(projectId),
      ]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load checkpoints';
    } finally {
      loading = false;
    }
  });

  function personaName(personaId: string): string {
    return personas.find(p => p.id === personaId)?.name ?? personaId;
  }

  async function handleDelete(cp: Checkpoint) {
    if (!confirm(`Delete checkpoint "${cp.name}"? This cannot be undone.`)) return;
    deletingId = cp.id;
    try {
      await deleteCheckpoint(cp.id);
      checkpoints = checkpoints.filter(c => c.id !== cp.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      deletingId = null;
    }
  }
</script>

<div class="p-8">
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-zinc-100">Checkpoints</h1>
    <p class="mt-1 text-sm text-zinc-400">
      Saved browser sessions and journey notes. Checkpoints let test runs resume from a known state (e.g. logged-in user with items in cart).
    </p>
  </div>

  {#if loading}
    <div class="space-y-2">
      {#each [1, 2, 3] as i (i)}
        <div class="animate-pulse rounded-lg border border-zinc-800 bg-zinc-900 h-20"></div>
      {/each}
    </div>
  {:else if error}
    <div class="rounded-lg border border-red-900 bg-red-950/30 p-4 text-sm text-red-400">{error}</div>
  {:else if checkpoints.length === 0}
    <EmptyState
      icon="🚩"
      title="No checkpoints yet"
      description="Checkpoints are created by tester agents during runs (via save_checkpoint). They capture browser session state so future runs can resume mid-journey."
    />
  {:else}
    <div class="rounded-xl border border-zinc-800 bg-zinc-900 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
            <th class="py-3 px-4 text-left font-medium">Checkpoint</th>
            <th class="py-3 px-4 text-left font-medium w-36">Persona</th>
            <th class="py-3 px-4 text-left font-medium w-48">Journey notes</th>
            <th class="py-3 px-4 text-left font-medium w-32">Saved at URL</th>
            <th class="py-3 px-4 text-left font-medium w-28">Created</th>
            <th class="py-3 px-4 text-right font-medium w-20"></th>
          </tr>
        </thead>
        <tbody>
          {#each checkpoints as cp (cp.id)}
            <tr class="border-b border-zinc-800 last:border-0 hover:bg-zinc-800/40 transition-colors">
              <td class="py-3 px-4">
                <div class="font-medium text-zinc-200">{cp.name}</div>
                {#if cp.description}
                  <div class="text-xs text-zinc-500 mt-0.5">{cp.description}</div>
                {/if}
                {#if cp.createdFromRunId}
                  <a
                    href="/runs/{cp.createdFromRunId}"
                    class="text-xs text-indigo-500 hover:text-indigo-400 transition-colors mt-0.5 inline-block"
                  >
                    From run →
                  </a>
                {/if}
              </td>
              <td class="py-3 px-4">
                <span class="text-xs text-zinc-400">{personaName(cp.personaId)}</span>
              </td>
              <td class="py-3 px-4">
                <p class="text-xs text-zinc-400 line-clamp-2">{cp.journey.notes || '—'}</p>
              </td>
              <td class="py-3 px-4">
                <span class="text-xs text-zinc-500 font-mono truncate block max-w-[12rem]" title={cp.journey.url}>
                  {cp.journey.url || '—'}
                </span>
              </td>
              <td class="py-3 px-4">
                <RelativeTime timestamp={cp.createdAt} class="text-xs text-zinc-500" />
              </td>
              <td class="py-3 px-4 text-right">
                <button
                  type="button"
                  onclick={() => handleDelete(cp)}
                  disabled={deletingId === cp.id}
                  class="rounded px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-950/30
                         disabled:opacity-50 transition-colors"
                >
                  {deletingId === cp.id ? '…' : 'Delete'}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
