<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import KundeFormular from '$lib/components/KundeFormular.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const werte = $derived(
		form?.werte ?? Object.fromEntries(Object.entries(data.kunde).map(([k, v]) => [k, v ?? '']))
	) as Record<string, string>;
</script>

<svelte:head>
	<title>{data.kunde.name} bearbeiten</title>
</svelte:head>

<main class="kd-seite">
	<a href={`/kunden/${data.kunde.id}`} class="kd-zurueck">← {data.kunde.name}</a>
	<h1>Kunde bearbeiten</h1>
	<KundeFormular aktion="?/speichern" {werte} fehler={form?.fehler ?? null} knopf="Speichern" abbrechen={`/kunden/${data.kunde.id}`} />
</main>
