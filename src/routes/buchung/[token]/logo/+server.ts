import { error } from '@sveltejs/kit';
import { RASTERBILD, sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import type { RequestHandler } from './$types';
import { logoZurBuchung } from '$lib/server/buchung-oeffentlich';

/** Logo des Betriebs für die Bestätigungs-/Verwaltungsseite. */
export const GET: RequestHandler = async ({ params }) => {
	const logo = await logoZurBuchung(params.token);
	if (!logo || !RASTERBILD.test(logo.typ)) error(404, 'Kein Logo');
	return new Response(logo.bytes as unknown as BodyInit, {
		headers: { ...sichereDateiKopfzeilen(logo.typ), 'cache-control': 'private, max-age=3600', 'referrer-policy': 'no-referrer' }
	});
};
