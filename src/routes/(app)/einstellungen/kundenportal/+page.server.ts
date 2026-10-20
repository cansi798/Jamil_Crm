import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { alsSeitenFehler } from '$lib/server/seite';
import { ladePortalEinstellungen, portalEinstellungsZugriff, speicherePortalEinstellungen } from '$lib/server/kundenportal';
import { hatModul } from '$lib/server/tarif';

/** Einstellungen → Kundenportal & Auftragsbestätigung (Jamil msg 2778): AGB-/Widerrufs-Link, AB automatisch. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) error(401, 'Nicht angemeldet');
	const k = await alsSeitenFehler(() => portalEinstellungsZugriff(locals));
	return alsSeitenFehler(async () => ({ e: await ladePortalEinstellungen(k), portalModul: await hatModul(k.betriebId, 'kundenportal') }));
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			const k = await portalEinstellungsZugriff(locals);
			await speicherePortalEinstellungen(k, { agbUrl: f.get('agbUrl'), widerrufUrl: f.get('widerrufUrl'), abAutomatisch: f.get('abAutomatisch'), standard: f.get('standard') });
			return { gespeichert: true };
		} catch (e) {
			return alsFormFehler(e);
		}
	}
};
