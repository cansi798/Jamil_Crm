<script lang="ts">
	import { untrack } from 'svelte';
	import Auswahl from '$lib/components/ui/Auswahl.svelte';
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let neuOffen = $state(untrack(() => !!form?.fehler));
</script>

<svelte:head>
	<title>Rollen</title>
</svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Rollen</h1>
			<p class="seiten-meta">Eine Rolle legt fest, was ein Benutzer im System sehen und tun darf.</p>
		</div>
		<div class="seiten-aktionen">
			<button type="button" class="kd-knopf" aria-expanded={neuOffen} onclick={() => (neuOffen = !neuOffen)}>
				<svg class="knopf-symbol" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" /></svg>
				Rolle anlegen
			</button>
		</div>
	</header>

	<AddPanel label="Rolle anlegen" knopf={false} bind:offen={neuOffen}>
		{#snippet children(schliessen)}
			<form method="POST" action="?/neu" use:enhance class="kd-formular">
				{#if form?.fehler}
					<p role="alert" class="kd-fehler">{form.fehler}</p>
				{/if}
				<div class="kd-zwei">
					<label>
						Name
						<input type="text" name="name" maxlength="60" required value={form?.name ?? ''} />
					</label>
					<label>
						Vorlage
						<Auswahl name="vorlage">
							<option value="">Leer (ohne Rechte)</option>
							{#each data.vorlagen as vorlage (vorlage.schluessel)}
								<option value={vorlage.schluessel}>{vorlage.name}</option>
							{/each}
						</Auswahl>
					</label>
				</div>
				<div class="knopf-reihe">
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
					<button type="submit" class="kd-knopf">Rolle anlegen</button>
				</div>
			</form>
		{/snippet}
	</AddPanel>

	<ul class="kd-liste">
		{#each data.rollen as rolle (rolle.id)}
			<li>
				<a href={`/einstellungen/rollen/${rolle.id}`}>
					<strong>{rolle.name}</strong>
					<span class="kd-info">
						{rolle.rechte.length} {rolle.rechte.length === 1 ? 'Recht' : 'Rechte'} ·
						{rolle.benutzer} Benutzer
					</span>
				</a>
			</li>
		{:else}
			<li class="kd-leer">Noch keine Rollen vorhanden.</li>
		{/each}
	</ul>
</main>
