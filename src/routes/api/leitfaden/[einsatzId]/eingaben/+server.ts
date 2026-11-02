import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { speichereEingaben } from '$lib/server/leitfaden';

/**
 * Eingaben im Leitfaden: `POST { eingaben: [{ opId, schrittId, wert, zeit }] }` – auch nachgeschickte von offline (4b).
 * Doppelt gesendete Eingaben (gleiche opId) wirken nur einmal; je Schritt gewinnt die spätere Eingabe.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const k = betriebKontext(locals);
		const daten = (await leseJson(request)) as { eingaben?: unknown };
		return json(await speichereEingaben(k, locals.nutzer!, params.einsatzId, daten?.eingaben));
	} catch (e) {
		return alsAntwort(e);
	}
};
