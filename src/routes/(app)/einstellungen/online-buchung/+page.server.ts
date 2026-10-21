import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';
import { buchungZugriff, holeEinstellungen, kommendeBuchungen, listeDienste, speichereEinstellungen } from '$lib/server/buchung';

/**
 * Einstellungen → Online-Buchung (Wunsch Jamil msgs 2684/2686): online buchbare Terminarten (gepflegt unter
 * Einstellungen → Terminarten, Jamil msg 3074), kommende Buchungen (abgesagte eingeklappt), Datenschutz-Link, Domains
 * zum Einbetten. Recht „Terminarten und Online-Buchung verwalten“.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	await alsSeitenFehler(() => buchungZugriff(locals));
	const k = betriebKontext(locals);
	const [terminarten, einstellungen, buchungen] = await Promise.all([listeDienste(k), holeEinstellungen(k), kommendeBuchungen(k, undefined, 60)]);
	return { terminarten: terminarten.filter((t) => t.onlineBuchbar), andere: terminarten.filter((t) => !t.onlineBuchbar).length, einstellungen, buchungen };
};

export const actions: Actions = {
	einstellungen: async ({ locals, request }) => {
		const f = await request.formData();
		try {
			await buchungZugriff(locals);
			await speichereEinstellungen(betriebKontext(locals), { datenschutzUrl: f.get('datenschutzUrl') ?? '', einbettenDomains: f.get('einbettenDomains') ?? '' });
			return { bereich: 'einstellungen', gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { bereich: 'einstellungen' });
		}
	}
};
