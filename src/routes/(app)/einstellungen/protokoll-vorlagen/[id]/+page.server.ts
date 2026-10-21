import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { holeVorlage, listeVorlagen } from '$lib/server/protokoll-formulare';
import { listeKatalog } from '$lib/server/katalog';
import { hatModul } from '$lib/server/tarif';

/** Baukasten einer Protokoll-Vorlage. Ältere Versionen leiten auf die aktuelle weiter. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'protokolle', 'protokolle.vorlagen_bearbeiten');
	const vorlage = await alsSeitenFehler(() => holeVorlage(k, params.id));
	if (!vorlage.aktuell) {
		const aktuell = (await listeVorlagen(k, { archivierte: true })).find((v) => v.gruppeId === vorlage.gruppeId);
		if (aktuell) redirect(303, `/einstellungen/protokoll-vorlagen/${aktuell.id}`);
	}
	// Aufmaß-Vorlagen (msg 2842): Katalogpositionen für „Menge → Angebot“ (nur Bezeichnung und Einheit, keine Preise)
	const katalog =
		vorlage.art === 'aufmass' && (await hatModul(k.betriebId, 'katalog'))
			? (await listeKatalog(k, { nurAktive: true }, false)).map((p) => ({ id: p.id, bezeichnung: p.bezeichnung, einheit: p.einheit }))
			: null;
	return { vorlage, katalog };
};
