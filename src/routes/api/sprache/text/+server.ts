import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { pruefeBefehlText, pruefeSprachZugang, vorschlagAusText } from '$lib/server/sprache/befehl';

/**
 * Getippter Sprachbefehl („Befehl tippen”): `POST /api/sprache/text` mit `{ text }` (höchstens 2000 Zeichen).
 * Antwort wie `POST /api/sprache`: `{ text, vorschlag, karte }` – gespeichert wird erst mit `/api/sprache/ausfuehren`.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await pruefeSprachZugang(locals);
		const text = pruefeBefehlText((await leseJson(request)).text);
		return json(await vorschlagAusText(locals, text));
	} catch (e) {
		return alsAntwort(e);
	}
};
