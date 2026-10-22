<script lang="ts">
	import '$lib/stil/kunden.css';
	import VorlagenKopf from '$lib/components/vorlagen/VorlagenKopf.svelte';
	import VorlagenListe from '$lib/components/vorlagen/VorlagenListe.svelte';
	import type { PageData } from './$types';

	/** Auftrags-Vorlagen – gleiche Seite wie alle Vorlagen (Jamil msg 3084): Kopf, eine Liste, Detailseite je Vorlage. */
	let { data }: { data: PageData } = $props();
	const eintraege = $derived(
		data.vorlagen.map((v) => ({
			id: v.id,
			name: v.name,
			href: `/auftrag-vorlagen/${v.id}`,
			meta: v.anzahlAufgaben == null ? null : v.anzahlAufgaben === 1 ? '1 Aufgabe' : `${v.anzahlAufgaben} Aufgaben`,
			beschreibung: v.beschreibung
		}))
	);
</script>

<svelte:head>
	<title>Auftrags-Vorlagen – CRM</title>
</svelte:head>

<main class="kd-seite breit">
	<VorlagenKopf
		titel="Auftrags-Vorlagen"
		meta="Aufgabenlisten für wiederkehrende Aufträge – beim Anlegen wählbar."
		neu={data.darfBearbeiten ? { href: '/auftrag-vorlagen/neu' } : null}
	/>
	<VorlagenListe {eintraege} leer="Noch keine Vorlagen. Eine Vorlage spart Tipparbeit: Ihre Aufgaben stehen beim nächsten Auftrag sofort bereit.">
		{#snippet leerAktion()}
			{#if data.darfBearbeiten}<a href="/auftrag-vorlagen/neu" class="kd-knopf hell">+ Erste Vorlage anlegen</a>{/if}
		{/snippet}
	</VorlagenListe>
</main>
