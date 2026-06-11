<script lang="ts">
  const {
    text,
    label = 'Copy',
    class: className = '',
  }: { text: string; label?: string; class?: string } = $props();

  let copied = $state(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {
      // Clipboard unavailable (insecure context / denied) — fail silently.
    }
  }
</script>

<button
  type="button"
  onclick={handleCopy}
  aria-live="polite"
  class="inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium
         bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100
         transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 {className}"
>
  {#if copied}
    <svg class="h-4 w-4 text-green-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
    </svg>
    <span class="text-green-400">Copied!</span>
  {:else}
    <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z"/>
      <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z"/>
    </svg>
    {label}
  {/if}
</button>
