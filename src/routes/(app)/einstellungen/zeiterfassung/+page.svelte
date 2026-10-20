<script lang="ts">
	import '$lib/stil/kunden.css';
	import { enhance } from '$app/forms';
	import Abschnitt from '$lib/components/Abschnitt.svelte';
	import AddPanel from '$lib/components/AddPanel.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Zeiterfassung – Einstellungen</title></svelte:head>

<main class="kd-seite">
	<header class="seiten-kopf">
		<div>
			<h1>Zeiterfassung</h1>
			<p class="seiten-meta">Tätigkeiten ohne Auftrag – z. B. Lager, Werkstatt, Fahrzeugpflege. Die Stunden zählen im Arbeitszeitnachweis, in der Nachkalkulation aber als „nicht produktiv / Gemeinkosten“.</p>
		</div>
	</header>
	{#if form?.taetigkeitFehler}<p role="alert" class="kd-fehler">{form.taetigkeitFehler}</p>{/if}
	{#if form?.meldung}<p role="status" class="kd-info">{form.meldung}</p>{/if}
	<Abschnitt titel="Tätigkeiten ohne Auftrag" anzahl={data.taetigkeiten.length}>
		<ul class="tt-liste">
			{#each data.taetigkeiten as t (t.id)}
				<li class:aus={!t.aktiv}>
					<form method="POST" action="?/aendern" use:enhance={() => async ({ update }) => update({ reset: false })} class="tt-zeile">
						<input type="hidden" name="id" value={t.id} />
						<input name="name" value={t.name} maxlength="80" aria-label="Name" required />
						<button type="submit" class="kd-knopf hell">Speichern</button>
					</form>
					<form method="POST" action="?/aendern" use:enhance>
						<input type="hidden" name="id" value={t.id} /><input type="hidden" name="aktiv" value={t.aktiv ? 'nein' : 'ja'} />
						<button type="submit" class="knopf-subtil">{t.aktiv ? 'Ausblenden' : 'Wieder anzeigen'}</button>
					</form>
					<form method="POST" action="?/loeschen" use:enhance>
						<input type="hidden" name="id" value={t.id} />
						<button type="submit" class="knopf-subtil" aria-label={`${t.name} löschen`}>Löschen</button>
					</form>
				</li>
			{/each}
		</ul>
		<AddPanel label="Tätigkeit hinzufügen">
			{#snippet children(schliessen)}
				<form method="POST" action="?/neu" use:enhance class="tt-zeile">
					<input name="name" maxlength="80" required placeholder="z. B. Werkzeug warten" aria-label="Name" />
					<button type="submit" class="kd-knopf">Hinzufügen</button>
					<button type="button" class="kd-knopf hell" onclick={schliessen}>Abbrechen</button>
				</form>
			{/snippet}
		</AddPanel>
	</Abschnitt>
</main>

<style>
	.tt-liste {
		list-style: none;
		margin: 0 0 var(--ui-a3);
		padding: 0;
		display: grid;
		gap: var(--ui-a2);
	}
	.tt-liste li {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		align-items: center;
	}
	.tt-liste li.aus input[name='name'] {
		color: var(--ui-text-leise);
		text-decoration: line-through;
	}
	.tt-zeile {
		display: flex;
		flex-wrap: wrap;
		gap: var(--ui-a2);
		flex: 1 1 16rem;
	}
	.tt-zeile input {
		flex: 1 1 12rem;
		min-height: var(--ui-feld-hoehe);
	}
</style>
