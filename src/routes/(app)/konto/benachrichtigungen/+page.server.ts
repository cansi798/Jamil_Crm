import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { ladeBenachrichtigungsWahl, pushGeraete, speichereBenachrichtigungsWahl } from '$lib/server/erinnerungen';
import { alsFormFehler } from '$lib/server/fehler';
import { BENACHRICHTIGUNGS_KATEGORIEN } from '$lib/benachrichtigungen';

/**
 * Konto → Benachrichtigungen (Wunsch Jamil msg 2679): Push auf diesem Gerät ein-/ausschalten – Recht „erinnerungen.nutzen“.
 * Dazu (msg 3734): worüber benachrichtigen – je Kategorie Glocke / Push, nur die eigenen Einstellungen.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!locals.nutzer.betriebId || !hatRecht(locals.nutzer, 'erinnerungen.nutzen')) error(403, 'Keine Berechtigung');
	const k = betriebKontext(locals);
	const [geraete, wahl] = await Promise.all([pushGeraete(k), ladeBenachrichtigungsWahl(k)]);
	return { geraete, wahl };
};

export const actions: Actions = {
	wahl: async ({ locals, request }) => {
		try {
			if (!locals.nutzer?.betriebId || !hatRecht(locals.nutzer, 'erinnerungen.nutzen')) error(403, 'Keine Berechtigung');
			const f = await request.formData();
			const wahl = Object.fromEntries(
				BENACHRICHTIGUNGS_KATEGORIEN.map((x) => [x.id, { glocke: f.get(`${x.id}_glocke`) === 'on', push: f.get(`${x.id}_push`) === 'on' }])
			);
			await speichereBenachrichtigungsWahl(betriebKontext(locals), wahl);
			return { wahlGespeichert: true };
		} catch (e) {
			return alsFormFehler(e);
		}
	}
};
