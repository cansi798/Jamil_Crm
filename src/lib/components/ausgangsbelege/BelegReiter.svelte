<script lang="ts">
	/**
	 * Reiter des Bereichs „Ausgangsbelege“ (Jamil msg 2948): Angebote, Auftragsbestätigungen, Rechnungen – derselbe
	 * Umschalter wie bei den Status-Chips (docs/design-regeln.md: keine eigenen Reiter bauen). Teil von `BelegSeite`.
	 */
	import Umschalter from '$lib/components/ui/Umschalter.svelte';
	import { BELEG_ARTEN, belegPfad, type BelegArt } from '$lib/ausgangsbelege';

	let { aktiv }: { aktiv: BelegArt } = $props();
</script>

<Umschalter label="Ausgangsbelege" {aktiv} eintraege={BELEG_ARTEN.map((a) => ({ wert: a.wert, text: a.text, href: belegPfad(a.wert) }))} />
