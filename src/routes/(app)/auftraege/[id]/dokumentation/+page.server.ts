import type { PageServerLoad } from './$types';
import { holeAuftrag, sichtVon } from '$lib/server/auftraege';
import { hatRecht } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { dateienFuerAuftrag } from '$lib/server/dateien';
import { protokolleFuerAuftrag } from '$lib/server/baustellen-protokolle';

/**
 * Dokumentation eines Auftrags: Fotos, Notizen, Protokolle. Sehen wie der Auftrag selbst; Fotos/Notizen ändern mit
 * „Aufträge bearbeiten“, Protokolle ansehen/bearbeiten mit den Protokoll-Rechten.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	return alsSeitenFehler(async () => {
		const sicht = sichtVon(nutzer);
		const auftrag = await holeAuftrag(k, sicht, params.id);
		// Rechte wie die API (src/lib/server/dokumentation-zugriff.ts): Protokolle nur mit „Protokolle ansehen/bearbeiten“
		const protokolleLesbar = hatRecht(nutzer, 'protokolle.lesen') || hatRecht(nutzer, 'protokolle.bearbeiten');
		const [dateien, protokolle] = await Promise.all([
			dateienFuerAuftrag(k, auftrag.id),
			protokolleLesbar ? protokolleFuerAuftrag(k, auftrag.id) : Promise.resolve([])
		]);
		return {
			auftrag,
			dateien,
			protokolle,
			darfBearbeiten: hatRecht(nutzer, 'auftraege.bearbeiten'),
			protokolleLesbar,
			darfProtokolle: hatRecht(nutzer, 'protokolle.bearbeiten')
		};
	});
};