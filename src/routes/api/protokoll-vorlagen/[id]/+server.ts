import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { holeVorlage, speichereVorlage } from '$lib/server/protokoll-formulare';
import { zugriffVorlagen } from '$lib/server/protokoll-zugriff';

/**
 * Eine Version lesen (`GET`) bzw. Änderungen speichern (`PUT { name, beschreibung?, schema }`): Speichern legt eine
 * neue Version an und liefert sie (neue ID); 409, wenn `id` nicht mehr die aktuelle Version ist.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		return json(await holeVorlage(await zugriffVorlagen(locals), params.id));
	} catch (e) {
		return alsAntwort(e);
	}
};

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const k = await zugriffVorlagen(locals);
		return json(await speichereVorlage(k, params.id, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};
