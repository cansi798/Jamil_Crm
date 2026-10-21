<script lang="ts">
	import '$lib/stil/kunden.css';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import AuftragVorlageFormular from '$lib/components/vorlagen/AuftragVorlageFormular.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Neue Auftrags-Vorlage – CRM</title>
</svelte:head>

<main class="kd-seite breit">
	<SeitenKopf titel="Neue Auftrags-Vorlage" zurueck={{ href: '/auftrag-vorlagen', text: 'Auftrags-Vorlagen' }} />
	{#if form?.fehler}<p role="alert" class="kd-fehler">{form.fehler}</p>{/if}
	<AuftragVorlageFormular knopf="Vorlage anlegen" abbrechen="/auftrag-vorlagen" />
</main>
