<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    icon,
    title,
    description,
    action,
  }: {
    icon?: string;
    title: string;
    description: string;
    action?: Snippet;
  } = $props();
</script>

<div class="flex flex-col items-center justify-center py-16 px-4 text-center">
  {#if icon}
    <div class="mb-4 text-5xl" role="img" aria-hidden="true">{icon}</div>
  {:else}
    <div class="mb-4 h-12 w-12 rounded-full bg-zinc-800 flex items-center justify-center">
      <svg class="h-6 w-6 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
      </svg>
    </div>
  {/if}
  <h3 class="text-lg font-semibold text-zinc-200">{title}</h3>
  <p class="mt-2 text-sm text-zinc-400 max-w-sm">{description}</p>
  {#if action}
    <div class="mt-6">
      {@render action()}
    </div>
  {/if}
</div>
