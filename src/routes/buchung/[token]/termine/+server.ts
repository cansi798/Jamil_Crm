import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { termineZumVerschieben } from '$lib/server/buchung-oeffentlich';
import { begrenzeAbfrage, ipVon, jsonAntwort } from '$lib/server/buchung-anfrage';

/** Freie Zeiten zum Verschieben. */
export const GET: RequestHandler = async (event) => {
	try {
		begrenzeAbfrage(ipVon(event));
		const t = await termineZumVerschieben(event.params.token, event.url.searchParams.get('von'));
		if (!t) throw new ApiFehler(404, 'Buchung nicht gefunden.');
		return jsonAntwort(t);
	} catch (e) {
		return alsAntwort(e);
	}
};
