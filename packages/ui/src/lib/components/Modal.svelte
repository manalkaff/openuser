<script lang="ts">
  import type { Snippet } from 'svelte';

  const {
    open,
    onclose,
    title,
    children,
    size = 'md',
  }: {
    open: boolean;
    onclose: () => void;
    title: string;
    children: Snippet;
    size?: 'sm' | 'md' | 'lg' | 'xl';
  } = $props();

  const sizeClasses: Record<'sm' | 'md' | 'lg' | 'xl', string> = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') onclose();
  }

  let panelEl = $state<HTMLElement | null>(null);

  $effect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      panelEl?.focus();
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
  >
    <!-- Backdrop overlay -->
    <div
      class="fixed inset-0 bg-black/60 backdrop-blur-sm"
      onclick={onclose}
      aria-hidden="true"
    ></div>

    <!-- Panel -->
    <div bind:this={panelEl} tabindex="-1" class="relative z-10 w-full {sizeClasses[size]} rounded-xl bg-zinc-900 border border-zinc-800 shadow-2xl focus:outline-none">
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h2 id="modal-title" class="text-lg font-semibold text-zinc-100">{title}</h2>
        <button
          type="button"
          onclick={onclose}
          class="rounded p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          aria-label="Close"
        >
          <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-6 py-4">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
