import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { alsAntwort, leseJson } from '$lib/server/fehler';
import { betriebKontext, pruefeRecht } from '$lib/server/rechte';
import { aendereBenutzer } from '$lib/server/benutzer';

/** Rolle und/oder Aktiv-Status ändern: `{ rolleId?, aktiv? }`. Deaktivieren beendet alle Sitzungen des Benutzers. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		pruefeRecht(locals, 'benutzer.verwalten');
		const k = betriebKontext(locals);
		return json(await aendereBenutzer(k, locals.nutzer!.rechte, params.id, await leseJson(request)));
	} catch (e) {
		return alsAntwort(e);
	}
};
