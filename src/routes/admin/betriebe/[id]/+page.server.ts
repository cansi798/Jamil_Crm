import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { alsSeitenFehler, formWerte } from '$lib/server/seite';
import {
	adminProtokoll,
	aendereBetrieb,
	holeBetrieb,
	adminSeitenZugriff,
	tarifeFuerAdmin
} from '$lib/server/admin';

/** Ein Betrieb: Verwaltungsdaten, Formular für Tarif/Abo und der Änderungsverlauf aus dem Admin-Protokoll. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const adminId = adminSeitenZugriff(locals).id;
	const betrieb = await alsSeitenFehler(() => holeBetrieb(adminId, params.id));
	const [tarife, protokoll] = await alsSeitenFehler(() =>
		Promise.all([tarifeFuerAdmin(adminId), adminProtokoll(adminId, betrieb.id)])
	);
	return { betrieb, tarife, protokoll };
};

export const actions: Actions = {
	/** Tarif, Abo-Status und Abo-Ende speichern (leeres Abo-Ende entfernt es). */
	aendern: async ({ locals, params, request }) => {
		// Zuerst prüfen, dann den Körper lesen (Nicht-Admins: 404, Formular wird nicht verarbeitet).
		const admin = adminSeitenZugriff(locals);
		const werte = formWerte(await request.formData(), ['tarif', 'aboStatus', 'aboEnde']);
		try {
			await aendereBetrieb(admin.id, params.id, werte);
			return { aktion: 'aendern', gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'aendern' });
		}
	}
};
