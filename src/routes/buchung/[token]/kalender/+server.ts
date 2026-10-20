import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kalenderDaten } from '$lib/server/buchung-oeffentlich';
import { icsDatei } from '$lib/ics';
import { OEFFENTLICHE_KOPFZEILEN } from '$lib/server/buchung-anfrage';

/** Termin als Kalenderdatei (.ics) zum Herunterladen. */
export const GET: RequestHandler = async ({ params }) => {
	const d = await kalenderDaten(params.token);
	if (!d) error(404, 'Buchung nicht gefunden.');
	return new Response(icsDatei(d), {
		headers: {
			...OEFFENTLICHE_KOPFZEILEN,
			'content-type': 'text/calendar; charset=utf-8',
			'content-disposition': 'attachment; filename="Termin.ics"'
		}
	});
};
