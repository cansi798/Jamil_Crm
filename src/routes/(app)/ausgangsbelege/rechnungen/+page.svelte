<script lang="ts">
	import type { Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
	import BelegSeite, { type BelegZeile } from '$lib/components/ausgangsbelege/BelegSeite.svelte';
	import { belegLink, type BelegFilter } from '$lib/ausgangsbelege';
	import { euro } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import { RECHNUNG_ART_NAMEN, ZAHL_STATUS_KLASSE, ZAHL_STATUS_NAMEN } from '$lib/rechnungen';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const auswahl = $derived<BelegFilter>({ suche: data.suche, status: data.status, zeitraum: data.zeitraum as BelegFilter['zeitraum'] });
	const filterLink = (id: string) => belegLink('rechnungen', auswahl, { status: data.status === id ? null : id });

	const kacheln = $derived.by((): Kachel[] | null => {
		const kz = data.kennzahlen;
		if (!kz) return null;
		return [
			{ id: 'offen', titel: 'Offen', wert: euro(kz.offenCent), info: `${kz.anzahl} Rechnung${kz.anzahl === 1 ? '' : 'en'}`, ton: 'blau', href: filterLink('offen') },
			{ id: 'ueberfaellig', titel: 'Überfällig', wert: euro(kz.ueberfaelligCent), info: `${kz.ueberfaellig} Rechnung${kz.ueberfaellig === 1 ? '' : 'en'}`, ton: 'rot', href: filterLink('ueberfaellig') },
			{ id: 'teilbezahlt', titel: 'Teilweise bezahlt', wert: String(kz.teilbezahlt), info: 'jetzt', ton: 'orange', href: filterLink('teilbezahlt') },
			{ id: 'bezahlt', titel: 'Bezahlt', wert: String(kz.bezahltMonat), info: 'diesen Monat', ton: 'gruen', href: filterLink('bezahlt') }
		];
	});
	const zeilen = $derived(
		data.rechnungen.map((r): BelegZeile => ({
			id: r.id,
			href: r.crm ? `/rechnungen/${r.id}` : r.lexwareLink,
			neuerTab: !r.crm,
			nummer: r.nummer ?? RECHNUNG_ART_NAMEN[r.art],
			kunde: r.kunde?.name ?? null,
			auftrag: r.auftrag ? `${r.auftrag.nummer} · ${r.auftrag.titel}` : null,
			datum: tagDeutsch(r.datum),
			zusatz: [r.faellig ? `fällig ${tagDeutsch(r.faellig)}` : null, r.offenCent !== null && r.offenCent > 0 && r.offenCent !== r.bruttoCent ? `offen ${euro(r.offenCent)}` : null, r.mahnstufe !== null ? (r.mahnstufe === 0 ? 'erinnert' : `${r.mahnstufe}. Mahnung`) : null, r.crm ? null : 'nur in Lexware']
				.filter(Boolean)
				.join(' · ') || null,
			status: { text: ZAHL_STATUS_NAMEN[r.status], klasse: ZAHL_STATUS_KLASSE[r.status] },
			betrag: r.bruttoCent !== null ? euro(r.bruttoCent) : null,
			pdf: r.crm && r.nummer && r.status !== 'entwurf' ? `/api/rechnungen/${r.id}/pdf` : null
		}))
	);
</script>

<svelte:head>
	<title>Rechnungen · Ausgangsbelege</title>
</svelte:head>

<BelegSeite
	art="rechnungen"
	meta="Rechnungen entstehen in Lexware (am Auftrag: „Rechnung erstellen“); hier steht der Zahlungsstand aus Lexware."
	{auswahl}
	statusListe={[
		{ wert: 'offen', text: 'Offen' },
		{ wert: 'ueberfaellig', text: 'Überfällig' },
		{ wert: 'teilbezahlt', text: 'Teilweise bezahlt' },
		{ wert: 'bezahlt', text: 'Bezahlt' },
		{ wert: 'entwurf', text: 'Entwurf' }
	]}
	{kacheln}
	{zeilen}
	maxTreffer={data.maxTreffer}
/>
