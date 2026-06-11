<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import '../app.css';
  import { wsConnect, wsDisconnect, wsSubscribe, wsState } from '$lib/ws.svelte.js';
  import { getHealth } from '$lib/api.js';

  const { children }: { children: Snippet } = $props();

  let version = $state<string>('');

  onMount(() => {
    wsConnect();
    wsSubscribe('global');
    getHealth().then((h) => { version = h.version; }).catch(() => {});
    return () => wsDisconnect();
  });

  // Determine active project id from URL if inside a project route
  const projectId = $derived(
    $page.params.id && $page.url.pathname.startsWith('/projects/')
      ? $page.params.id
      : null
  );

  const isInsideProject = $derived(projectId !== null);

  const navItems = [
    { href: '/', label: 'Home', icon: 'home' },
    { href: '/findings', label: 'Findings', icon: 'findings' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ];

  const projectNavItems = $derived(
    isInsideProject
      ? [
          { href: `/projects/${projectId}`, label: 'Tests', icon: 'tests' },
          { href: `/projects/${projectId}/personas`, label: 'Personas', icon: 'personas' },
          { href: `/projects/${projectId}/checkpoints`, label: 'Checkpoints', icon: 'checkpoints' },
        ]
      : []
  );

  function isActive(href: string): boolean {
    if (href === '/') return $page.url.pathname === '/';
    return $page.url.pathname.startsWith(href);
  }
</script>

<div class="flex h-screen overflow-hidden bg-zinc-950">
  <!-- Sidebar -->
  <aside class="w-56 shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-950">
    <!-- Logo -->
    <div class="flex items-center gap-2.5 px-4 py-4 border-b border-zinc-800">
      <img src="/favicon.svg" alt="OpenUser" class="h-7 w-7" />
      <span class="font-bold text-zinc-100 tracking-tight">OpenUser</span>
    </div>

    <!-- Main nav -->
    <nav class="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto" aria-label="Main navigation">
      {#each navItems as item (item.href)}
        <a
          href={item.href}
          class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                 {isActive(item.href)
                   ? 'bg-indigo-600/20 text-indigo-300'
                   : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}"
        >
          {#if item.icon === 'home'}
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"/>
            </svg>
          {:else if item.icon === 'findings'}
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
            </svg>
          {:else if item.icon === 'settings'}
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>
            </svg>
          {/if}
          {item.label}
        </a>
      {/each}

      <!-- Project subnav -->
      {#if isInsideProject && projectNavItems.length > 0}
        <div class="mt-4 pt-4 border-t border-zinc-800">
          <p class="px-3 mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Project</p>
          {#each projectNavItems as item (item.href)}
            <a
              href={item.href}
              class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors
                     {isActive(item.href)
                       ? 'bg-indigo-600/20 text-indigo-300'
                       : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}"
            >
              {#if item.icon === 'tests'}
                <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clip-rule="evenodd"/>
                </svg>
              {:else if item.icon === 'personas'}
                <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/>
                </svg>
              {:else if item.icon === 'checkpoints'}
                <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 7l2.55 2.4A1 1 0 0116 11H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" clip-rule="evenodd"/>
                </svg>
              {/if}
              {item.label}
            </a>
          {/each}
        </div>
      {/if}
    </nav>

    <!-- Footer: connection indicator -->
    <div class="px-4 py-3 border-t border-zinc-800">
      <div class="flex items-center gap-2 text-xs text-zinc-500">
        <span class="h-1.5 w-1.5 rounded-full {wsState.connected ? 'bg-green-400' : 'bg-zinc-600'}"></span>
        <span>{wsState.connected ? 'Live' : 'Offline'}</span>
        {#if version}
          <span class="ml-auto">v{version}</span>
        {/if}
      </div>
    </div>
  </aside>

  <!-- Main content -->
  <main class="flex-1 overflow-y-auto">
    {@render children()}
  </main>
</div>
