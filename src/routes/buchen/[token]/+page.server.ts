import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { ladeSeite } from '$lib/server/buchung-oeffentlich';
import { formStempel } from '$lib/server/buchung-schutz';
import { OEFFENTLICHE_KOPFZEILEN } from '$lib/server/buchung-anfrage';

/**
 * Öffentliche Buchungsseite /buchen/<Token> (ohne Anmeldung, Wunsch Jamil msgs 2684/2686). Unbekannter oder
 * ausgeschalteter Link → 404. Einbetten nur auf den Domains des Betriebs (CSP frame-ancestors, hooks.server.ts).
 */
export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	setHeaders({ ...OEFFENTLICHE_KOPFZEILEN });
	const seite = await ladeSeite(params.token);
	if (!seite) error(404, 'Dieser Buchungslink ist nicht (mehr) gültig.');
	locals.einbettenErlaubt = seite.einbetten;
	const { einbetten: _e, ...rest } = seite;
	return {
		token: params.token,
		seite: rest,
		stempel: formStempel()
	};
};
