import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { katalogAendern, katalogLesen, listeVorlagen, uebernimmVorlagen } from '$lib/server/katalog';

/** Startvorlagen je Gewerk (ohne Preise) mit „schon übernommen“. */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		await katalogLesen(locals);
		return json(await listeVorlagen(betriebKontext(locals)));
	} catch (e) {
		return alsAntwort(e);
	}
};

/** `{ gewerk }`: übernimmt alle noch nicht übernommenen Vorlagen des Gewerks mit Preis 0 → `{ gewerk, neu }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		await katalogAendern(locals);
		const { gewerk } = await leseJson(request);
		return json(await uebernimmVorlagen(betriebKontext(locals), gewerk));
	} catch (e) {
		return alsAntwort(e);
	}
};
