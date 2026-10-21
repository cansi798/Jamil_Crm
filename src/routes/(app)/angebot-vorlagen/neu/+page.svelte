<script lang="ts">
	import AngebotVorlageEditor from '$lib/components/AngebotVorlageEditor.svelte';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
</script>

<svelte:head>
	<title>Neue Angebots-Vorlage – CRM</title>
</svelte:head>

<main class="kd-seite breit">
	<SeitenKopf titel="Neue Angebots-Vorlage" zurueck={{ href: '/angebot-vorlagen', text: 'Angebots-Vorlagen' }} />
	<AngebotVorlageEditor />
</main>
