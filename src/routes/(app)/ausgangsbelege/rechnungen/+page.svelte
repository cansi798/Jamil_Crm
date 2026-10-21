<script lang="ts">
	import type { Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
	import BelegSeite from '$lib/components/ausgangsbelege/BelegSeite.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	// Platzhalter bis zur Lexware-Anbindung: gleicher Streifen wie bei den anderen Belegarten, Werte „–“
	const kacheln = $derived<Kachel[] | null>(
		data.kennzahlenAn
			? [
					{ id: 'offen', titel: 'Offen', wert: '–', info: 'mit Lexware', ton: 'blau' },
					{ id: 'bezahlt', titel: 'Bezahlt', wert: '–', info: 'mit Lexware', ton: 'gruen' },
					{ id: 'ueberfaellig', titel: 'Überfällig', wert: '–', info: 'mit Lexware', ton: 'rot' }
				]
			: null
	);
</script>

<svelte:head>
	<title>Rechnungen · Ausgangsbelege</title>
</svelte:head>

<BelegSeite
	art="rechnungen"
	meta="Rechnungen werden in Lexware geschrieben und erscheinen hier nach der Anbindung."
	auswahl={{ suche: null, status: null, zeitraum: data.zeitraum }}
	statusListe={[
		{ wert: 'offen', text: 'Offen' },
		{ wert: 'bezahlt', text: 'Bezahlt' },
		{ wert: 'ueberfaellig', text: 'Überfällig' }
	]}
	{kacheln}
	gesperrt
>
	{#snippet leer()}
		<strong>Rechnungen kommen mit der Lexware-Anbindung</strong>
		<span>Bis dahin Rechnungen wie gewohnt in Lexware schreiben. Danach stehen sie hier mit Nummer, Kunde, Auftrag, Datum und Zahlstatus.</span>
	{/snippet}
</BelegSeite>
