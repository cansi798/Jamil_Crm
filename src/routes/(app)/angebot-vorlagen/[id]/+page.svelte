<script lang="ts">
	import AngebotVorlageEditor from '$lib/components/AngebotVorlageEditor.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.vorlage.name} – Angebots-Vorlage</title>
</svelte:head>

<main class="kd-seite an-seite">
	<a href="/angebot-vorlagen" class="kd-zurueck">← Angebots-Vorlagen</a>
	<h1>Angebots-Vorlage</h1>
	{#if data.gespeichert}<p role="status" class="kt-hinweis ok">Vorlage angelegt.</p>{/if}
	{#key data.vorlage.id}
		<AngebotVorlageEditor vorlage={data.vorlage} />
	{/key}
</main>

<style>
	.an-seite {
		max-width: none; /* ganze Arbeitsfläche (Jamil msg 2838) */
	}
</style>
