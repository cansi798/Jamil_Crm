<script lang="ts">
	import { mitEinstellungen } from '$lib/kennzahlen';
	import type { Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
	import BelegSeite, { type BelegZeile } from '$lib/components/ausgangsbelege/BelegSeite.svelte';
	import { belegLink, type BelegFilter } from '$lib/ausgangsbelege';
	import { tagDeutsch } from '$lib/zeit';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const STATUS_NAMEN: Record<string, string> = { bereit: 'Bereit zum Versand', gesendet: 'Versendet' };
	const auswahl = $derived<BelegFilter>({ suche: data.suche, status: data.status, zeitraum: data.zeitraum });
	const tag = (iso: string) => tagDeutsch(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(iso)));
	const filterLink = (id: string) => belegLink('auftragsbestaetigungen', auswahl, { status: data.status === id ? null : id });

	const kacheln = $derived.by((): Kachel[] | null => {
		const kz = data.kennzahlen;
		if (!kz) return null;
		const KONFIG: Record<string, string> = { bereit: 'ab_bereit', gesendet: 'ab_versendet', erstellt: 'ab_erstellt' };
		return mitEinstellungen<Kachel>([
			{ id: 'bereit', titel: 'Bereit zum Versand', wert: String(kz.bereit), info: 'jetzt', ton: 'orange', href: filterLink('bereit') },
			{ id: 'gesendet', titel: 'Versendet', wert: String(kz.versendet), info: 'im Zeitraum', ton: 'gruen', href: filterLink('gesendet') },
			{ id: 'erstellt', titel: 'Erstellt', wert: String(kz.erstellt), info: 'im Zeitraum', ton: 'akzent', href: null }
		], kz, (id) => KONFIG[id] ?? id);
	});
	const zeilen = $derived(
		data.abs.map((ab): BelegZeile => ({
			id: ab.id,
			href: ab.auftrag ? `/auftraege/${ab.auftrag.id}` : `/angebote/${ab.angebotId}`,
			nummer: ab.nummer,
			kunde: ab.kundeName,
			auftrag: ab.auftrag ? `${ab.auftrag.nummer} · ${ab.auftrag.titel}` : null,
			datum: tag(ab.angelegt),
			zusatz: ab.versendetAm ? `versendet ${tag(ab.versendetAm)}` : null,
			status: { text: STATUS_NAMEN[ab.versandStatus], klasse: `s-${ab.versandStatus === 'gesendet' ? 'angenommen' : 'versendet'}` },
			pdf: `/api/auftragsbestaetigungen/${ab.id}/pdf`
		}))
	);
</script>

<svelte:head>
	<title>Auftragsbestätigungen · Ausgangsbelege</title>
</svelte:head>

<BelegSeite
	art="auftragsbestaetigungen"
	meta="Auftragsbestätigungen entstehen automatisch, wenn ein Angebot angenommen wird."
	{auswahl}
	statusListe={[
		{ wert: 'bereit', text: STATUS_NAMEN.bereit },
		{ wert: 'gesendet', text: STATUS_NAMEN.gesendet }
	]}
	{kacheln}
	{zeilen}
	maxTreffer={data.maxTreffer}
/>
