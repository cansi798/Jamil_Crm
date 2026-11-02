import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { leitfadenZumTermin } from '$lib/server/leitfaden';

/**
 * Leitfaden zu einem Termin (Jamil msgs 4302/4304, 4340): `GET /api/leitfaden/<terminId>` – legt den Durchlauf beim
 * ersten Aufruf an, wenn der Termin zu den Einstellungen passt. Nur für die eingeteilte Person bzw. Plantafel-Bearbeiter.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const stand = await leitfadenZumTermin(betriebKontext(locals), locals.nutzer!, params.einsatzId);
		if (!stand) throw new ApiFehler(404, 'Für diesen Termin gibt es keinen Leitfaden.');
		return json(stand);
	} catch (e) {
		return alsAntwort(e);
	}
};
