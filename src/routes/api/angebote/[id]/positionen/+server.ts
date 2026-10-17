import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, speicherePositionen } from '$lib/server/angebote';

/**
 * Ersetzt die ganze Positionsliste: `{ positionen: [{ katalogPositionId?, bezeichnung?, beschreibung?, menge, einheit?,
 * einzelpreis? }] }` – Reihenfolge = Positionsnummer, höchstens 200, nur im Entwurf. Antwort: das ganze Angebot.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const { positionen } = await leseJson(request);
		return json(await speicherePositionen(betriebKontext(locals), params.id, positionen, zg));
	} catch (e) {
		return alsAntwort(e);
	}
};
