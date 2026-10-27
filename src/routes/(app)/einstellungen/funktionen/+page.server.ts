import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht } from '$lib/server/rechte';
import { portalEinstellungsZugriff } from '$lib/server/kundenportal';
import { moduleDesBetriebs } from '$lib/server/tarif';
import { ladeFunktionenStand, setzeSchalter } from '$lib/server/funktionen';
import { nachSchritt, sichtbareFunktionen } from '$lib/funktionen';

/**
 * Einstellungen → Funktionen & Automatisierungen (Jamil, Talk msg 3423): alle automatischen Funktionen des CRM nach
 * dem Weg des Kunden, mit Zustand, Info-Fenster und Link zur Einstellung. Seite für „Einstellungen“; jede Funktion
 * zeigt sich nur mit ihrem Modul (Tarif) und dem Recht, das ihre Einstellung verlangt.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!locals.nutzer.betriebId || !hatRecht(locals.nutzer, 'einstellungen')) error(403, 'Keine Berechtigung');
	const k = betriebKontext(locals);
	const [module, stand] = await Promise.all([moduleDesBetriebs(k), ladeFunktionenStand(k)]);
	return { gruppen: nachSchritt(sichtbareFunktionen(locals.nutzer, module)), stand };
};

export const actions: Actions = {
	schalten: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			// gleiche Prüfung wie auf den Einstellungsseiten der beiden Schalter („Einstellungen“ + Modul Angebote)
			await setzeSchalter(await portalEinstellungsZugriff(locals), f.get('name'), f.get('wert'));
			return { gespeichert: true, name: String(f.get('name')) };
		} catch (e) {
			return alsFormFehler(e);
		}
	}
};
