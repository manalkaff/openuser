<script lang="ts">
  import type { Persona } from '@openuser/shared';

  const { persona }: { persona: Persona } = $props();
</script>

<div class="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
  <!-- Header -->
  <div class="flex items-start justify-between gap-2">
    <div>
      <h3 class="font-semibold text-zinc-100">{persona.name}</h3>
      <p class="text-sm text-zinc-400">{persona.role}</p>
    </div>
    {#if persona.archived}
      <span class="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">Archived</span>
    {/if}
  </div>

  <!-- Identity -->
  <section>
    <h4 class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">Identity</h4>
    <dl class="text-sm space-y-1">
      <div class="flex gap-2">
        <dt class="text-zinc-500 w-24 shrink-0">Full name</dt>
        <dd class="text-zinc-300">{persona.identity.fullName}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-zinc-500 w-24 shrink-0">Role</dt>
        <dd class="text-zinc-300">{persona.identity.roleLabel}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-zinc-500 w-24 shrink-0">Locale</dt>
        <dd class="text-zinc-300">{persona.identity.locale}</dd>
      </div>
      {#if persona.identity.credentials}
        <div class="flex gap-2">
          <dt class="text-zinc-500 w-24 shrink-0">Username</dt>
          <dd class="text-zinc-300 font-mono text-xs">{persona.identity.credentials.username}</dd>
        </div>
      {/if}
      {#if persona.identity.signupInstructions}
        <div class="flex gap-2">
          <dt class="text-zinc-500 w-24 shrink-0">Signup</dt>
          <dd class="text-zinc-300">{persona.identity.signupInstructions}</dd>
        </div>
      {/if}
    </dl>
  </section>

  <!-- Behavior -->
  <section>
    <h4 class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">Behavior</h4>
    <div class="flex flex-wrap gap-2 text-xs">
      <span class="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
        {persona.behavior.techSavviness} tech
      </span>
      <span class="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
        {persona.behavior.patience} patience
      </span>
      <span class="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
        {persona.behavior.readingStyle}
      </span>
      <span class="bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded">
        {persona.behavior.device} {persona.behavior.viewport.width}×{persona.behavior.viewport.height}
      </span>
    </div>
    {#if persona.behavior.habits}
      <p class="mt-2 text-sm text-zinc-400">{persona.behavior.habits}</p>
    {/if}
  </section>

  <!-- Knowledge -->
  <section>
    <h4 class="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1.5">Knowledge</h4>
    <p class="text-sm text-zinc-400">{persona.knowledge.productKnowledge}</p>
  </section>

  {#if persona.notes}
    <p class="text-xs text-zinc-500 border-t border-zinc-800 pt-2">{persona.notes}</p>
  {/if}
</div>
