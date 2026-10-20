import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { verschiebe } from '$lib/server/buchung-oeffentlich';
import { begrenzeAenderung, ipVon, jsonAntwort } from '$lib/server/buchung-anfrage';

/** Termin auf eine andere freie Zeit verschieben (JSON `{ "beginn": ISO }`). */
export const POST: RequestHandler = async (event) => {
	try {
		begrenzeAenderung(ipVon(event));
		const e = await leseJson(event.request);
		return jsonAntwort(await verschiebe(event.params.token, e.beginn));
	} catch (e) {
		return alsAntwort(e);
	}
};
