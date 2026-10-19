<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import ObjektFormular from '$lib/components/ObjektFormular.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Neues Objekt</title>
</svelte:head>

<main class="kd-seite">
	<a href={`/kunden/${data.kunde.id}`} class="kd-zurueck">← {data.kunde.name}</a>
	<h1>Neues Objekt</h1>
	{#if data.vorbelegt.strasse || data.vorbelegt.ort}
		<p class="kd-info">Die Adresse ist mit der Adresse des Kunden vorbelegt – bei einer abweichenden Baustelle einfach ändern.</p>
	{/if}
	<ObjektFormular aktion="?/anlegen" werte={form?.werte ?? data.vorbelegt} fehler={form?.fehler ?? null} knopf="Objekt anlegen" abbrechen={`/kunden/${data.kunde.id}`} />
</main>
