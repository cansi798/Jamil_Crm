import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { alsFormFehler } from '$lib/server/fehler';
import { alsSeitenFehler, formWerte } from '$lib/server/seite';
import { legeBetriebAn, listeBetriebe, MELDUNG_NICHT_GEFUNDEN, pruefeAdmin, tarifeFuerAdmin } from '$lib/server/admin';

/** Übersicht aller Betriebe (nur Verwaltungsdaten) und Formular „Neuen Betrieb anlegen“. */
export const load: PageServerLoad = async ({ locals }) => {
	let adminId: string;
	try {
		adminId = pruefeAdmin(locals).id;
	} catch {
		error(404, MELDUNG_NICHT_GEFUNDEN);
	}
	const [betriebe, tarife] = await alsSeitenFehler(() =>
		Promise.all([listeBetriebe(adminId), tarifeFuerAdmin(adminId)])
	);
	return { betriebe, tarife };
};

const FELDER = ['name', 'tarif', 'chefEmail', 'chefName'] as const;

export const actions: Actions = {
	/** Legt den Betrieb an; der Einladungslink für den Chef wird genau einmal angezeigt (keine E-Mail). */
	anlegen: async ({ locals, request, url }) => {
		const werte = formWerte(await request.formData(), FELDER);
		for (const f of FELDER) werte[f] = werte[f].slice(0, 300);
		try {
			const admin = pruefeAdmin(locals);
			const token = await legeBetriebAn(admin.id, werte);
			return { aktion: 'anlegen', name: werte.name.trim(), link: `${url.origin}/einladung/${token}` };
		} catch (e) {
			return alsFormFehler(e, { aktion: 'anlegen', ...werte });
		}
	}
};
