<script lang="ts">
	/** Farbiges Etikett einer Auftragsquelle (Wunsch Jamil msg 2672) – Board-Karte, Liste, Auftragskopf, Einstellungen. */
	import { istFarbe, schriftAuf } from '$lib/farben';

	let { name, farbe }: { name: string; farbe: string | null } = $props();
	const hinten = $derived(istFarbe(farbe) ? farbe : '#8a8886');
</script>

<span class="aq-etikett" style:background-color={hinten} style:color={schriftAuf(hinten)} title={`Auftragsquelle: ${name}`}>{name}</span>

<style>
	.aq-etikett {
		display: inline-block;
		max-width: 100%;
		padding: 0 0.45rem;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 600;
		line-height: 1.35rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		vertical-align: middle;
	}
</style>
