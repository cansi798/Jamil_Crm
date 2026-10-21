<script lang="ts">
	/**
	 * Reiter des Bereichs „Ausgangsbelege“ (Jamil msg 2948): Angebote, Auftragsbestätigungen, Rechnungen – derselbe
	 * Umschalter wie bei den Status-Chips (docs/design-regeln.md: keine eigenen Reiter bauen). Steht als erstes in der
	 * Filterleiste, damit Titel und Filterleiste auf allen Hauptseiten an derselben Stelle bleiben („Ruhe“, msg 2919).
	 */
	import Umschalter from '$lib/components/ui/Umschalter.svelte';

	export type BelegArt = 'angebote' | 'auftragsbestaetigungen' | 'rechnungen';
	let { aktiv }: { aktiv: BelegArt } = $props();
</script>

<Umschalter
	label="Ausgangsbelege"
	{aktiv}
	eintraege={[
		{ wert: 'angebote', text: 'Angebote', href: '/ausgangsbelege/angebote' },
		{ wert: 'auftragsbestaetigungen', text: 'Auftragsbestätigungen', href: '/ausgangsbelege/auftragsbestaetigungen' },
		{ wert: 'rechnungen', text: 'Rechnungen', href: '/ausgangsbelege/rechnungen' }
	]}
/>
