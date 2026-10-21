<script lang="ts">
	import { goto } from '$app/navigation';
	import AngebotVorlageEditor from '$lib/components/AngebotVorlageEditor.svelte';
	import SeitenKopf from '$lib/components/ui/SeitenKopf.svelte';
	import LoeschenKnopf from '$lib/components/ui/LoeschenKnopf.svelte';
	import LoeschenPanel from '$lib/components/ui/LoeschenPanel.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Jamil msg 3043: „Vorlage löschen“ oben rechts, Rückfrage unter dem Kopf; Fehler bleiben dort. */
	let loeschenOffen = $state(false);
	let loeschFehler = $state<string | null>(null);
	let arbeitet = $state(false);
	async function loeschen() {
		if (arbeitet) return;
		arbeitet = true;
		loeschFehler = null;
		try {
			const r = await fetch(`/api/angebot-vorlagen/${data.vorlage.id}`, { method: 'DELETE' });
			if (!r.ok) {
				const b = await r.json().catch(() => null);
				throw new Error(b?.fehler ?? 'Das hat nicht geklappt. Bitte erneut versuchen.');
			}
			await goto('/angebot-vorlagen');
		} catch (e) {
			loeschFehler = (e as Error).message;
		} finally {
			arbeitet = false;
		}
	}
</script>

<svelte:head>
	<title>{data.vorlage.name} – Angebots-Vorlage</title>
</svelte:head>

<main class="kd-seite an-seite">
	<SeitenKopf titel="Angebots-Vorlage" meta={data.vorlage.name} zurueck={{ href: '/angebot-vorlagen', text: 'Angebots-Vorlagen' }}>
		{#snippet aktionen()}
			<LoeschenKnopf ding="Vorlage" bind:offen={loeschenOffen} />
		{/snippet}
	</SeitenKopf>
	<LoeschenPanel ding="Vorlage" bind:offen={loeschenOffen} fehler={loeschFehler} onbestaetigen={loeschen} {arbeitet}>
		Die Vorlage „{data.vorlage.name}“ wird endgültig gelöscht. Bestehende Angebote bleiben unverändert.
	</LoeschenPanel>
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
