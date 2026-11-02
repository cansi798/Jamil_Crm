<script lang="ts">
	import Segmente from '$lib/components/ui/Segmente.svelte';
	import KontaktwegSymbol from '$lib/components/ui/KontaktwegSymbol.svelte';
	import { istKontaktweg, KONTAKTWEG_OPTIONEN } from '$lib/kontaktweg';

	/**
	 * Auswahl „Bevorzugter Kontaktweg“ im Kundenformular (Jamil msgs 4289/4291): Keine Angabe · E-Mail · Chat · Telefon.
	 * Gemeinsamer Umschalter (`ui/Segmente`, echte Radio-Felder, Formularfeld `bevorzugter_kontakt`) mit Symbolen.
	 */
	let { wert = '' }: { wert?: string } = $props();
	let gewaehlt = $state<string | null>(null);
	const aktuell = $derived(gewaehlt ?? (istKontaktweg(wert) ? wert : ''));
</script>

<fieldset class="kw-wahl" data-testid="kontaktweg-wahl">
	<legend>Bevorzugter Kontaktweg</legend>
	<Segmente name="bevorzugter_kontakt" label="Bevorzugter Kontaktweg" wert={aktuell} optionen={KONTAKTWEG_OPTIONEN} voll onchange={(w) => (gewaehlt = w)}>
		{#snippet symbol(w)}<KontaktwegSymbol weg={istKontaktweg(w) ? w : ''} groesse={15} />{/snippet}
	</Segmente>
	<p class="kd-info kw-hilfe">Wie der Kunde am liebsten erreicht werden möchte – steht dann in der Kundenakte und im Auftrag.</p>
</fieldset>

<style>
	.kw-wahl :global(.seg-teil) {
		gap: 0.35rem;
	}
	.kw-hilfe {
		margin: 0.35rem 0 0;
	}
	/* Handy: vier Segmente passen ohne Querscrollen – weniger Innenabstand */
	@media (max-width: 480px) {
		:global(html body) .kw-wahl :global(.seg .seg-teil) {
			padding: 0 0.4rem !important;
			gap: 0.25rem;
		}
	}
</style>
