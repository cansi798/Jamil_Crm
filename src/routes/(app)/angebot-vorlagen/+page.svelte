<script lang="ts">
	import VorlagenKopf from '$lib/components/vorlagen/VorlagenKopf.svelte';
	import VorlagenListe from '$lib/components/vorlagen/VorlagenListe.svelte';
	import type { PageData } from './$types';

	/** Angebots-Vorlagen – gleiche Seite wie alle Vorlagen (Jamil msg 3084). */
	let { data }: { data: PageData } = $props();
	const datum = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
	const eintraege = $derived(
		data.vorlagen.map((v) => ({
			id: v.id,
			name: v.name,
			href: `/angebot-vorlagen/${v.id}`,
			meta: `${v.anzahlPositionen === 1 ? '1 Position' : `${v.anzahlPositionen} Positionen`} · geändert ${datum(v.geaendert)}`
		}))
	);
</script>

<svelte:head>
	<title>Angebots-Vorlagen – CRM</title>
</svelte:head>

<main class="kd-seite breit">
	<VorlagenKopf
		titel="Angebots-Vorlagen"
		meta="Wiederkehrende Angebote – im Angebot über „+ Aus Vorlage“ einfügen."
		neu={{ href: '/angebot-vorlagen/neu' }}
	/>
	<VorlagenListe {eintraege} leer="Noch keine Angebots-Vorlagen. Häufige Angebote einmal anlegen und immer wieder verwenden.">
		{#snippet leerAktion()}<a href="/angebot-vorlagen/neu" class="kd-knopf hell">+ Erste Vorlage anlegen</a>{/snippet}
	</VorlagenListe>
</main>
