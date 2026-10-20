import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { logoZumLink } from '$lib/server/buchung-oeffentlich';

/** Logo des Betriebs für die Buchungsseite. */
export const GET: RequestHandler = async ({ params }) => {
	const logo = await logoZumLink(params.token);
	if (!logo) error(404, 'Kein Logo');
	return new Response(logo.bytes as unknown as BodyInit, {
		headers: { 'content-type': logo.typ, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff' }
	});
};
