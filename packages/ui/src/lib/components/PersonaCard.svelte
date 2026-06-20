<script lang="ts">
  import type { Persona } from '@openuser/shared';

  const { persona }: { persona: Persona } = $props();
</script>

<div class="rounded-xl ring-1 ring-foreground/10 bg-card p-4 space-y-3">
  <!-- Header -->
  <div class="flex items-start justify-between gap-2">
    <div>
      <h3 class="font-semibold text-foreground">{persona.name}</h3>
      <p class="text-sm text-muted-foreground">{persona.role}</p>
    </div>
    {#if persona.archived}
      <span class="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">Archived</span>
    {/if}
  </div>

  <!-- Identity -->
  <section>
    <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Identity</h4>
    <dl class="text-sm space-y-1">
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-24 shrink-0">Full name</dt>
        <dd class="text-foreground">{persona.identity.fullName}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-24 shrink-0">Role</dt>
        <dd class="text-foreground">{persona.identity.roleLabel}</dd>
      </div>
      <div class="flex gap-2">
        <dt class="text-muted-foreground w-24 shrink-0">Locale</dt>
        <dd class="text-foreground">{persona.identity.locale}</dd>
      </div>
      {#if persona.identity.credentials}
        <div class="flex gap-2">
          <dt class="text-muted-foreground w-24 shrink-0">Username</dt>
          <dd class="text-foreground font-mono text-xs">{persona.identity.credentials.username}</dd>
        </div>
      {/if}
      {#if persona.identity.signupInstructions}
        <div class="flex gap-2">
          <dt class="text-muted-foreground w-24 shrink-0">Signup</dt>
          <dd class="text-foreground">{persona.identity.signupInstructions}</dd>
        </div>
      {/if}
    </dl>
  </section>

  <!-- Behavior -->
  <section>
    <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Behavior</h4>
    <div class="flex flex-wrap gap-2 text-xs">
      <span class="bg-muted text-foreground/80 px-2 py-0.5 rounded">
        {persona.behavior.techSavviness} tech
      </span>
      <span class="bg-muted text-foreground/80 px-2 py-0.5 rounded">
        {persona.behavior.patience} patience
      </span>
      <span class="bg-muted text-foreground/80 px-2 py-0.5 rounded">
        {persona.behavior.readingStyle}
      </span>
      <span class="bg-muted text-foreground/80 px-2 py-0.5 rounded">
        {persona.behavior.device} {persona.behavior.viewport.width}×{persona.behavior.viewport.height}
      </span>
    </div>
    {#if persona.behavior.habits}
      <p class="mt-2 text-sm text-muted-foreground">{persona.behavior.habits}</p>
    {/if}
  </section>

  <!-- Knowledge -->
  <section>
    <h4 class="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Knowledge</h4>
    <p class="text-sm text-muted-foreground">{persona.knowledge.productKnowledge}</p>
  </section>

  {#if persona.notes}
    <p class="text-xs text-muted-foreground/60 border-t border-border pt-2">{persona.notes}</p>
  {/if}
</div>
