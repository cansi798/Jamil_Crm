<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import ObjektFormular from '$lib/components/ObjektFormular.svelte';
	import AnlageFormular from '$lib/components/AnlageFormular.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const werte = $derived(
		form?.werte ?? Object.fromEntries(Object.entries(data.objekt).map(([k, v]) => [k, v ?? '']))
	) as Record<string, string>;
</script>

<svelte:head>
	<title>{data.objekt.bezeichnung}</title>
</svelte:head>

<main class="kd-seite">
	<a href={`/kunden/${data.kunde.id}`} class="kd-zurueck">← {data.kunde.name}</a>
	<h1>{data.objekt.bezeichnung}</h1>

	<section class="an-liste" aria-labelledby="anlagen-titel">
		<div class="an-kopf">
			<h2 id="anlagen-titel">Anlagen ({data.anlagen.length})</h2>
			{#if data.anlagen.length > 0}
				<a class="kd-knopf hell" href={`/kunden/${data.kunde.id}/objekte/${data.objekt.id}/etiketten`} target="_blank" rel="noopener"
					>QR-Etiketten drucken (A4)</a
				>
			{/if}
		</div>
		{#if data.anlagen.length === 0}
			<p class="kd-info">Noch keine Anlagen – z. B. Wärmepumpe, Heizung oder Solaranlage hier erfassen.</p>
		{:else}
			<ul class="kd-liste">
				{#each data.anlagen as an (an.id)}
					<li>
						<a href={`/anlagen/${an.id}`} class="an-eintrag">
							<strong>{an.bezeichnung}</strong>
							<span class="kd-info">
								{an.typName}{#if an.hersteller} · {an.hersteller}{/if}{#if an.seriennummer} · SN {an.seriennummer}{/if}{#if an.standort} · {an.standort}{/if}
							</span>
							{#if an.offeneStoerungen > 0}<span class="an-stoerung">{an.offeneStoerungen} offene Störung{an.offeneStoerungen === 1 ? '' : 'en'}</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
		{#if data.darfBearbeiten}
			<details class="an-neu" open={!!form?.anlageWerte}>
				<summary class="kd-knopf hell">+ Anlage</summary>
				<AnlageFormular aktion="?/anlageAnlegen" werte={form?.anlageWerte ?? {}} fehler={form?.anlageWerte ? (form?.fehler ?? null) : null} knopf="Anlage anlegen" />
			</details>
		{/if}
	</section>

	{#if data.darfBearbeiten}
		<h2>Objekt bearbeiten</h2>
		<ObjektFormular aktion="?/speichern" {werte} fehler={form?.anlageWerte ? null : (form?.fehler ?? null)} knopf="Speichern" abbrechen={`/kunden/${data.kunde.id}`} />

		<details class="kd-loeschen">
			<summary>Objekt löschen …</summary>
			<form method="POST" action="?/loeschen" use:enhance class="kd-formular">
				<p>Das Objekt wird endgültig gelöscht.</p>
				<button type="submit" class="kd-knopf gefahr">Endgültig löschen</button>
			</form>
		</details>
	{:else}
		<dl class="kd-daten">
			{#if data.objekt.strasse || data.objekt.ort}
				<dt>Adresse</dt>
				<dd>
					{[data.objekt.strasse, [data.objekt.plz, data.objekt.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
				</dd>
			{/if}
			{#if data.objekt.notiz}
				<dt>Notiz</dt>
				<dd>{data.objekt.notiz}</dd>
			{/if}
		</dl>
	{/if}
</main>
