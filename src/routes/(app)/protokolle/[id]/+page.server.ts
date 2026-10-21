import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { mitBetrieb } from '$lib/server/db';
import { hatModul } from '$lib/server/tarif';
import { angeboteZugriff } from '$lib/server/angebote';
import { angebotAusAufmass } from '$lib/server/aufmass';
import { alleFelder } from '$lib/protokoll-formular';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { sichtVon } from '$lib/server/auftraege';
import { hatRecht } from '$lib/server/rechte';
import { holeProtokoll } from '$lib/server/protokoll-formulare';
import { AUSFUELLEN, LESEN } from '$lib/server/protokoll-zugriff';
import { darfEines } from '$lib/server/tarif';

/** Protokoll ausfüllen (Assistent) bzw. ansehen (abgeschlossen). Sichtbar wie der Auftrag, sonst 404. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'protokolle', [...LESEN]);
	const nutzer = locals.nutzer!;
	return alsSeitenFehler(async () => {
		await darfEines(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
		const protokoll = await holeProtokoll(k, sichtVon(nutzer), params.id);
		// Aufmaß (msg 2842): Namen der verknüpften Katalogpositionen (ohne Preise) – die Mengen rechnet die Seite live
		let katalog: Record<string, { bezeichnung: string; einheit: string; aktiv: boolean }> | null = null;
		if (protokoll.art === 'aufmass') {
			const ids = [...new Set(alleFelder(protokoll.schema).map((x) => x.feld.katalog?.positionId).filter((x): x is string => !!x))];
			const z = ids.length
				? await mitBetrieb(k, (tx) => tx`select id, bezeichnung, einheit::text as einheit, aktiv from app.katalog_positionen where betrieb_id = ${k.betriebId} and id = any(${ids}::uuid[])`)
				: [];
			katalog = Object.fromEntries(z.map((r) => [r.id, { bezeichnung: r.bezeichnung, einheit: r.einheit, aktiv: r.aktiv }]));
		}
		const darfAngebot =
			protokoll.art === 'aufmass' && !!protokoll.auftrag && hatRecht(nutzer, 'angebote.bearbeiten') && hatRecht(nutzer, 'preise.sehen') && (await hatModul(k.betriebId, 'angebote'));
		return { protokoll, katalog, darfAngebot, darfAusfuellen: AUSFUELLEN.some((r) => hatRecht(nutzer, r)) };
	});
};

export const actions: Actions = {
	/** Aufmaß → Angebots-Entwurf am Auftrag (msg 2842); danach direkt ins Angebot. */
	angebot: async ({ locals, params }) => {
		let ziel: string;
		try {
			const zg = await angeboteZugriff(locals);
			const r = await angebotAusAufmass(betriebKontext(locals), zg, params.id);
			ziel = `/angebote/${r.angebotId}${r.uebersprungen.length ? `?hinweis=${encodeURIComponent(`Übersprungen (nicht mehr im Katalog): ${r.uebersprungen.join(', ')}`)}` : ''}`;
		} catch (e) {
			return alsFormFehler(e, { angebotFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
		redirect(303, ziel);
	}
};
