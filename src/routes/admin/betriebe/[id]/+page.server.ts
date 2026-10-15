import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { alsSeitenFehler, formWerte } from '$lib/server/seite';
import {
	adminProtokoll,
	aendereBetrieb,
	holeBetrieb,
	MELDUNG_NICHT_GEFUNDEN,
	pruefeAdmin,
	tarifeFuerAdmin
} from '$lib/server/admin';

/** Ein Betrieb: Verwaltungsdaten, Formular für Tarif/Abo und der Änderungsverlauf aus dem Admin-Protokoll. */
export const load: PageServerLoad = async ({ locals, params }) => {
	let adminId: string;
	try {
		adminId = pruefeAdmin(locals).id;
	} catch {
		error(404, MELDUNG_NICHT_GEFUNDEN);
	}
	const betrieb = await alsSeitenFehler(() => holeBetrieb(adminId, params.id));
	const [tarife, protokoll] = await alsSeitenFehler(() =>
		Promise.all([tarifeFuerAdmin(adminId), adminProtokoll(adminId, betrieb.id)])
	);
	return { betrieb, tarife, protokoll };
};

export const actions: Actions = {
	/** Tarif, Abo-Status und Abo-Ende speichern (leeres Abo-Ende entfernt es). */
	aendern: async ({ locals, params, request }) => {
		const werte = formWerte(await request.formData(), ['tarif', 'aboStatus', 'aboEnde']);
		try {
			const admin = pruefeAdmin(locals);
			await aendereBetrieb(admin.id, params.id, werte);
			return { aktion: 'aendern', gespeichert: true };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'aendern' });
		}
	}
};
