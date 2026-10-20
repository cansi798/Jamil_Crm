<script lang="ts">
	import AngebotVorlageEditor from '$lib/components/AngebotVorlageEditor.svelte';
</script>

<svelte:head>
	<title>Neue Angebots-Vorlage</title>
</svelte:head>

<main class="kd-seite an-seite">
	<a href="/angebot-vorlagen" class="kd-zurueck">← Angebots-Vorlagen</a>
	<h1>Neue Angebots-Vorlage</h1>
	<AngebotVorlageEditor />
</main>

<style>
	.an-seite {
		max-width: none; /* ganze Arbeitsfläche (Jamil msg 2838) */
	}
</style>
