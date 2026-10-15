import type { LayoutServerLoad } from './$types';
import { adminSeitenZugriff } from '$lib/server/admin';

/**
 * Den Admin-Bereich gibt es nur für Plattform-Admins (deren Sitzung immer mit zweitem Faktor entstanden ist, R13).
 * Alle anderen – auch Gäste – bekommen 404. Formular-Aktionen prüfen das zusätzlich selbst (sie laufen vor `load`), und zwar
 * bevor sie den Anfragekörper lesen; Schreibanfragen von Nicht-Admins weist schon `hooks.server.ts` mit 404 ab.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	adminSeitenZugriff(locals);
	return {};
};
