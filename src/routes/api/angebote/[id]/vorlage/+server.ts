import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, wendeAngebotVorlageAn } from '$lib/server/angebote';

/** `POST { vorlageId }`: Angebots-Vorlage an einen Entwurf anhängen (Preise aus dem aktuellen Katalog). Antwort: Angebot. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const { vorlageId } = await leseJson(request);
		return json(await wendeAngebotVorlageAn(betriebKontext(locals), params.id, vorlageId, zg));
	} catch (e) {
		return alsAntwort(e);
	}
};
