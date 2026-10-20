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
	.ah {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.35rem;
		min-width: 0;
	}
	.ah-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		max-width: 100%;
		padding: 0.1rem 0.45rem;
		border-radius: 0.7rem;
		font-size: 0.75rem;
		line-height: 1.2rem;
		white-space: normal;
		overflow-wrap: anywhere;
		background: var(--m365-flaeche-hover, #f3f2f1);
		color: var(--m365-text, #1c1f23);
	}
	.ah-chip.gut {
		background: #dff6dd;
		color: #0e700e;
		font-weight: 600;
	}
	.ah-chip.leise {
		color: var(--m365-text-leise, #616161);
	}
	.ah-chip.warnung {
		background: #fff4ce;
		color: #6b4f00;
		font-weight: 600;
	}
	.ah-chip.ueberfaellig {
		background: #fde7e9;
		color: #a4262c;
		font-weight: 600;
	}
	.ah-unsichtbar {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}
</style>
