<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import ObjektFormular from '$lib/components/ObjektFormular.svelte';

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

	{#if data.darfBearbeiten}
		<ObjektFormular aktion="?/speichern" {werte} fehler={form?.fehler ?? null} knopf="Speichern" abbrechen={`/kunden/${data.kunde.id}`} />

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
