<script lang="ts">
  import type { Severity } from '@openuser/shared';

  const { severity }: { severity: Severity } = $props();

  const styles: Record<Severity, string> = {
    critical: 'bg-destructive/15 text-destructive ring-1 ring-destructive/30',
    high:     'bg-warning/15 text-warning ring-1 ring-warning/30',
    medium:   'bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20',
    low:      'bg-muted text-muted-foreground ring-1 ring-border',
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
