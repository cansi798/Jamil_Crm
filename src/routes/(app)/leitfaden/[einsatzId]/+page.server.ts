import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { betriebKontext } from '$lib/server/rechte';
import { alsSeitenFehler } from '$lib/server/seite';
import { leitfadenZumTermin } from '$lib/server/leitfaden';

/** Leitfaden zu einem Termin (EINE Fläche, Jamil msg 4304) – für die eingeteilte Person bzw. Plantafel-Bearbeiter. */
export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.nutzer) redirect(303, '/anmelden');
	const stand = await alsSeitenFehler(() => leitfadenZumTermin(betriebKontext(locals), locals.nutzer!, params.einsatzId));
	if (!stand) error(404, 'Für diesen Termin gibt es keinen Leitfaden.');
	return { stand };
};
