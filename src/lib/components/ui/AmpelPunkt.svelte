<script lang="ts">
	/**
	 * Ampel einer Kennzahl als farbiger Punkt – IMMER oben rechts in der Karte (Jamil msg 3093: „farbiger Punkt reicht.
	 * immer an der gleichen Stelle platzieren“). Kein sichtbarer Text; Bedeutung für Screenreader und Maus-Hinweis über
	 * aria-label/title („Status: gesund“). Die Karte braucht `position: relative` und rechts oben etwas Platz.
	 */
	let { ampel, text = null }: { ampel: 'gruen' | 'gelb' | 'rot'; text?: string | null } = $props();
	const NAME = { gruen: 'Grün', gelb: 'Gelb', rot: 'Rot' } as const;
	const beschreibung = $derived(`Status: ${text ?? NAME[ampel]}`);
</script>

<span class={`ampel-punkt ampel-punkt-${ampel}`} role="img" aria-label={beschreibung} title={beschreibung}></span>

<style>
	.ampel-punkt {
		position: absolute;
		top: var(--ampel-oben, 0.7rem);
		right: var(--ampel-rechts, 0.7rem);
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 50%;
		background: var(--ui-grau);
		box-shadow: 0 0 0 2px var(--ui-flaeche);
	}
	.ampel-punkt-gruen {
		background: var(--ui-gruen);
	}
	.ampel-punkt-gelb {
		background: var(--ui-orange);
	}
	.ampel-punkt-rot {
		background: var(--ui-rot);
	}
</style>
