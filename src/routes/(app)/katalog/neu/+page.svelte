<script lang="ts">
	import KatalogFormular from '$lib/components/KatalogFormular.svelte';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const werte = $derived((form?.werte as Record<string, string> | undefined) ?? { gewerk: data.gewerk, einheit: 'Stk' });
</script>

<svelte:head>
	<title>Neue Position</title>
</svelte:head>

<main class="kd-seite">
	<a href="/katalog" class="kd-zurueck">← Katalog</a>
	<h1>Neue Position</h1>
	<KatalogFormular aktion="" {werte} fehler={form?.fehler ?? null} mitPreisen={data.mitPreisen} satz={data.satz} knopf="Position anlegen" abbrechen="/katalog" />
</main>
