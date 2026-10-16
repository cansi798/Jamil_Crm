<script lang="ts">
	import type { ActionData } from './$types';
	import KundeFormular from '$lib/components/KundeFormular.svelte';

	let { form }: { form: ActionData } = $props();
</script>

<svelte:head>
	<title>Neuer Kunde</title>
</svelte:head>

<main class="kd-seite">
	<a href="/kunden" class="kd-zurueck">← Kunden</a>
	<h1>Neuer Kunde</h1>
	<KundeFormular aktion="?/anlegen" werte={form?.werte ?? { art: 'privat' }} fehler={form?.fehler ?? null} knopf="Kunde anlegen" abbrechen="/kunden" />
</main>
