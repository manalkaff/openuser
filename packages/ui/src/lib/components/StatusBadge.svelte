<script lang="ts">
  import type { RunStatus } from '@openuser/shared';

  const { status }: { status: RunStatus } = $props();

  const styles: Record<RunStatus, string> = {
    pending:  'bg-muted text-muted-foreground',
    running:  'bg-info/15 text-info animate-pulse',
    passed:   'bg-success/15 text-success',
    blocked:  'bg-warning/15 text-warning',
    failed:   'bg-destructive/15 text-destructive',
    aborted:  'bg-muted text-muted-foreground',
  };

  const labels: Record<RunStatus, string> = {
    pending:  'Pending',
    running:  'Running',
    passed:   'Passed',
    blocked:  'Blocked',
    failed:   'Failed',
    aborted:  'Aborted',
  };
</script>

<span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {styles[status]}">
  {labels[status]}
</span>
