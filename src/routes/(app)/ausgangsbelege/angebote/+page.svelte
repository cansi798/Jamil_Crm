<script lang="ts">
	import { mitEinstellungen } from '$lib/kennzahlen';
	import type { Kachel } from '$lib/components/ui/KennzahlKacheln.svelte';
	import BelegSeite, { type BelegZeile } from '$lib/components/ausgangsbelege/BelegSeite.svelte';
	import { belegLink, type BelegFilter } from '$lib/ausgangsbelege';
	import { ANGEBOT_STATUS, ANGEBOT_STATUS_NAMEN } from '$lib/angebot-status';
	import { euro } from '$lib/geld';
	import { tagDeutsch } from '$lib/zeit';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const auswahl = $derived<BelegFilter>({ suche: data.suche, status: data.status, zeitraum: data.zeitraum });
	const prozent = (w: number | null) => (w === null ? '–' : `${Math.round(w * 100)} %`);
	const kacheln = $derived.by((): Kachel[] | null => {
		const kz = data.kennzahlen;
		if (!kz) return null;
		const kl = (id: string, titel: string, wert: string, info: string, ton: Kachel['ton'], filter: boolean) => ({
			id, titel, wert, info, ton, href: filter ? belegLink('angebote', auswahl, { status: data.status === id ? null : id }) : null
		});
		// Einstellungen je Kennzahl (Jamil msg 2946)
		const KONFIG: Record<string, string> = { entwurf: 'angebote_entwurf', versendet: 'angebote_offen', angenommen: 'angebote_angenommen', abgelehnt: 'angebote_abgelehnt', abgelaufen: 'angebote_abgelaufen', quote: 'angebote_quote', schnitt: 'angebote_schnitt' };
		return mitEinstellungen([
			kl('entwurf', 'Entwürfe', String(kz.entwurf), 'jetzt', 'grau', true),
			kl('versendet', 'Offen', String(kz.offen), kz.summeOffenCent !== null ? euro(kz.summeOffenCent) : 'versendet, gültig', 'blau', true),
			kl('angenommen', 'Angenommen', String(kz.angenommen), kz.summeAngenommenCent !== null ? euro(kz.summeAngenommenCent) : 'im Zeitraum', 'gruen', true),
			kl('abgelehnt', 'Abgelehnt', String(kz.abgelehnt), 'im Zeitraum', 'rot', true),
			kl('abgelaufen', 'Abgelaufen', String(kz.abgelaufen), 'ohne Antwort', 'orange', false),
			kl('quote', 'Annahmequote', prozent(kz.quote.wert), kz.quote.fehlt ?? 'im Zeitraum', 'akzent', false),
			...(kz.durchschnittCent !== null ? [kl('schnitt', 'Ø Angebotswert', euro(kz.durchschnittCent), 'im Zeitraum abgegeben', 'akzent', false)] : [])
		], kz, (id) => KONFIG[id] ?? id);
	});
	const zeilen = $derived(
		data.angebote.map((a): BelegZeile => ({
			id: a.id,
			href: `/angebote/${a.id}`,
			nummer: a.nummer,
			kunde: a.kundeName,
			auftrag: a.auftragTitel ? [a.auftragNummer, a.auftragTitel].filter(Boolean).join(' · ') : null,
			datum: tagDeutsch(a.datum),
			status: { text: ANGEBOT_STATUS_NAMEN[a.status], klasse: `s-${a.status}` },
			betrag: euro(a.bruttoCent),
			warnung: a.warnungen.includes('preis_fehlt') ? 'Preis fehlt' : null,
			pdf: `/api/angebote/${a.id}/pdf`
		}))
	);
</script>

<svelte:head>
	<title>Angebote · Ausgangsbelege</title>
</svelte:head>

<BelegSeite
	art="angebote"
	meta="Angebote entstehen meist im Auftrag – ein Angebot ohne Auftrag lässt sich später zuordnen."
	{auswahl}
	statusListe={ANGEBOT_STATUS.map((st) => ({ wert: st, text: ANGEBOT_STATUS_NAMEN[st] }))}
	{kacheln}
	{zeilen}
	maxTreffer={data.maxTreffer}
	fehler={form?.fehler ?? null}
>
	{#snippet aktionen()}
		{#if data.darfOhneAuftrag}
			<form method="POST" action="?/neu" use:enhance class="seiten-aktionen">
				<button type="submit" class="kd-knopf" aria-label="+ Angebot ohne Auftrag">+ Angebot</button>
			</form>
		{/if}
	{/snippet}
</BelegSeite>
