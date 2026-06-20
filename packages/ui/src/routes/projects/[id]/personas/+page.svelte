<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { getPersonas, createPersona, patchPersona, getCheckpoints } from '$lib/api.js';
  import type { CreatePersonaBody } from '$lib/api.js';
  import type { Persona, Checkpoint } from '@openuser/shared';
  import PersonaCard from '$lib/components/PersonaCard.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';

  const projectId = $derived($page.params['id'] ?? '');

  let personas = $state<Persona[]>([]);
  let checkpoints = $state<Checkpoint[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let formOpen = $state(false);
  let editingPersona = $state<Persona | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let archiveError = $state<string | null>(null);

  let fname = $state('');
  let frole = $state('');
  let fnotes = $state('');
  let fFullName = $state('');
  let fRoleLabel = $state('');
  let fLocale = $state('en');
  let fCredUsername = $state('');
  let fCredPassword = $state('');
  let fSignupInstructions = $state('');
  let fTechSavviness = $state<'novice' | 'average' | 'expert'>('average');
  let fPatience = $state<'low' | 'medium' | 'high'>('medium');
  let fReadingStyle = $state<'skims' | 'reads'>('reads');
  let fDevice = $state<'desktop' | 'mobile'>('desktop');
  let fViewportWidth = $state(1280);
  let fViewportHeight = $state(720);
  let fHabits = $state('');
  let fProductKnowledge = $state('');
  let fExpectations = $state('');
  let fVocabulary = $state('');

  onMount(async () => {
    try {
      [personas, checkpoints] = await Promise.all([
        getPersonas(projectId),
        getCheckpoints(projectId),
      ]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load personas';
    } finally {
      loading = false;
    }
  });

  function linkedCheckpoints(personaId: string): Checkpoint[] {
    return checkpoints.filter(c => c.personaId === personaId);
  }

  function openCreate() {
    editingPersona = null;
    fname = ''; frole = ''; fnotes = '';
    fFullName = ''; fRoleLabel = ''; fLocale = 'en';
    fCredUsername = ''; fCredPassword = ''; fSignupInstructions = '';
    fTechSavviness = 'average'; fPatience = 'medium'; fReadingStyle = 'reads';
    fDevice = 'desktop'; fViewportWidth = 1280; fViewportHeight = 720; fHabits = '';
    fProductKnowledge = ''; fExpectations = ''; fVocabulary = '';
    saveError = null;
    formOpen = true;
  }

  function openEdit(p: Persona) {
    editingPersona = p;
    fname = p.name; frole = p.role; fnotes = p.notes ?? '';
    fFullName = p.identity.fullName; fRoleLabel = p.identity.roleLabel; fLocale = p.identity.locale;
    fCredUsername = p.identity.credentials?.username ?? '';
    fCredPassword = p.identity.credentials?.password ?? '';
    fSignupInstructions = p.identity.signupInstructions ?? '';
    fTechSavviness = p.behavior.techSavviness; fPatience = p.behavior.patience;
    fReadingStyle = p.behavior.readingStyle; fDevice = p.behavior.device;
    fViewportWidth = p.behavior.viewport.width; fViewportHeight = p.behavior.viewport.height;
    fHabits = p.behavior.habits;
    fProductKnowledge = p.knowledge.productKnowledge;
    fExpectations = p.knowledge.expectations;
    fVocabulary = p.knowledge.vocabulary;
    saveError = null;
    formOpen = true;
  }

  async function handleSave() {
    if (!fname.trim() || !frole.trim() || !fFullName.trim() || !fRoleLabel.trim()) {
      saveError = 'Name, role, full name, and role label are required.';
      return;
    }
    if ((fCredUsername && !fCredPassword) || (!fCredUsername && fCredPassword)) {
      saveError = 'Both username and password are required when providing credentials.';
      return;
    }
    saveError = null;
    saving = true;
    try {
      const body: CreatePersonaBody = {
        name: fname.trim(),
        role: frole.trim(),
        ...(fnotes.trim() ? { notes: fnotes.trim() } : {}),
        identity: {
          fullName: fFullName.trim(),
          roleLabel: fRoleLabel.trim(),
          locale: fLocale.trim(),
          ...(fCredUsername ? { credentials: { username: fCredUsername, password: fCredPassword } } : {}),
          ...(fSignupInstructions ? { signupInstructions: fSignupInstructions.trim() } : {}),
        },
        behavior: {
          techSavviness: fTechSavviness,
          patience: fPatience,
          readingStyle: fReadingStyle,
          device: fDevice,
          viewport: { width: fViewportWidth, height: fViewportHeight },
          habits: fHabits.trim(),
        },
        knowledge: {
          productKnowledge: fProductKnowledge.trim(),
          expectations: fExpectations.trim(),
          vocabulary: fVocabulary.trim(),
        },
      };
      if (editingPersona) {
        const updated = await patchPersona(editingPersona.id, body);
        personas = personas.map(p => p.id === updated.id ? updated : p);
      } else {
        const created = await createPersona(projectId, body);
        personas = [...personas, created];
      }
      formOpen = false;
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function handleArchive(p: Persona) {
    archiveError = null;
    try {
      const updated = await patchPersona(p.id, { archived: !p.archived });
      personas = personas.map(x => x.id === updated.id ? updated : x);
    } catch (e) {
      archiveError = e instanceof Error ? e.message : 'Archive failed';
    }
  }

  const inputClass = "w-full rounded border border-border bg-muted px-3 py-1.5 text-sm text-foreground focus:border-ring focus:outline-none";
  const labelClass = "block text-xs text-muted-foreground mb-1";
</script>

<div class="p-8">
  <div class="mb-6 flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-foreground">Personas</h1>
      <p class="mt-1 text-sm text-muted-foreground">Define user types to embody during test runs.</p>
    </div>
    <button
      type="button"
      onclick={openCreate}
      class="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
    >
      <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/>
      </svg>
      New persona
    </button>
  </div>

  {#if archiveError}
    <div class="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{archiveError}</div>
  {/if}

  {#if loading}
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {#each [1, 2] as i (i)}
        <div class="animate-pulse rounded-xl ring-1 ring-foreground/10 bg-card h-56"></div>
      {/each}
    </div>
  {:else if error}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
  {:else if personas.length === 0}
    <EmptyState
      icon="👤"
      title="No personas yet"
      description="Create user personas to define who will test your application. Include their identity, behavior traits, and product knowledge."
    >
      {#snippet action()}
        <button
          type="button"
          onclick={openCreate}
          class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors"
        >
          Create first persona
        </button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {#each personas as persona (persona.id)}
        <div class="relative">
          <PersonaCard {persona} />
          <div class="absolute top-4 right-4 flex gap-2">
            <button
              type="button"
              onclick={() => openEdit(persona)}
              class="rounded px-2 py-1 text-xs text-muted-foreground bg-muted hover:text-foreground hover:bg-accent transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              onclick={() => handleArchive(persona)}
              class="rounded px-2 py-1 text-xs text-muted-foreground bg-muted hover:text-foreground hover:bg-accent transition-colors"
            >
              {persona.archived ? 'Unarchive' : 'Archive'}
            </button>
          </div>
          {#if linkedCheckpoints(persona.id).length > 0}
            <div class="mt-2 rounded-lg border border-border bg-card/50 px-4 py-2">
              <p class="text-xs text-muted-foreground mb-1.5">Linked checkpoints</p>
              <div class="flex flex-wrap gap-2">
                {#each linkedCheckpoints(persona.id) as cp (cp.id)}
                  <a
                    href="/projects/{projectId}/checkpoints"
                    class="text-xs bg-muted text-muted-foreground hover:text-foreground px-2 py-0.5 rounded transition-colors"
                  >
                    {cp.name}
                  </a>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Create / Edit modal -->
<Modal
  open={formOpen}
  onclose={() => { formOpen = false; }}
  title={editingPersona ? `Edit ${editingPersona.name}` : 'New persona'}
  size="xl"
>
  {#snippet children()}
    <div class="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
      <!-- Basic -->
      <section>
        <h3 class="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">Basic</h3>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class={labelClass} for="p-name">Name *</label>
            <input id="p-name" bind:value={fname} type="text" placeholder="e.g. Ali the Reseller" class={inputClass} />
          </div>
          <div>
            <label class={labelClass} for="p-role">Role *</label>
            <input id="p-role" bind:value={frole} type="text" placeholder="e.g. reseller" class={inputClass} />
          </div>
        </div>
        <div class="mt-3">
          <label class={labelClass} for="p-notes">Notes</label>
          <textarea id="p-notes" bind:value={fnotes} rows="2" placeholder="Internal notes about this persona"
            class="{inputClass} resize-none"></textarea>
        </div>
      </section>

      <!-- Identity -->
      <section>
        <h3 class="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">Identity</h3>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class={labelClass} for="p-fullname">Full name *</label>
            <input id="p-fullname" bind:value={fFullName} type="text" placeholder="e.g. Ahmad Ali" class={inputClass} />
          </div>
          <div>
            <label class={labelClass} for="p-rolelabel">Role label *</label>
            <input id="p-rolelabel" bind:value={fRoleLabel} type="text" placeholder="e.g. Reseller" class={inputClass} />
          </div>
          <div>
            <label class={labelClass} for="p-locale">Locale</label>
            <input id="p-locale" bind:value={fLocale} type="text" placeholder="en" class={inputClass} />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3 mt-3">
          <div>
            <label class={labelClass} for="p-creduser">Username (credentials)</label>
            <input id="p-creduser" bind:value={fCredUsername} type="text" placeholder="Optional login username" class={inputClass} />
          </div>
          <div>
            <label class={labelClass} for="p-credpass">Password</label>
            <input id="p-credpass" bind:value={fCredPassword} type="password" placeholder="Optional password" class={inputClass} />
          </div>
        </div>
        <div class="mt-3">
          <label class={labelClass} for="p-signup">Signup instructions</label>
          <textarea id="p-signup" bind:value={fSignupInstructions} rows="2" placeholder="Instructions if this persona needs to create a fresh account"
            class="{inputClass} resize-none"></textarea>
        </div>
      </section>

      <!-- Behavior -->
      <section>
        <h3 class="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">Behavior</h3>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class={labelClass} for="p-tech">Tech savviness</label>
            <select id="p-tech" bind:value={fTechSavviness} class={inputClass}>
              <option value="novice">Novice</option>
              <option value="average">Average</option>
              <option value="expert">Expert</option>
            </select>
          </div>
          <div>
            <label class={labelClass} for="p-patience">Patience</label>
            <select id="p-patience" bind:value={fPatience} class={inputClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label class={labelClass} for="p-reading">Reading style</label>
            <select id="p-reading" bind:value={fReadingStyle} class={inputClass}>
              <option value="skims">Skims</option>
              <option value="reads">Reads</option>
            </select>
          </div>
          <div>
            <label class={labelClass} for="p-device">Device</label>
            <select id="p-device" bind:value={fDevice} class={inputClass}>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
            </select>
          </div>
          <div>
            <label class={labelClass} for="p-vw">Viewport width</label>
            <input id="p-vw" bind:value={fViewportWidth} type="number" min="320" max="3840" class={inputClass} />
          </div>
          <div>
            <label class={labelClass} for="p-vh">Viewport height</label>
            <input id="p-vh" bind:value={fViewportHeight} type="number" min="320" max="2160" class={inputClass} />
          </div>
        </div>
        <div class="mt-3">
          <label class={labelClass} for="p-habits">Habits & goals</label>
          <textarea id="p-habits" bind:value={fHabits} rows="2" placeholder="Describe this persona's habits and typical goals"
            class="{inputClass} resize-none"></textarea>
        </div>
      </section>

      <!-- Knowledge -->
      <section>
        <h3 class="text-sm font-semibold text-foreground mb-3 uppercase tracking-wide">Knowledge</h3>
        <div class="space-y-3">
          <div>
            <label class={labelClass} for="p-pk">Product knowledge</label>
            <textarea id="p-pk" bind:value={fProductKnowledge} rows="2" placeholder="What does this persona already know about your product?"
              class="{inputClass} resize-none"></textarea>
          </div>
          <div>
            <label class={labelClass} for="p-exp">Expectations</label>
            <textarea id="p-exp" bind:value={fExpectations} rows="2" placeholder="What does this persona expect to happen?"
              class="{inputClass} resize-none"></textarea>
          </div>
          <div>
            <label class={labelClass} for="p-vocab">Vocabulary</label>
            <input id="p-vocab" bind:value={fVocabulary} type="text" placeholder="Domain terms this persona uses (e.g. 'cart', 'checkout', 'order')" class={inputClass} />
          </div>
        </div>
      </section>

      {#if saveError}
        <p class="text-sm text-destructive">{saveError}</p>
      {/if}

      <div class="flex justify-end gap-3 pt-2 sticky bottom-0 bg-card pb-1">
        <button
          type="button"
          onclick={() => { formOpen = false; }}
          class="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onclick={handleSave}
          disabled={saving}
          class="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/80 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : editingPersona ? 'Save changes' : 'Create persona'}
        </button>
      </div>
    </div>
  {/snippet}
</Modal>
