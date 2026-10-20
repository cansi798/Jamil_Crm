import type { RequestHandler } from './$types';
import { alsAntwort, ApiFehler } from '$lib/server/fehler';
import { freieTermine } from '$lib/server/buchung-oeffentlich';
import { begrenzeAbfrage, ipVon, jsonAntwort } from '$lib/server/buchung-anfrage';

/** Freie Zeiten (ohne Mitarbeiter) für bis zu 14 Tage ab `?von=JJJJ-MM-TT`. */
export const GET: RequestHandler = async (event) => {
	try {
		begrenzeAbfrage(ipVon(event));
		const t = await freieTermine(event.params.token, event.url.searchParams.get('von'));
		if (!t) throw new ApiFehler(404, 'Dieser Buchungslink ist nicht (mehr) gültig.');
		return jsonAntwort(t);
	} catch (e) {
		return alsAntwort(e);
	}
};
