import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { holeProtokoll, loescheEntwurf, speichereAntworten } from '$lib/server/protokoll-formulare';
import { zugriffAusfuellen, zugriffLesen } from '$lib/server/protokoll-zugriff';

/**
 * Ausgefülltes Protokoll: `GET` (lesen), `PUT { antworten, schritt? }` (Zwischenspeichern, nur Entwurf; liefert die
 * bereinigten Antworten), `DELETE` (Entwurf verwerfen).
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		const { k, sicht } = await zugriffLesen(locals);
		return json(await holeProtokoll(k, sicht, params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const { k, sicht } = await zugriffAusfuellen(locals);
		const body = await leseJson(request);
		return json({ antworten: await speichereAntworten(k, sicht, params.id, body.antworten, body.schritt) });
	} catch (e) {
		return alsAntwort(e);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		const { k, sicht } = await zugriffAusfuellen(locals);
		return json({ auftragId: await loescheEntwurf(k, sicht, params.id) });
	} catch (e) {
		return alsAntwort(e);
	}
};
