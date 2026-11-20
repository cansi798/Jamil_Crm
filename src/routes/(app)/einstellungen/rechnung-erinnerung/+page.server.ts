import { error, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext, hatRecht, pruefeRecht } from '$lib/server/rechte';
import { aktiveMitarbeiter } from '$lib/server/todos';
import { rollenAuswahl } from '$lib/server/nachfassen';
import { ladeErinnerungEinstellung, speichereErinnerungEinstellung } from '$lib/server/rechnung-erinnerung';

/**
 * Einstellungen → Abschluss & danach → Erinnerung „Rechnung erstellen“ (Jamil msg 6530: „Die Zuweisung kann man selbst
 * bestimmen.“): wer die Aufgabe bei „Abgenommen“ bekommt – Standard (Büro, sonst Chef), feste Person oder Rolle. Nur „Einstellungen“.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	if (!hatRecht(locals.nutzer, 'einstellungen') || !locals.nutzer.betriebId) error(403, 'Keine Berechtigung');
	const k = betriebKontext(locals);
	const [einstellung, mitarbeiter, rollen] = await Promise.all([ladeErinnerungEinstellung(k), aktiveMitarbeiter(k), rollenAuswahl(k)]);
	return { einstellung, mitarbeiter, rollen };
};

export const actions: Actions = {
	speichern: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			pruefeRecht(locals, 'einstellungen');
			await speichereErinnerungEinstellung(betriebKontext(locals), { zuweisung: f.get('zuweisung'), benutzerId: f.get('benutzerId'), rolleId: f.get('rolleId') });
			return { gespeichert: true };
		} catch (e) {
			return alsFormFehler(e);
		}
	}
};
