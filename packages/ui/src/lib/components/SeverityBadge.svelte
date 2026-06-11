<script lang="ts">
  import type { Severity } from '@openuser/shared';

  const { severity }: { severity: Severity } = $props();

  const styles: Record<Severity, string> = {
    critical: 'bg-red-950 text-red-300 ring-1 ring-red-700',
    high:     'bg-orange-950 text-orange-300 ring-1 ring-orange-700',
    medium:   'bg-yellow-950 text-yellow-300 ring-1 ring-yellow-700',
    low:      'bg-zinc-800 text-zinc-400 ring-1 ring-zinc-600',
  };

  const labels: Record<Severity, string> = {
    critical: 'Critical',
    high:     'High',
    medium:   'Medium',
    low:      'Low',
  };
</script>

<span class="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold {styles[severity]}">
  {labels[severity]}
</span>
