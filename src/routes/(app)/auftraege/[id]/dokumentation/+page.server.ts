import type { Actions, PageServerLoad } from './$types';
import { ApiFehler, alsFormFehler } from '$lib/server/fehler';
import { hatModul } from '$lib/server/tarif';
import { portalStand, portalZugriff, setzeDokument } from '$lib/server/kundenportal';
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
		// „Im Kundenportal anzeigen“ je Datei (Jamil msg 2848) – wie die Freigaben im Auftrag: Modul + Recht
		const darfPortal = hatRecht(nutzer, 'kundenportal.verwalten') && (await hatModul(k.betriebId, 'kundenportal'));
		const portalDateien = darfPortal
			? (await portalStand({ k, sicht, preise: false }, auftrag.id)).dateien.filter((d) => d.geteilt).map((d) => d.id)
			: null;
		return {
			auftrag,
			dateien,
			portalDateien,
			protokolle,
			darfBearbeiten: hatRecht(nutzer, 'auftraege.bearbeiten'),
			protokolleLesbar,
			darfProtokolle: hatRecht(nutzer, 'protokolle.bearbeiten')
		};
	});
};
export const actions: Actions = {
	portalDatei: async ({ locals, params, request }) => {
		const f = await request.formData();
		try {
			await setzeDokument(await portalZugriff(locals), params.id, 'datei', f.get('refId'), f.get('geteilt') === 'ja');
			return { portalMeldung: f.get('geteilt') === 'ja' ? 'Im Kundenportal sichtbar.' : 'Nicht mehr im Kundenportal.' };
		} catch (e) {
			return alsFormFehler(e, { portalFehler: e instanceof ApiFehler ? e.message : 'Interner Fehler.' });
		}
	}
};
