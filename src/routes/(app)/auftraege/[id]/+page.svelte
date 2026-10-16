<script lang="ts">
	import { enhance } from '$app/forms';
	import StatusKette from '$lib/components/StatusKette.svelte';
	import { STATUS_NAMEN } from '$lib/auftrag-status';
	import { tagDeutsch } from '$lib/zeit';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const a = $derived(data.auftrag);
</script>

<svelte:head>
	<title>{a.nummer} {a.titel}</title>
</svelte:head>

<main class="kd-seite">
	<a href="/auftraege" class="kd-zurueck">← Aufträge</a>
	<h1>{a.titel}</h1>
	<p class="kd-info">{a.nummer} · {STATUS_NAMEN[a.status]}</p>

	{#if form?.fehler}
		<p role="alert" class="kd-fehler">{form.fehler}</p>
	{/if}

	<StatusKette status={a.status} darfBearbeiten={data.darfBearbeiten} />

	<dl class="kd-daten">
		<dt>Kunde</dt>
		<dd>
			{#if data.kundeLesbar}<a href={`/kunden/${a.kundeId}`}>{a.kundeName}</a>{:else}{a.kundeName}{/if}
		</dd>
		{#if a.objektId}
			<dt>Objekt</dt>
			<dd>
				{#if data.kundeLesbar}
					<a href={`/kunden/${a.kundeId}/objekte/${a.objektId}`}>{a.objektBezeichnung}</a>
				{:else}{a.objektBezeichnung}{/if}
			</dd>
		{/if}
		{#if a.geplantAb}
			<dt>Geplant ab</dt>
			<dd>{tagDeutsch(a.geplantAb)}</dd>
		{/if}
		{#if a.beschreibung}
			<dt>Beschreibung</dt>
			<dd>{a.beschreibung}</dd>
		{/if}
	</dl>

	{#if data.darfBearbeiten}
		<a href={`/auftraege/${a.id}/bearbeiten`} class="kd-knopf hell">Auftrag bearbeiten</a>
	{/if}

	<h2>Einsätze</h2>
	<p class="kd-leer">Noch keine Einsätze geplant.</p>

	<h2>Verlauf</h2>
	<ol class="kd-verlauf">
		{#each data.verlauf as eintrag (eintrag.id)}
			<li>
				<strong>{eintrag.titel}</strong> · {eintrag.zeit} · {eintrag.wer}
				{#if eintrag.aenderungen.length > 0}
					<ul>
						{#each eintrag.aenderungen as aenderung (aenderung.feld)}
							<li class="kd-info">{aenderung.feld}: {aenderung.alt} → {aenderung.neu}</li>
						{/each}
					</ul>
				{/if}
			</li>
		{:else}
			<li class="kd-leer">Noch keine Einträge.</li>
		{/each}
	</ol>
	{#if data.verlaufGekuerzt}
		<p class="kd-info">Ältere Einträge werden hier nicht angezeigt.</p>
	{/if}

	{#if data.darfBearbeiten && a.status === 'anfrage'}
		<details class="kd-loeschen">
			<summary>Auftrag löschen …</summary>
			<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
				<p>Die Anfrage und ihre To-dos werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.</p>
				<button type="submit" class="kd-knopf gefahr">Endgültig löschen</button>
			</form>
		</details>
	{/if}
</main>
