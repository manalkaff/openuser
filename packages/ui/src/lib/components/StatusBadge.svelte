<script lang="ts">
  import type { RunStatus } from '@openuser/shared';

  const { status }: { status: RunStatus } = $props();

  const styles: Record<RunStatus, string> = {
    pending:  'bg-zinc-700 text-zinc-300',
    running:  'bg-blue-900 text-blue-300 animate-pulse',
    passed:   'bg-green-900 text-green-300',
    blocked:  'bg-orange-900 text-orange-300',
    failed:   'bg-red-900 text-red-300',
    aborted:  'bg-zinc-700 text-zinc-400',
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
