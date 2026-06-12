<script lang="ts">
  // Accepts an ISO date string (e.g. "2026-06-11T20:03:28.142Z") or null.
  // Adapted from plan: plan typed timestamp as number; entities use string on the wire.
  const { timestamp, class: className = '' }: { timestamp: string | null; class?: string } = $props();

  function format(iso: string, _tick: number): string {
    void _tick; // consumed to create reactivity dependency
    const ts = new Date(iso).getTime();
    const diff = Date.now() - ts;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  // Tick counter incremented by the interval to force a recompute of display.
  let tick = $state(0);

  // $derived recomputes when timestamp or tick changes.
  const display = $derived(timestamp !== null ? format(timestamp, tick) : '—');

  $effect(() => {
    // Re-register interval whenever timestamp changes.
    if (timestamp === null) return;
    const interval = setInterval(() => { tick++; }, 30_000);
    return () => clearInterval(interval);
  });
</script>

<time datetime={timestamp !== null ? timestamp : ''} class={className}>
  {display}
</time>
