import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { speichereUnterschrift } from '$lib/server/leitfaden';

/** Unterschrift in einem Protokoll-Feld des Leitfadens (multipart: opId, schrittId, feld, name, datei = PNG). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const k = betriebKontext(locals);
		const f = await request.formData();
		return json(await speichereUnterschrift(k, locals.nutzer!, params.einsatzId, { opId: f.get('opId'), schrittId: f.get('schrittId'), feld: f.get('feld'), name: f.get('name'), datei: f.get('datei') }));
	} catch (e) {
		return alsAntwort(e);
	}
};
