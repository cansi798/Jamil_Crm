import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, setzeAngebotStatus } from '$lib/server/angebote';

/** Statuswechsel `{ status }` mit Kopplung an den Auftrag (versendet: Anfrage → Angebot, angenommen: Angebot → Beauftragt). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const { status } = await leseJson(request);
		return json(await setzeAngebotStatus(betriebKontext(locals), params.id, status, zg));
	} catch (e) {
		return alsAntwort(e);
	}
};
