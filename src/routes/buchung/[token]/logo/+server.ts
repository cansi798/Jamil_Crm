import { error } from '@sveltejs/kit';
import { RASTERBILD, sichereDateiKopfzeilen } from '$lib/server/datei-kopf';
import type { RequestHandler } from './$types';
import { logoZurBuchung } from '$lib/server/buchung-oeffentlich';

/** Logo des Betriebs für die Bestätigungs-/Verwaltungsseite. */
export const GET: RequestHandler = async ({ params, url }) => {
	// ?variante=dunkel: helle Variante für einen dunklen Kopf (wie im Kundenportal, msg 3662)
	const logo = await logoZurBuchung(params.token, url.searchParams.get('variante') === 'dunkel' ? 'dunkel' : 'briefkopf');
	if (!logo || !RASTERBILD.test(logo.typ)) error(404, 'Kein Logo');
	return new Response(logo.bytes as unknown as BodyInit, {
		headers: { ...sichereDateiKopfzeilen(logo.typ), 'cache-control': 'private, max-age=3600', 'referrer-policy': 'no-referrer' }
	});
};
