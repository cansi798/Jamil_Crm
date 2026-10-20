import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';
import { aktiveMitarbeiter } from '$lib/server/todos';
import {
	buchungZugriff,
	holeEinstellungen,
	kommendeBuchungen,
	legeDienstAn,
	listeDienste,
	mitarbeiterAus,
	speichereEinstellungen
} from '$lib/server/buchung';

/**
 * Einstellungen → Online-Buchung (Wunsch Jamil msgs 2684/2686): Dienste (Terminarten) mit Mitarbeitern und
 * Buchungslinks, Datenschutz-Link, Domains zum Einbetten, kommende Buchungen. Recht „Online-Buchung verwalten“.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	await alsSeitenFehler(() => buchungZugriff(locals));
	const k = betriebKontext(locals);
	const [dienste, einstellungen, mitarbeiter, buchungen] = await Promise.all([
		listeDienste(k),
		holeEinstellungen(k),
		aktiveMitarbeiter(k),
		kommendeBuchungen(k, undefined, 30)
	]);
	return { dienste, einstellungen, mitarbeiter, buchungen };
};

export const actions: Actions = {
	anlegen: async ({ locals, request }) => {
		const f = await request.formData();
		let id: string;
		try {
			await buchungZugriff(locals);
			const d = await legeDienstAn(
				betriebKontext(locals),
				{ name: f.get('name') ?? '', dauerMin: f.get('dauerMin') ?? '', modus: f.get('modus') ?? '' },
				mitarbeiterAus(f) ?? []
			);
			id = d.id;
		} catch (e) {
			return alsFormFehler(e, { bereich: 'neu' });
		}
		redirect(303, `/einstellungen/online-buchung/${id}`);
	},
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
