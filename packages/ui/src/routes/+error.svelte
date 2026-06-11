<script lang="ts">
  import { page } from '$app/stores';
</script>

<div class="flex h-full min-h-[60vh] flex-col items-center justify-center p-8 text-center">
  <div class="mb-4 text-6xl font-bold text-zinc-700">{$page.status}</div>
  <h1 class="text-2xl font-semibold text-zinc-200 mb-2">
    {$page.status === 404 ? 'Page not found' : 'Something went wrong'}
  </h1>
  <p class="text-zinc-400 mb-6">
    {$page.error?.message ?? 'An unexpected error occurred.'}
  </p>
  <a
    href="/"
    class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
  >
    Go home
  </a>
</div>
