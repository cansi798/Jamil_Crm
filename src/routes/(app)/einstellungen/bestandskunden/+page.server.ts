import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler, ApiFehler } from '$lib/server/fehler';
import { alsSeitenFehler } from '$lib/server/seite';
import { ladeBestandskunden, ladePortalMarke, portalEinstellungsZugriff, speichereBestandskunden } from '$lib/server/kundenportal';
import { hatModul } from '$lib/server/tarif';

/**
 * Einstellungen → Leistungen für Bestandskunden (Jamil, Talk msg 3408): Karte im Kundenportal nach Abschluss eines
 * Auftrags – an/aus, Überschrift, Einleitungstext, eigene Leistungen, Knöpfe mit Link. Recht wie die übrigen
 * Portal-Einstellungen („Einstellungen“ + Modul Angebote).
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) error(401, 'Nicht angemeldet');
	const k = await alsSeitenFehler(() => portalEinstellungsZugriff(locals));
	return alsSeitenFehler(async () => ({
		e: await ladeBestandskunden(k),
		marke: await ladePortalMarke(k),
		portalModul: await hatModul(k.betriebId, 'kundenportal')
	}));
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			const k = await portalEinstellungsZugriff(locals);
			let roh: unknown;
			try {
				const d = f.get('daten');
				roh = JSON.parse(typeof d === 'string' ? d : '');
			} catch {
				throw new ApiFehler(400, 'Die Eingaben konnten nicht gelesen werden. Bitte die Seite neu laden und erneut versuchen.');
			}
			await speichereBestandskunden(k, roh);
			return { gespeichert: true };
		} catch (e) {
			return alsFormFehler(e);
		}
	}
};
