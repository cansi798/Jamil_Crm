<script lang="ts">
	import { enhance } from '$app/forms';
	import { STATUS_NAMEN } from '$lib/auftrag-status';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const k = $derived(data.kunde);
	const adresse = $derived([k.strasse, [k.plz, k.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '));
	const ansprechpartner = $derived([k.anrede, k.vorname, k.nachname].filter(Boolean).join(' '));
</script>

<svelte:head>
	<title>{k.name}</title>
</svelte:head>

<main class="kd-seite">
	<a href="/kunden" class="kd-zurueck">← Kunden</a>
	<h1>{k.name}</h1>
	<p class="kd-info">{k.art === 'firma' ? 'Firmenkunde' : 'Privatkunde'}</p>

	<dl class="kd-daten">
		{#if k.art === 'firma' && ansprechpartner}
			<dt>Ansprechpartner</dt>
			<dd>{ansprechpartner}</dd>
		{:else if k.art === 'privat' && k.anrede}
			<dt>Anrede</dt>
			<dd>{k.anrede}</dd>
		{/if}
		{#if k.telefon}
			<dt>Telefon</dt>
			<dd><a href={`tel:${k.telefon.replace(/[^0-9+]/g, '')}`}>{k.telefon}</a></dd>
		{/if}
		{#if k.email}
			<dt>E-Mail</dt>
			<dd><a href={`mailto:${k.email}`}>{k.email}</a></dd>
		{/if}
		{#if adresse}
			<dt>Adresse</dt>
			<dd>{adresse}</dd>
		{/if}
		{#if k.notiz}
			<dt>Notiz</dt>
			<dd>{k.notiz}</dd>
		{/if}
	</dl>

	{#if data.darfBearbeiten}
		<a href={`/kunden/${k.id}/bearbeiten`} class="kd-knopf hell">Kunde bearbeiten</a>
	{/if}

	<h2>Objekte</h2>
	<ul class="kd-liste">
		{#each data.objekte as objekt (objekt.id)}
			<li>
				<a href={`/kunden/${k.id}/objekte/${objekt.id}`}>
					<strong>{objekt.bezeichnung}</strong>
					{#if objekt.strasse || objekt.ort}
						<span class="kd-info">
							{[objekt.strasse, [objekt.plz, objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
						</span>
					{/if}
				</a>
			</li>
		{:else}
			<li class="kd-leer">Noch keine Objekte (Baustellen) angelegt.</li>
		{/each}
	</ul>
	{#if data.darfBearbeiten}
		<a href={`/kunden/${k.id}/objekte/neu`} class="kd-knopf hell">+ Objekt</a>
	{/if}

	{#if data.auftraege}
		<h2>Aufträge</h2>
		<ul class="kd-liste">
			{#each data.auftraege as auftrag (auftrag.id)}
				<li>
					<a href={`/auftraege/${auftrag.id}`}>
						<strong>{auftrag.titel}</strong>
						<span class="kd-info">{auftrag.nummer} · {STATUS_NAMEN[auftrag.status]}</span>
					</a>
				</li>
			{:else}
				<li class="kd-leer">Noch keine Aufträge.</li>
			{/each}
		</ul>
		{#if data.darfAuftragAnlegen}
			<a href={`/auftraege/neu?kunde=${k.id}`} class="kd-knopf hell">+ Auftrag</a>
		{/if}
	{/if}

	<h2>Verlauf</h2>
	<ol class="kd-verlauf">
		{#each data.verlauf as eintrag (eintrag.id)}
			<li>
				<strong>{eintrag.titel}</strong> · {eintrag.zeit} · {eintrag.wer}
				{#if eintrag.aenderungen.length > 0}
					<ul>
						{#each eintrag.aenderungen as a (a.feld)}
							<li class="kd-info">{a.feld}: {a.alt} → {a.neu}</li>
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

	{#if data.darfBearbeiten}
		<details class="kd-loeschen">
			<summary>Kunde löschen …</summary>
			<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
				{#if form?.fehler}
					<p role="alert" class="kd-fehler">{form.fehler}</p>
				{/if}
				<p>
					Der Kunde und alle seine Objekte werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.
				</p>
				<button type="submit" class="kd-knopf gefahr">Endgültig löschen</button>
			</form>
		</details>
	{/if}
</main>
