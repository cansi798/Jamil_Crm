import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, holeAngebot } from '$lib/server/angebote';
import { markiereAngebotGesendet } from '$lib/server/lexware/angebote';

/** Lexware-Angebot „Als gesendet markieren“ (nach dem Mailprogramm): Versanddatum, Aufgabe erledigt. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		await leseJson(request); // CSRF-Härtung: nur JSON
		const zg = await angeboteZugriff(locals);
		const k = betriebKontext(locals);
		await markiereAngebotGesendet(k, params.id, zg);
		return json(await holeAngebot(k, params.id, zg));
	} catch (e) {
		return alsAntwort(e);
	}
};
