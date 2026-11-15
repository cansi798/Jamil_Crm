import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext } from '$lib/server/rechte';
import { angeboteZugriff, setzeTerminvorschlaege } from '$lib/server/angebote';

/** Drei Terminvorschläge für den Baubeginn `{ termine: [{ beginn, hinweis? }] }` – ersetzt die Liste, nur im Entwurf. */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const zg = await angeboteZugriff(locals);
		const { termine } = await leseJson(request);
		return json(await setzeTerminvorschlaege(betriebKontext(locals), params.id, termine, zg));
	} catch (e) {
		return alsAntwort(e);
	}
};
