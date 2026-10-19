<script lang="ts">
	import { enhance } from '$app/forms';
	import '$lib/stil/kunden.css';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
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
	</header>

	<AddPanel label="Rolle anlegen" art="primaer" offen={!!form?.fehler}>
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
						<select name="vorlage">
							<option value="">Leer (ohne Rechte)</option>
							{#each data.vorlagen as vorlage (vorlage.schluessel)}
								<option value={vorlage.schluessel}>{vorlage.name}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="knopf-reihe">
					<button type="submit" class="kd-knopf">Rolle anlegen</button>
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
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
