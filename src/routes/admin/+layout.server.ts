import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { MELDUNG_NICHT_GEFUNDEN, pruefeAdmin } from '$lib/server/admin';

/**
 * Den Admin-Bereich gibt es nur für Plattform-Admins (deren Sitzung immer mit zweitem Faktor entstanden ist, R13).
 * Alle anderen – auch Gäste – bekommen 404. Formular-Aktionen prüfen das zusätzlich selbst (sie laufen vor `load`).
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	try {
		pruefeAdmin(locals);
	} catch {
		error(404, MELDUNG_NICHT_GEFUNDEN);
	}
	return {};
};
