<script lang="ts">
  import { page } from '$app/stores';
</script>

<div class="flex h-full min-h-[60vh] flex-col items-center justify-center p-8 text-center">
  <div class="mb-4 text-6xl font-bold text-muted-foreground/40">{$page.status}</div>
  <h1 class="text-2xl font-semibold text-foreground mb-2">
    {$page.status === 404 ? 'Page not found' : 'Something went wrong'}
  </h1>
  <p class="text-muted-foreground mb-6">
    {$page.error?.message ?? 'An unexpected error occurred.'}
  </p>
  <a
    href="/"
    class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
  >
    Go home
  </a>
</div>
