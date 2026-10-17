import type { PageServerLoad } from './$types';
import { holeAuftrag, sichtVon } from '$lib/server/auftraege';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler, seitenZugriff } from '$lib/server/seite';
import { dateienFuerAuftrag } from '$lib/server/dateien';
import { protokolleFuerAuftrag } from '$lib/server/baustellen-protokolle';

/**
 * Dokumentation eines Auftrags: Fotos, Notizen, Protokolle. Zugriff wie Auftrag selbst.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const k = await seitenZugriff(locals, 'auftraege', ['auftraege.alle_lesen', 'auftraege.lesen']);
	const nutzer = locals.nutzer!;
	return alsSeitenFehler(async () => {
		const sicht = sichtVon(nutzer);
		const auftrag = await holeAuftrag(k, sicht, params.id);
		const [dateien, protokolle] = await Promise.all([
			dateienFuerAuftrag(k, auftrag.id),
			protokolleFuerAuftrag(k, auftrag.id)
		]);
		return { auftrag, dateien, protokolle };
	});
};