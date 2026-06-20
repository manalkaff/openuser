<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { getProjects } from '$lib/api.js';
  import type { ProjectSummary } from '$lib/api.js';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import RelativeTime from '$lib/components/RelativeTime.svelte';
  import NewProjectModal from '$lib/components/NewProjectModal.svelte';

  let projects = $state<ProjectSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showNewProject = $state(false);

  onMount(async () => {
    try {
      projects = await getProjects();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load projects';
    } finally {
      loading = false;
    }
  });

  function cardBorderClass(p: ProjectSummary): string {
    if (p.openFindings > 0) return 'border-l-4 border-l-warning';
    return 'border-l-4 border-l-border';
  }
</script>

<div class="p-8">
  <!-- Header -->
  <div class="mb-8 flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-foreground">Projects</h1>
      <p class="mt-1 text-sm text-muted-foreground">Your registered projects and their health at a glance.</p>
    </div>
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
  </div>

  {#if loading}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each [1, 2, 3] as i (i)}
        <div class="animate-pulse rounded-xl ring-1 ring-foreground/10 bg-card p-5 h-36"></div>
      {/each}
    </div>
  {:else if error}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {error}
    </div>
  {:else if projects.length === 0}
    <EmptyState
      icon="🗂️"
      title="No projects yet"
      description="Register your first project to start testing. Run `openuser init` in your project directory or use the button above."
    >
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
    </EmptyState>
  {:else}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each projects as project (project.id)}
        <button
          type="button"
          onclick={() => goto(`/projects/${project.id}`)}
          class="group relative text-left rounded-xl ring-1 ring-foreground/10 bg-card p-5
                 hover:ring-foreground/20 hover:bg-card/80 transition-all {cardBorderClass(project)}"
        >
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="min-w-0">
              <h2 class="font-semibold text-foreground truncate group-hover:text-foreground/90">
                {project.name}
              </h2>
              <p class="text-xs text-muted-foreground truncate mt-0.5 font-mono">{project.path}</p>
            </div>
            {#if project.openFindings > 0}
              <span class="shrink-0 inline-flex items-center rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-medium text-warning">
                {project.openFindings} open
              </span>
            {:else}
              <span class="shrink-0 inline-flex items-center rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-medium text-success">
                Clean
              </span>
            {/if}
          </div>

          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span class="truncate">{project.baseUrl}</span>
            {#if project.lastRunAt}
              <RelativeTime timestamp={project.lastRunAt} class="shrink-0 ml-2" />
            {:else}
              <span class="shrink-0 ml-2 text-muted-foreground/60">No runs</span>
            {/if}
          </div>

          <!-- Hover arrow -->
          <div class="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
            <svg aria-hidden="true" class="h-4 w-4 text-muted-foreground" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
            </svg>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<NewProjectModal open={showNewProject} onclose={() => (showNewProject = false)} />
