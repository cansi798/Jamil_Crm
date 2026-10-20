import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { sageAb } from '$lib/server/buchung-oeffentlich';
import { begrenzeAenderung, ipVon, jsonAntwort } from '$lib/server/buchung-anfrage';

/** Termin absagen (JSON, Bestätigung `{ "absagen": true }`). */
export const POST: RequestHandler = async (event) => {
	try {
		begrenzeAenderung(ipVon(event));
		const e = await leseJson(event.request);
		if (e.absagen !== true) return jsonAntwort({ fehler: 'Bitte bestätigen Sie die Absage.' }, 400);
		await sageAb(event.params.token);
		return jsonAntwort({ ok: true });
	} catch (e) {
		return alsAntwort(e);
	}
};
