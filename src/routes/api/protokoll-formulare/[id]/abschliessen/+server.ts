import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { schliesseAb } from '$lib/server/protokoll-formulare';
import { zugriffAusfuellen } from '$lib/server/protokoll-zugriff';

/**
 * Abschließen: `POST {}` (JSON wegen CSRF). Prüft alle Pflichtfelder (400 mit `fehlend`), sperrt das Protokoll, legt
 * das PDF in den Dokumenten des Auftrags ab und vermerkt es im Verlauf.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const { k, sicht } = await zugriffAusfuellen(locals);
		await leseJson(request);
		return json(await schliesseAb(k, sicht, params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};
