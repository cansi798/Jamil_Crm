import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, ordneAngebotZu } from '$lib/server/angebote';

/** `POST { kundeId }` oder `POST { auftragId }`: Angebot nachträglich zuordnen (siehe `ordneAngebotZu`). */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const { kundeId, auftragId } = await leseJson(request);
		return json(await ordneAngebotZu(betriebKontext(locals), params.id, { kundeId, auftragId }, zg));
	} catch (e) {
		return alsAntwort(e);
	}
};
