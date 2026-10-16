import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { aendereBetrieb, holeBetrieb, pruefeAdmin } from '$lib/server/admin';

/**
 * Ein Betrieb: `GET` → Verwaltungsdaten; `PATCH` `{ tarif?, aboStatus?, aboEnde? }` (aboEnde `null` entfernt es)
 * → geänderter Betrieb. Sperren (`aboStatus: "gesperrt"`) meldet alle Benutzer des Betriebs sofort ab.
 * Wer kein Plattform-Admin ist, bekommt 404.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const admin = pruefeAdmin(locals);
		return json(await holeBetrieb(admin.id, params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		const admin = pruefeAdmin(locals);
		const k = await leseJson(request);
		await aendereBetrieb(admin.id, params.id, { tarif: k.tarif, aboStatus: k.aboStatus, aboEnde: k.aboEnde });
		return json(await holeBetrieb(admin.id, params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};
