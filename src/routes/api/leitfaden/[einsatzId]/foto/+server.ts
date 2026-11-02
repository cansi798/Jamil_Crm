import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { speichereFoto } from '$lib/server/leitfaden';

/** Foto zu einem Foto-Schritt (multipart: opId, schrittId, zeit, datei) – landet in den Dokumenten des Auftrags. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const k = betriebKontext(locals);
		const f = await request.formData();
		return json(await speichereFoto(k, locals.nutzer!, params.einsatzId, { opId: f.get('opId'), schrittId: f.get('schrittId'), zeit: f.get('zeit'), datei: f.get('datei') }));
	} catch (e) {
		return alsAntwort(e);
	}
};
