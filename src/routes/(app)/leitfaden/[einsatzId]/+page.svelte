<script lang="ts">
	import type { PageData } from './$types';
	import LeitfadenFlaeche from '$lib/components/LeitfadenFlaeche.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>{data.stand.name} – {data.stand.kundeName}</title>
</svelte:head>

<main class="kd-seite lf-seite">
	<a href="/" class="kd-zurueck">← Heute</a>
	<LeitfadenFlaeche stand={{ ...data.stand, einsatzId: data.stand.einsatzId! }} />
	<p class="kd-info"><a href={`/auftraege/${data.stand.auftragId}#leitfaden`}>Zum Auftrag {data.stand.auftragNummer}</a></p>
</main>

<style>
	.lf-seite {
		max-width: 46rem;
	}
</style>
