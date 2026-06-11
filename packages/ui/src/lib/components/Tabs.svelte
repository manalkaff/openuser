<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    tabs,
    active,
    onchange,
    children,
  }: {
    tabs: { id: string; label: string; count?: number }[];
    active: string;
    onchange: (id: string) => void;
    children: Snippet;
  } = $props();

  function handleTablistKeydown(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const currentIndex = tabs.findIndex((t) => t.id === active);
    if (currentIndex === -1) return;
    let nextIndex: number;
    if (e.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    }
    const nextTab = tabs[nextIndex];
    if (nextTab !== undefined) {
      onchange(nextTab.id);
    }
  }
</script>

<div>
  <!-- Tab bar -->
  <div class="flex gap-1 border-b border-zinc-800 mb-4" role="tablist" tabindex="0" onkeydown={handleTablistKeydown}>
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        id="tab-{tab.id}"
        aria-selected={active === tab.id}
        aria-controls="panel-{tab.id}"
        onclick={() => onchange(tab.id)}
        class="relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors
               focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-t
               {active === tab.id
                 ? 'text-indigo-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-500'
                 : 'text-zinc-400 hover:text-zinc-200'}"
      >
        {tab.label}
        {#if tab.count !== undefined}
          <span class="rounded-full bg-zinc-800 px-1.5 py-0.5 text-xs {active === tab.id ? 'text-indigo-400' : 'text-zinc-500'}">
            {tab.count}
          </span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Tab panel -->
  <div id="panel-{active}" role="tabpanel" aria-labelledby="tab-{active}">
    {@render children()}
  </div>
</div>
