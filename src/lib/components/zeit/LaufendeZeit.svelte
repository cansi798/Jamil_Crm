<script lang="ts">
	import { onDestroy } from 'svelte';
	import { laufzeitText, ZEIT_ART_NAMEN, type ZeitEintrag } from '$lib/zeiterfassung';

	/** Anzeige „läuft gerade“ in der Kopfleiste (Desktop) bzw. als schmale Leiste oben (mobil). Tipp öffnet den Auftrag. */
	let { laufend, schmal = false }: { laufend: ZeitEintrag; schmal?: boolean } = $props();
	let jetzt = $state(new Date());
	const uhr = setInterval(() => (jetzt = new Date()), 30_000);
	onDestroy(() => clearInterval(uhr));
	const ziel = $derived(laufend.auftragId ? `/auftraege/${laufend.auftragId}#zeiterfassung` : '/zeiten');
	const was = $derived(laufend.auftragNummer ?? laufend.taetigkeitName ?? 'ohne Auftrag');
</script>

<a href={ziel} class="lz" class:schmal class:pause={laufend.art === 'pause'} class:fahrt={laufend.art === 'fahrt'} data-testid="laufende-zeit">
	<span class="lz-punkt" aria-hidden="true"></span>
	<span class="lz-text"><strong>{ZEIT_ART_NAMEN[laufend.art]}</strong> · {was} · {laufzeitText(laufend.beginn, jetzt)}</span>
</a>

<style>
	.lz {
		display: inline-flex;
		align-items: center;
		gap: var(--ui-a2);
		min-height: 2.25rem;
		padding: 0 var(--ui-a3);
		border-radius: var(--ui-chip-radius);
		background: var(--ui-gruen-hell);
		color: var(--ui-text);
		font-size: var(--ui-schrift-s);
		text-decoration: none;
		white-space: nowrap;
		max-width: 100%;
	}
	.lz.schmal {
		display: flex;
		border-radius: 0;
		min-height: 2.5rem;
		padding: 0 var(--ui-a4);
	}
	.lz-text {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pause {
		background: var(--ui-orange-hell);
	}
	.fahrt {
		background: var(--ui-blau-hell);
	}
	.lz-punkt {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: var(--ui-gruen);
	}
	.pause .lz-punkt {
		background: var(--ui-orange);
	}
	.fahrt .lz-punkt {
		background: var(--ui-blau);
	}
	.lz:focus-visible {
		outline: none;
		box-shadow: var(--ui-fokus-ring);
	}
</style>
