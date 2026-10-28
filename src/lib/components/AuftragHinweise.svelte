<script lang="ts">
	/**
	 * Kompakte Zeile auf Auftragskarte, Listenzeile und Auftragskopf (Wunsch Jamil msgs 2672/2674): Etikett der
	 * Auftragsquelle, Angebot verschickt/angenommen, nächstes Nachfassen (rot = überfällig, ⏸ = pausiert).
	 */
	import AuftragsquelleEtikett from './AuftragsquelleEtikett.svelte';
	import { angebotAbzeichen, nachfassenAbzeichen, type AngebotInfo, type NachfassenInfo } from '$lib/auftrag-hinweise';
	import { berlinTag } from '$lib/zeit';

	let {
		quelleName = null,
		quelleFarbe = null,
		angebotInfo = null,
		nachfassenInfo = null,
		heute = berlinTag(new Date())
	}: {
		quelleName?: string | null;
		quelleFarbe?: string | null;
		angebotInfo?: AngebotInfo | null;
		nachfassenInfo?: NachfassenInfo | null;
		heute?: string;
	} = $props();

	const angebot = $derived(angebotAbzeichen(angebotInfo));
	const nachfassen = $derived(nachfassenAbzeichen(nachfassenInfo, heute));
</script>

{#if quelleName || angebot || nachfassen}
	<span class="ah">
		{#if quelleName}<AuftragsquelleEtikett name={quelleName} farbe={quelleFarbe} />{/if}
		{#if angebot}
			<span class={`ah-chip ${angebot.ton}`} title={angebot.titel}><span aria-hidden="true">{angebot.ton === 'gut' ? '✓' : '✉'}</span> {angebot.text}</span>
		{/if}
		{#if nachfassen}
			<span class={`ah-chip ${nachfassen.ton}`} title={nachfassen.titel}>
				<span aria-hidden="true">{nachfassenInfo?.pausiert ? '⏸' : '↻'}</span>
				{nachfassen.text}{#if nachfassen.ton === 'ueberfaellig'}<span class="ah-unsichtbar"> (überfällig)</span>{/if}
			</span>
		{/if}
	</span>
{/if}

<style>
	/* .ah und .ah-chip stehen in stil/komponenten.css – gleiche Abzeichen auch in der Kundenliste (KundenHinweise) */
	.ah-unsichtbar {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
