<script lang="ts">
	import '$lib/stil/kunden.css';
	import PartnerFormular from '$lib/components/PartnerFormular.svelte';
	import type { ActionData, PageData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Neuer Partner</title></svelte:head>

<main class="kd-seite">
	<a href="/partner" class="kd-zurueck">← Partner</a>
	<h1>Neuer Partner</h1>
	<PartnerFormular action="?" knopf="Partner anlegen" werte={form?.werte ?? { art: data.art }} fehler={form?.fehler ?? null} />
</main>
